import { expose } from 'comlink';
import type { DetectedCard, DetectionQuadPoint } from '../types/detections';
import { ensureOpenCv, CV } from './opencv';

type Point = DetectionQuadPoint;

const orderQuadPoints = (points: Point[]): Point[] => {
  if (points.length !== 4) {
    return points;
  }
  const sorted = [...points];
  sorted.sort((a, b) => a[0] + a[1] - (b[0] + b[1]));
  const [topLeft, bottomRight] = [sorted[0], sorted[3]];
  const remaining = sorted.slice(1, 3);
  remaining.sort((a, b) => a[0] - b[0]);
  const [topRight, bottomLeft] = remaining;
  return [topLeft, topRight, bottomRight, bottomLeft];
};

const buildQuadFromRect = (rect: { center: { x: number; y: number }; size: { width: number; height: number }; angle: number }): Point[] => {
  const angleRad = (rect.angle * Math.PI) / 180;
  const cos = Math.cos(angleRad);
  const sin = Math.sin(angleRad);
  const halfWidth = rect.size.width / 2;
  const halfHeight = rect.size.height / 2;
  const basePoints: Point[] = [
    [-halfWidth, -halfHeight],
    [halfWidth, -halfHeight],
    [halfWidth, halfHeight],
    [-halfWidth, halfHeight]
  ];
  return orderQuadPoints(
    basePoints.map<Point>(([x, y]) => {
      const rx = x * cos - y * sin + rect.center.x;
      const ry = x * sin + y * cos + rect.center.y;
      return [rx, ry];
    })
  );
};

const bitmapToMat = (cv: CV, bitmap: ImageBitmap) => {
  const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) {
    throw new Error('Unable to create 2D context for detection pipeline.');
  }
  ctx.drawImage(bitmap, 0, 0);
  const imageData = ctx.getImageData(0, 0, bitmap.width, bitmap.height);
  return cv.matFromImageData(imageData);
};

const bitmapToImageData = (bitmap: ImageBitmap) => {
  const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) {
    throw new Error('Unable to create 2D context for fallback detection.');
  }
  ctx.drawImage(bitmap, 0, 0);
  return ctx.getImageData(0, 0, bitmap.width, bitmap.height);
};

const resolveWithTimeout = async <T>(promise: Promise<T>, timeoutMs: number) => {
  return await Promise.race<T>([
    promise,
    new Promise<T>((_, reject) => {
      setTimeout(() => reject(new Error('OpenCV initialization timed out.')), timeoutMs);
    })
  ]);
};

const detectFallbackCard = (image: ImageBitmap): DetectedCard[] => {
  const width = image.width;
  const height = image.height;
  const imageData = bitmapToImageData(image);
  image.close();

  const { data } = imageData;
  const borderDepth = Math.max(1, Math.floor(Math.min(width, height) * 0.08));
  let borderCount = 0;
  let borderLuminance = 0;

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      if (x >= borderDepth && x < width - borderDepth && y >= borderDepth && y < height - borderDepth) {
        continue;
      }
      const offset = (y * width + x) * 4;
      const alpha = data[offset + 3] / 255;
      const luminance =
        (0.2126 * data[offset] + 0.7152 * data[offset + 1] + 0.0722 * data[offset + 2]) * alpha + 255 * (1 - alpha);
      borderLuminance += luminance;
      borderCount += 1;
    }
  }

  const backgroundLuminance = borderCount > 0 ? borderLuminance / borderCount : 255;
  const threshold = 24;
  let minX = width;
  let minY = height;
  let maxX = -1;
  let maxY = -1;

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const offset = (y * width + x) * 4;
      const alpha = data[offset + 3] / 255;
      const luminance =
        (0.2126 * data[offset] + 0.7152 * data[offset + 1] + 0.0722 * data[offset + 2]) * alpha + 255 * (1 - alpha);
      if (Math.abs(luminance - backgroundLuminance) < threshold) {
        continue;
      }
      minX = Math.min(minX, x);
      minY = Math.min(minY, y);
      maxX = Math.max(maxX, x);
      maxY = Math.max(maxY, y);
    }
  }

  if (maxX < minX || maxY < minY) {
    return [];
  }

  const paddingX = Math.max(2, Math.round(width * 0.01));
  const paddingY = Math.max(2, Math.round(height * 0.01));
  const bbox = {
    x: Math.max(0, minX - paddingX),
    y: Math.max(0, minY - paddingY),
    width: Math.max(1, Math.min(width, maxX - minX + 1 + paddingX * 2)),
    height: Math.max(1, Math.min(height, maxY - minY + 1 + paddingY * 2))
  };

  return [
    {
      bbox,
      quad: [
        [bbox.x, bbox.y],
        [bbox.x + bbox.width, bbox.y],
        [bbox.x + bbox.width, bbox.y + bbox.height],
        [bbox.x, bbox.y + bbox.height]
      ],
      centerNorm: [(bbox.x + bbox.width / 2) / Math.max(1, width), (bbox.y + bbox.height / 2) / Math.max(1, height)],
      warpSize: {
        width: Math.max(1, Math.round(bbox.width)),
        height: Math.max(1, Math.round(bbox.height))
      }
    }
  ];
};

