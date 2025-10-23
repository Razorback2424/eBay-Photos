const WORKING_MAX_EDGE = 2500;

const IMAGE_BITMAP_OPTIONS: ImageBitmapOptions = {
  colorSpaceConversion: 'default',
  imageOrientation: 'from-image',
  premultiplyAlpha: 'default'
};

const ACCEPTED_TYPES = [
  'image/jpeg',
  'image/png',
  'image/heic',
  'image/heif',
  'image/avif'
];

const isHeicLike = (file: Blob) => {
  if ('type' in file && file.type) {
    return file.type.includes('heic') || file.type.includes('heif');
  }
  const name = (file as File).name?.toLowerCase?.() ?? '';
  return name.endsWith('.heic') || name.endsWith('.heif');
};

const chooseWorkingType = (blob: Blob): string => {
  if (blob.type === 'image/png') {
    return 'image/png';
  }
  return 'image/jpeg';
};

const createBitmap = async (blob: Blob) => {
  return await createImageBitmap(blob, IMAGE_BITMAP_OPTIONS);
};

const cloneBitmapToBlob = async (bitmap: ImageBitmap, type: string) => {
  const maxEdge = Math.max(bitmap.width, bitmap.height);
  const scale = maxEdge > WORKING_MAX_EDGE ? WORKING_MAX_EDGE / maxEdge : 1;
  const width = Math.max(1, Math.round(bitmap.width * scale));
  const height = Math.max(1, Math.round(bitmap.height * scale));

  if ('OffscreenCanvas' in globalThis) {
    const canvas = new OffscreenCanvas(width, height);
    const ctx = canvas.getContext('2d');
    if (!ctx) {
      throw new Error('Unable to create 2D context for working copy.');
    }
    ctx.drawImage(bitmap, 0, 0, width, height);
    const blob = await canvas.convertToBlob({ type, quality: type === 'image/jpeg' ? 0.92 : undefined });
    const workingBitmap = await createImageBitmap(canvas);
    return { blob, bitmap: workingBitmap, width, height };
  }

  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (!ctx) {
    throw new Error('Unable to create 2D context for working copy.');
  }
  ctx.drawImage(bitmap, 0, 0, width, height);
  const blob = await new Promise<Blob>((resolve, reject) => {
    canvas.toBlob(
      (value) => {
        if (value) {
          resolve(value);
        } else {
          reject(new Error('Failed to create working image blob.'));
        }
      },
      type,
      type === 'image/jpeg' ? 0.92 : undefined
    );
  });
  const workingBitmap = await createImageBitmap(canvas);
  return { blob, bitmap: workingBitmap, width, height };
};

const decodeHeicWithWasm = async (blob: Blob) => {
  const heic2anyModule = await import('heic2any');
  const heic2any = heic2anyModule.default ?? heic2anyModule;
  const result = await heic2any({ blob, toType: 'image/jpeg', quality: 0.95 });
  if (Array.isArray(result)) {
    return result[0];
  }
  return result as Blob;
};

export interface DecodedImage {
  originalFile: File;
  originalBlob: Blob;
  decodedBlob: Blob;
  decodedBitmap: ImageBitmap;
  width: number;
  height: number;
  workingBlob: Blob;
  workingBitmap: ImageBitmap;
  workingWidth: number;
  workingHeight: number;
}

export const decodeImage = async (file: File): Promise<DecodedImage> => {
  if (!ACCEPTED_TYPES.some((type) => file.type === type) && !isHeicLike(file)) {
    const label = file.name ? `"${file.name}"` : 'the selected image';
    throw new Error(`Unsupported file type for ${label}. Please choose a JPEG, PNG, HEIC, HEIF, or AVIF image.`);
  }

  let decodedBlob: Blob = file;
  let decodedBitmap: ImageBitmap;

  try {
    decodedBitmap = await createBitmap(file);
  } catch (error) {
    if (!isHeicLike(file)) {
      const label = file.name ? `"${file.name}"` : 'this image';
      const message = error instanceof Error ? error.message : null;
      throw new Error(message ? `${message} (${label}).` : `Unable to decode ${label}. The file may be corrupted.`);
    }

    decodedBlob = await decodeHeicWithWasm(file);
    decodedBitmap = await createBitmap(decodedBlob);
  }

  const workingType = chooseWorkingType(decodedBlob);
  const working = await cloneBitmapToBlob(decodedBitmap, workingType);

  return {
    originalFile: file,
    originalBlob: file,
    decodedBlob,
    decodedBitmap,
    width: decodedBitmap.width,
    height: decodedBitmap.height,
    workingBlob: working.blob,
    workingBitmap: working.bitmap,
    workingWidth: working.width,
    workingHeight: working.height
  };
};

export type { DecodedImage as DecodedImageResult };
