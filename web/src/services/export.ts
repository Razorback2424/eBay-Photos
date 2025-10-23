import JSZip from 'jszip';
import { releaseProxy, wrap } from 'comlink';
import type { Endpoint } from 'comlink';

import type { DetectedCard } from '../types/detections';
import type {
  DetectionAdjustment,
  FileAsset,
  NamingPreset,
  Pairing,
  WorkingImageInfo
} from '../state/session';
import type {
  ExportWorkerPairRequest,
  ExportWorkerPairResult,
  ExportWorkerSidePayload
} from '../workers/export.types';

const workerUrl = new URL('../workers/export.worker.ts', import.meta.url);

interface ExportOptions {
  directoryHandle: FileSystemDirectoryHandle | null;
  includeManifests: boolean;
  format: 'jpeg' | 'png';
  quality: number;
  includeWarped: boolean;
}

export type ExportProgressStage = 'initializing' | 'processing' | 'writing' | 'finalizing';

export interface ExportProgressUpdate {
  total: number;
  completed: number;
  stage: ExportProgressStage;
  message: string;
  pairId?: string;
  pairIndex?: number;
}

interface ExportSessionParams {
  files: FileAsset[];
  pairs: Pairing[];
  naming: NamingPreset[];
  workingImages: Record<string, WorkingImageInfo | undefined>;
  detectedCards: Record<string, DetectedCard[] | undefined>;
  detectionAdjustments: Record<string, DetectionAdjustment | undefined>;
  options: ExportOptions;
  onProgress?: (update: ExportProgressUpdate) => void;
}

interface ManifestSide {
  bbox: { x: number; y: number; width: number; height: number };
  quad: [number, number][];
  warpSize: { width: number; height: number };
  sourceFile?: string;
}

interface ManifestEntry {
  pairId: string;
  cardName: string;
  setName: string;
  folderPath: string;
  files: string[];
  front?: ManifestSide;
  back?: ManifestSide;
}

type ExportWorker = {
  processPair: (request: ExportWorkerPairRequest) => Promise<ExportWorkerPairResult>;
  [releaseProxy]?: () => void;
};

const estimateFilesForPair = (pair: Pairing, includeWarped: boolean) => {
  let total = includeWarped ? 6 : 5; // front listing + quadrants (+ warped when requested)
  if (pair.secondaryFileId) {
    total += 5; // back listing + quadrants
  }
  return total;
};

const formatFolderLocation = (segments: string[], rootName?: string) => {
  if (segments.length === 0) {
    return rootName ? `"${rootName}"` : 'the selected folder';
  }
  const joined = segments.join('/');
  if (rootName) {
    return `"${rootName}/${joined}"`;
  }
  return `"${joined}"`;
};

const mapFsError = (error: unknown): Error => {
  if (error instanceof DOMException) {
    if (error.name === 'NotAllowedError' || error.name === 'SecurityError') {
      return new Error('Access to the selected folder was revoked. Please choose the folder again and retry.');
    }
    if (
      error.name === 'NoModificationAllowedError' ||
      error.name === 'InvalidStateError' ||
      error.name === 'NotReadableError'
    ) {
      return new Error('We could not save files to the selected folder. Pick a different location with write access.');
    }
  }
  return error instanceof Error ? error : new Error('Export failed.');
};

const resolveDetectedCard = (
  fileId: string | undefined,
  detectionId: string | undefined,
  detectedCards: Record<string, DetectedCard[] | undefined>,
  adjustments: Record<string, DetectionAdjustment | undefined>
): DetectedCard | null => {
  if (!fileId || !detectionId) {
    return null;
  }
  const autoPrefix = `${fileId}-card-`;
  if (detectionId.startsWith(autoPrefix)) {
    const index = Number.parseInt(detectionId.slice(autoPrefix.length), 10);
    const cards = detectedCards[fileId] ?? [];
    return Number.isFinite(index) ? cards[index] ?? null : null;
  }
  const manualPrefix = `${fileId}-manual-`;
  if (detectionId.startsWith(manualPrefix)) {
    const manualId = detectionId.slice(manualPrefix.length);
    const manualEntries = adjustments[fileId]?.manual ?? [];
    const match = manualEntries.find((entry) => entry.id === manualId);
    return match?.card ?? null;
  }
  return null;
};

const mapBoundingBox = (card: DetectedCard, image: WorkingImageInfo) => ({
  x: Math.max(0, Math.round(card.bbox.x * image.scaleX)),
  y: Math.max(0, Math.round(card.bbox.y * image.scaleY)),
  width: Math.max(1, Math.round(card.bbox.width * image.scaleX)),
  height: Math.max(1, Math.round(card.bbox.height * image.scaleY))
});

