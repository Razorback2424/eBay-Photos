import { expose } from 'comlink';

import type { CardCenteringDetectionResult, CardCenteringEdges, CardCenteringImageDataLike } from '../types/centering';
import {
  buildCenteringMeasurement,
  buildEdgesFromPositions,
  detectAxisAlignedCenteringEdges,
  normalizeRotationDegrees,
  ROTATION_EPSILON
} from '../utils/centering/centeringCore';

const bitmapToImageData = (bitmap: ImageBitmap): CardCenteringImageDataLike => {
  const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) {
    throw new Error('Unable to create 2D context for centering detection.');
  }
  ctx.drawImage(bitmap, 0, 0);
  const imageData = ctx.getImageData(0, 0, bitmap.width, bitmap.height);
  return {
    width: imageData.width,
    height: imageData.height,
    data: imageData.data
  };
};

const rotateBitmap = async (bitmap: ImageBitmap, degrees: number) => {
  const normalized = normalizeRotationDegrees(degrees);
  if (Math.abs(normalized) < ROTATION_EPSILON) {
    return bitmapToImageData(bitmap);
  }

  const radians = (normalized * Math.PI) / 180;
  const sin = Math.abs(Math.sin(radians));
  const cos = Math.abs(Math.cos(radians));
  const width = Math.max(1, Math.ceil(bitmap.width * cos + bitmap.height * sin));
  const height = Math.max(1, Math.ceil(bitmap.width * sin + bitmap.height * cos));
  const canvas = new OffscreenCanvas(width, height);
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) {
    throw new Error('Unable to create 2D context for rotation.');
  }
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, width, height);
  ctx.translate(width / 2, height / 2);
  ctx.rotate(radians);
  ctx.drawImage(bitmap, -bitmap.width / 2, -bitmap.height / 2);
  const imageData = ctx.getImageData(0, 0, width, height);
  return {
    width: imageData.width,
    height: imageData.height,
    data: imageData.data
  };
};

const measureImage = async (blob: Blob, rotationDegrees = 0): Promise<CardCenteringDetectionResult> => {
  const bitmap = await createImageBitmap(blob);
  try {
    const image = await rotateBitmap(bitmap, rotationDegrees);
    const { outer, inner } = detectAxisAlignedCenteringEdges(image);
    return {
      outer,
      inner,
      measurement: buildCenteringMeasurement(image, outer, inner, rotationDegrees)
    };
  } finally {
    bitmap.close();
  }
};

const buildManualMeasurement = (
  width: number,
  height: number,
  outerPositions: Record<'left' | 'top' | 'right' | 'bottom', number>,
  innerPositions: Record<'left' | 'top' | 'right' | 'bottom', number>,
  rotationDegrees = 0
) => {
  const outer: CardCenteringEdges = buildEdgesFromPositions('outer', outerPositions);
  const inner: CardCenteringEdges = buildEdgesFromPositions('inner', innerPositions);
  return buildCenteringMeasurement({ width, height }, outer, inner, rotationDegrees);
};

expose({
  measureImage,
  buildManualMeasurement
} as Record<string, (...args: unknown[]) => unknown>);
