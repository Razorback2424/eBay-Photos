import type { DetectedCard } from '../../types/detections';

const bitmapToImageData = (bitmap: ImageBitmap) => {
  const canvas = 'OffscreenCanvas' in globalThis
    ? new OffscreenCanvas(bitmap.width, bitmap.height)
    : Object.assign(document.createElement('canvas'), { width: bitmap.width, height: bitmap.height });
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) {
    throw new Error('Unable to create 2D context for detection.');
  }
  ctx.drawImage(bitmap, 0, 0);
  return ctx.getImageData(0, 0, bitmap.width, bitmap.height);
};

export const detectCards = async (blob: Blob): Promise<DetectedCard[]> => {
  const image = await createImageBitmap(blob);
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