const detectCards = async (image: ImageBitmap): Promise<DetectedCard[]> => {
  let cv: CV;
  try {
    cv = await resolveWithTimeout(ensureOpenCv(), 8000);
  } catch (error) {
    console.warn('[detection.worker] Falling back to non-OpenCV detection:', error);
    return detectFallbackCard(image);
  }
  const width = image.width;
  const height = image.height;

  const src = bitmapToMat(cv, image);
  image.close();

  const gray = new cv.Mat();
  cv.cvtColor(src, gray, cv.COLOR_RGBA2GRAY);

  const blurred = new cv.Mat();
  cv.GaussianBlur(gray, blurred, new cv.Size(7, 7), 0, 0, cv.BORDER_DEFAULT);

  const edges = new cv.Mat();
  cv.Canny(blurred, edges, 60, 170, 3, false);

  const kernel = cv.getStructuringElement(cv.MORPH_RECT, new cv.Size(9, 9));
  const closed = new cv.Mat();
  cv.morphologyEx(edges, closed, cv.MORPH_CLOSE, kernel);

  const contours = new cv.MatVector();
  const hierarchy = new cv.Mat();
  cv.findContours(closed, contours, hierarchy, cv.RETR_EXTERNAL, cv.CHAIN_APPROX_SIMPLE);

  const areaThreshold = Math.max(250000, width * height * 0.015);
  const detections: DetectedCard[] = [];

  for (let i = 0; i < contours.size(); i += 1) {
    const contour = contours.get(i);
    try {
      const area = cv.contourArea(contour, false);
      if (area < areaThreshold) {
        contour.delete();
        continue;
      }

      const rotatedRect = cv.minAreaRect(contour);
      const boundingRect = cv.boundingRect(contour);
      const quad = buildQuadFromRect(rotatedRect as typeof rotatedRect & {
        center: { x: number; y: number };
        size: { width: number; height: number };
        angle: number;
      });

      detections.push({
        bbox: {
          x: boundingRect.x,
          y: boundingRect.y,
          width: boundingRect.width,
          height: boundingRect.height
        },
        quad,
        centerNorm: [rotatedRect.center.x / width, rotatedRect.center.y / height],
        warpSize: {
          width: Math.max(1, Math.round(rotatedRect.size.width)),
          height: Math.max(1, Math.round(rotatedRect.size.height))
        }
      });
    } finally {
      contour.delete();
    }
  }

  src.delete();
  gray.delete();
  blurred.delete();
  edges.delete();
  closed.delete();
  kernel.delete();
  hierarchy.delete();
  contours.delete();

  detections.sort((a, b) => a.centerNorm[0] - b.centerNorm[0]);
  return detections;
};

expose({
  detect: detectCards
} as Record<string, (...args: unknown[]) => unknown>);