const mapQuad = (card: DetectedCard, image: WorkingImageInfo) => {
  return card.quad.map(([x, y]) => [Math.round(x * image.scaleX), Math.round(y * image.scaleY)] as [number, number]);
};

const mapWarpSize = (card: DetectedCard, image: WorkingImageInfo) => ({
  width: Math.max(1, Math.round(card.warpSize.width * image.scaleX)),
  height: Math.max(1, Math.round(card.warpSize.height * image.scaleY))
});

const toWorkerPayload = (
  side: 'front' | 'back',
  card: DetectedCard,
  image: WorkingImageInfo
): ExportWorkerSidePayload => ({
  side,
  blob: image.originalBlob,
  width: image.originalWidth,
  height: image.originalHeight,
  bbox: mapBoundingBox(card, image),
  quad: mapQuad(card, image),
  warpSize: mapWarpSize(card, image)
});

const ensureDirectoryHandle = async (
  root: FileSystemDirectoryHandle,
  segments: string[]
): Promise<FileSystemDirectoryHandle> => {
  let handle = root;
  for (const segment of segments) {
    try {
      handle = await handle.getDirectoryHandle(segment, { create: true });
    } catch (error) {
      throw mapFsError(error);
    }
  }
  return handle;
};

const hasNameCollision = async (dir: FileSystemDirectoryHandle, name: string) => {
  try {
    await dir.getFileHandle(name, { create: false });
    return true;
  } catch (error) {
    const domError = error as DOMException;
    if (domError && domError.name === 'NotFoundError') {
      return false;
    }
    if (domError && domError.name === 'TypeMismatchError') {
      return false;
    }
    throw mapFsError(error);
  }
};

const writeBlobToHandle = async (
  dir: FileSystemDirectoryHandle,
  name: string,
  content: Blob | string,
  segments: string[],
  rootName?: string
) => {
  if (await hasNameCollision(dir, name)) {
    const location = formatFolderLocation(segments, rootName);
    throw new Error(`The file "${name}" already exists in ${location}. Rename the card or choose a different folder.`);
  }

  let fileHandle: FileSystemFileHandle;
  try {
    fileHandle = await dir.getFileHandle(name, { create: true });
  } catch (error) {
    throw mapFsError(error);
  }

  let writable: FileSystemWritableFileStream | null = null;
  try {
    writable = await fileHandle.createWritable();
    await writable.write(content);
    await writable.close();
  } catch (error) {
    try {
      await writable?.close();
    } catch {
      /* ignore */
    }
    throw mapFsError(error);
  }
};

