import { expose } from 'comlink';
import type { DetectedCard, DetectionQuadPoint } from '../types/detections';

const OPENCV_BASE_URL = 'https://docs.opencv.org/4.x/';
const OPENCV_SCRIPT_URL = `${OPENCV_BASE_URL}opencv.js`;

type CV = typeof globalThis extends { cv: infer T } ? T : any;

const ensureOpenCv = (() => {
  let initPromise: Promise<CV> | null = null;
  return () => {
    if (!initPromise) {
      initPromise = loadOpenCv().catch((error) => {
        initPromise = null;
        throw error;
      });
    }
    return initPromise;
  };
})();

const loadOpenCv = async (): Promise<CV> => {
  if ((self as unknown as { cv?: CV }).cv) {
    return (self as unknown as { cv: CV }).cv;
  }

  const moduleConfig = {
    locateFile(path: string) {
      if (path.endsWith('.wasm')) {
        return `${OPENCV_BASE_URL}${path}`;
      }
      return `${OPENCV_BASE_URL}${path}`;
    },
    onRuntimeInitialized() {
      /* resolved via promise */
    }
  } as Record<string, unknown>;

  (self as Record<string, unknown>).Module = moduleConfig;

  const response = await fetch(OPENCV_SCRIPT_URL);
  if (!response.ok) {
    throw new Error(`Failed to fetch OpenCV.js (${response.status})`);
  }
  const source = await response.text();

  return await new Promise<CV>((resolve, reject) => {
    moduleConfig.onRuntimeInitialized = () => {
      const runtime = (self as unknown as { cv: CV }).cv;
      if (!runtime) {
        reject(new Error('OpenCV runtime failed to initialise.'));
        return;
      }
      resolve(runtime);
    };

    try {
      const evaluator = new Function('self', source);
      evaluator(self);
    } catch (error) {
      initPromise = null;
      reject(error instanceof Error ? error : new Error('Failed to evaluate OpenCV script.'));
    }
  });
};

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

const detectCards = async (image: ImageBitmap): Promise<DetectedCard[]> => {
  const cv = await ensureOpenCv();
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
});
