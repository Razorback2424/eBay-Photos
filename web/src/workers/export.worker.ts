import { expose } from 'comlink';

import type {
  ExportWorkerBoundingBox,
  ExportWorkerPairRequest,
  ExportWorkerPairResult,
  ExportWorkerSidePayload
} from './export.types';
import { ensureOpenCv, CV } from './opencv';

const QUADRANT_SUFFIXES = ['TOP_LEFT', 'TOP_RIGHT', 'BOTTOM_LEFT', 'BOTTOM_RIGHT'] as const;

const clampRect = (rect: ExportWorkerBoundingBox, maxWidth: number, maxHeight: number): ExportWorkerBoundingBox => {
  const x = Math.min(Math.max(Math.round(rect.x), 0), Math.max(0, maxWidth - 1));
  const y = Math.min(Math.max(Math.round(rect.y), 0), Math.max(0, maxHeight - 1));
  const width = Math.max(1, Math.min(Math.round(rect.width), maxWidth - x));
  const height = Math.max(1, Math.min(Math.round(rect.height), maxHeight - y));
  return { x, y, width, height };
};

const computeQuadrants = (bbox: ExportWorkerBoundingBox): ExportWorkerBoundingBox[] => {
  const detailWidth = Math.max(1, Math.round(bbox.width * 0.6));
  const detailHeight = Math.max(1, Math.round(bbox.height * 0.6));
  return [
    { x: bbox.x, y: bbox.y, width: detailWidth, height: detailHeight },
    { x: bbox.x + bbox.width - detailWidth, y: bbox.y, width: detailWidth, height: detailHeight },
    { x: bbox.x, y: bbox.y + bbox.height - detailHeight, width: detailWidth, height: detailHeight },
    {
      x: bbox.x + bbox.width - detailWidth,
      y: bbox.y + bbox.height - detailHeight,
      width: detailWidth,
      height: detailHeight
    }
  ];
};

const drawCrop = async (
  bitmap: ImageBitmap,
  rect: ExportWorkerBoundingBox,
  format: string,
  quality: number
): Promise<Blob> => {
  const canvas = new OffscreenCanvas(rect.width, rect.height);
  const ctx = canvas.getContext('2d');
  if (!ctx) {
    throw new Error('Unable to create 2D context for export cropping.');
  }
  ctx.clearRect(0, 0, rect.width, rect.height);
  ctx.drawImage(bitmap, rect.x, rect.y, rect.width, rect.height, 0, 0, rect.width, rect.height);
  return await canvas.convertToBlob({
    type: format,
    quality: format === 'image/jpeg' ? quality : undefined
  });
};

const bitmapToMat = (cv: CV, bitmap: ImageBitmap) => {
  const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) {
    throw new Error('Unable to create 2D context for export warp.');
  }
  ctx.drawImage(bitmap, 0, 0);
  const imageData = ctx.getImageData(0, 0, bitmap.width, bitmap.height);
  return cv.matFromImageData(imageData);
};

const createWarpedBlob = async (
  payload: ExportWorkerSidePayload,
  bitmap: ImageBitmap,
  format: string,
  quality: number
): Promise<Blob> => {
  const cv = await ensureOpenCv();
  const src = bitmapToMat(cv, bitmap);
  const width = Math.max(1, Math.round(payload.warpSize.width));
  const height = Math.max(1, Math.round(payload.warpSize.height));

  const srcPoints = cv.matFromArray(4, 1, cv.CV_32FC2, new Float32Array(payload.quad.flat()));
  const dstPoints = cv.matFromArray(
    4,
    1,
    cv.CV_32FC2,
    new Float32Array([0, 0, width, 0, width, height, 0, height])
  );

  const transform = cv.getPerspectiveTransform(srcPoints, dstPoints);
  const dst = new cv.Mat();

  try {
    cv.warpPerspective(src, dst, transform, new cv.Size(width, height), cv.INTER_LINEAR, cv.BORDER_REPLICATE);

    const canvas = new OffscreenCanvas(width, height);
    const ctx = canvas.getContext('2d');
    if (!ctx) {
      throw new Error('Unable to create 2D context for export warp.');
    }

    const outputData = new ImageData(new Uint8ClampedArray(dst.data), width, height);
    ctx.putImageData(outputData, 0, 0);

    return await canvas.convertToBlob({
      type: format,
      quality: format === 'image/jpeg' ? quality : undefined
    });
  } finally {
    src.delete();
    dst.delete();
    transform.delete();
    srcPoints.delete();
    dstPoints.delete();
  }
};

const processSide = async (
  payload: ExportWorkerSidePayload,
  format: string,
  extension: string,
  quality: number,
  includeWarped: boolean
) => {
  const results: { name: string; blob: Blob }[] = [];
  const bitmap = await createImageBitmap(payload.blob);
  const prefix = payload.side === 'front' ? 'FRONT' : 'BACK';

  try {
    const baseBox = clampRect(payload.bbox, payload.width, payload.height);
    const listing = await drawCrop(bitmap, baseBox, format, quality);
    results.push({ name: `${prefix}_LISTING.${extension}`, blob: listing });

    const quadrants = computeQuadrants(baseBox);
    for (let i = 0; i < quadrants.length; i += 1) {
      const crop = clampRect(quadrants[i], payload.width, payload.height);
      const blob = await drawCrop(bitmap, crop, format, quality);
      results.push({ name: `${prefix}_${QUADRANT_SUFFIXES[i]}.${extension}`, blob });
    }

    if (payload.side === 'front' && includeWarped && payload.quad.length === 4) {
      const warpedBlob = await createWarpedBlob(payload, bitmap, format, quality);
      results.push({ name: `${prefix}_WARPED.${extension}`, blob: warpedBlob });
    }
  } finally {
    bitmap.close();
  }

  return results;
};

const processPair = async ({
  format,
  fileExtension,
  quality,
  includeWarped,
  front,
  back
}: ExportWorkerPairRequest): Promise<ExportWorkerPairResult> => {
  const images: { name: string; blob: Blob }[] = [];
  const normalizedQuality = Math.min(1, Math.max(0, quality));

  if (front) {
    const frontImages = await processSide(front, format, fileExtension, normalizedQuality, includeWarped);
    images.push(...frontImages);
  }

  if (back) {
    const backImages = await processSide(back, format, fileExtension, normalizedQuality, false);
    images.push(...backImages);
  }

  return { images };
};

expose({
  processPair
});