const triggerZipDownload = async (zip: JSZip, fileName: string) => {
  const blob = await zip.generateAsync({ type: 'blob' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = fileName;
  document.body.appendChild(anchor);
  anchor.click();
  document.body.removeChild(anchor);
  URL.revokeObjectURL(url);
};

export const exportSession = async ({
  files,
  pairs,
  naming,
  workingImages,
  detectedCards,
  detectionAdjustments,
  options,
  onProgress
}: ExportSessionParams): Promise<void> => {
  if (pairs.length === 0) {
    throw new Error('No pairs available for export.');
  }

  const mimeType = options.format === 'jpeg' ? 'image/jpeg' : 'image/png';
  const extension = options.format === 'jpeg' ? 'jpg' : 'png';
  const normalizedQuality = Math.min(1, Math.max(0, options.quality / 100));

  const namingMap = new Map(naming.map((entry) => [entry.pairId, entry]));
  const fileMap = new Map(files.map((file) => [file.id, file]));

  const workerInstance = new Worker(workerUrl, { type: 'module' });
  const worker = wrap<ExportWorker>(workerInstance as unknown as Endpoint);

  const zip = options.directoryHandle ? null : new JSZip();
  const manifests: { segments: string[]; entry: ManifestEntry; pairIndex: number }[] = [];
  const totalFiles = pairs.reduce(
    (count, pair) => count + estimateFilesForPair(pair, options.includeWarped),
    0
  );
  const manifestSteps = options.includeManifests ? pairs.length : 0;
  const totalSteps = Math.max(totalFiles + manifestSteps, 1);
  let completed = 0;
  const rootFolderName = options.directoryHandle?.name;
  const emitProgress = (
    stage: ExportProgressStage,
    message: string,
    pair: Pairing | null,
    pairIndex?: number
  ) => {
    if (!onProgress) {
      return;
    }
    onProgress({
      stage,
      message,
      total: totalSteps,
      completed,
      pairId: pair?.id,
      pairIndex
    });
  };

  emitProgress('initializing', 'Preparing export…', null);

  try {
    for (let index = 0; index < pairs.length; index += 1) {
      const pair = pairs[index];
      const namingEntry = namingMap.get(pair.id);
      const folderPath = namingEntry?.folderPath?.trim() || `pair-${index + 1}`;
      const segments = folderPath.split('/').map((segment) => segment.trim()).filter(Boolean);

      const frontImage = workingImages[pair.primaryFileId];
      if (!frontImage) {
        throw new Error(`Missing working image for front file ${pair.primaryFileId}.`);
      }
      const frontCard = resolveDetectedCard(
        pair.primaryFileId,
        pair.primaryDetectionId,
        detectedCards,
        detectionAdjustments
      );
      if (!frontCard) {
        throw new Error(`Unable to resolve front detection for pair ${pair.id}.`);
      }

      const backImage = pair.secondaryFileId ? workingImages[pair.secondaryFileId] : undefined;
      const backCard = pair.secondaryFileId
        ? resolveDetectedCard(
            pair.secondaryFileId,
            pair.secondaryDetectionId,
            detectedCards,
            detectionAdjustments
          )
        : null;

      const request: ExportWorkerPairRequest = {
        format: mimeType,
        fileExtension: extension,
        quality: normalizedQuality,
        includeWarped: options.includeWarped,
        front: toWorkerPayload('front', frontCard, frontImage),
        back: backImage && backCard ? toWorkerPayload('back', backCard, backImage) : undefined
      };

      emitProgress('processing', `Processing pair ${index + 1} of ${pairs.length}`, pair, index);

      const result = await worker.processPair(request);

      if (options.directoryHandle) {
        const targetDir = await ensureDirectoryHandle(options.directoryHandle, segments);
        for (const image of result.images) {
          await writeBlobToHandle(targetDir, image.name, image.blob, segments, rootFolderName);
          completed += 1;
          emitProgress('writing', `Saved ${image.name}`, pair, index);
        }
      } else if (zip) {
        let folder = zip as JSZip;
        for (const segment of segments) {
          folder = folder.folder(segment);
        }
        for (const image of result.images) {
          folder.file(image.name, image.blob);
          completed += 1;
          emitProgress('writing', `Prepared ${image.name}`, pair, index);
        }
      }

      if (options.includeManifests) {
        const frontManifest: ManifestSide = {
          bbox: mapBoundingBox(frontCard, frontImage),
          quad: mapQuad(frontCard, frontImage),
          warpSize: mapWarpSize(frontCard, frontImage),
          sourceFile: fileMap.get(pair.primaryFileId)?.name
        };
        const backManifest = backImage && backCard
          ? {
              bbox: mapBoundingBox(backCard, backImage),
              quad: mapQuad(backCard, backImage),
              warpSize: mapWarpSize(backCard, backImage),
              sourceFile: pair.secondaryFileId ? fileMap.get(pair.secondaryFileId)?.name : undefined
            }
          : undefined;

        manifests.push({
          segments,
          entry: {
            pairId: pair.id,
            cardName: namingEntry?.cardName ?? '',
            setName: namingEntry?.setName ?? '',
            folderPath,
            files: result.images.map((item) => item.name),
            front: frontManifest,
            back: backManifest
          },
          pairIndex: index
        });
      }
    }
  } finally {
    if (worker[releaseProxy]) {
      worker[releaseProxy]!();
    }
    workerInstance.terminate();
  }

  if (options.includeManifests) {
    if (options.directoryHandle) {
      for (const manifest of manifests) {
        const targetDir = await ensureDirectoryHandle(options.directoryHandle, manifest.segments);
        const manifestContent = JSON.stringify(manifest.entry, null, 2);
        await writeBlobToHandle(
          targetDir,
          'MANIFEST.json',
          manifestContent,
          manifest.segments,
          rootFolderName
        );
        completed += 1;
        emitProgress('writing', 'Saved MANIFEST.json', pairs[manifest.pairIndex] ?? null, manifest.pairIndex);
      }
    } else if (zip) {
      for (const manifest of manifests) {
        let folder = zip as JSZip;
        for (const segment of manifest.segments) {
          folder = folder.folder(segment);
        }
        folder.file('MANIFEST.json', JSON.stringify(manifest.entry, null, 2));
        completed += 1;
        emitProgress('writing', 'Prepared MANIFEST.json', pairs[manifest.pairIndex] ?? null, manifest.pairIndex);
      }
    }
  }

  if (!options.directoryHandle && zip) {
    emitProgress('finalizing', 'Finalizing ZIP download…', null);
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    await triggerZipDownload(zip, `card-export-${timestamp}.zip`);
  }

  completed = Math.max(completed, totalSteps);
  emitProgress('finalizing', 'Export complete.', null);
};
