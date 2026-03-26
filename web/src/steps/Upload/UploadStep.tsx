import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { ChangeEvent, DragEvent, KeyboardEvent } from 'react';
import clsx from 'clsx';

import { StepNavigation } from '../../components/StepNavigation';
import { BannerChromium } from '../../components/BannerChromium';
import { Button } from '../../ui/Button';
import { Stack } from '../../ui/Stack';
import { Text } from '../../ui/Text';
import { FileAsset, useSessionStore } from '../../state/session';
import { decodeImage, DecodedImage } from '../../utils/images/decodeImage';
import { autoMatchBatchFiles } from '../../utils/batchMatching';

const ACCEPT = 'image/jpeg,image/png,image/heic,image/heif,image/avif';
const WORKING_COPY_SIZE = 2500;

const toAsset = (file: File): FileAsset => {
  const relativePath = 'webkitRelativePath' in file ? (file.webkitRelativePath || undefined) : undefined;
  return {
    id: `${relativePath ?? file.name}-${file.size}-${file.lastModified}`,
    name: file.name,
    size: file.size,
    type: file.type,
    lastModified: file.lastModified,
    relativePath
  };
};

interface SlotState {
  status: 'empty' | 'loading' | 'ready' | 'error';
  token?: number;
  file?: File;
  decoded?: DecodedImage;
  error?: string;
}

type SlotKey = 'primary' | 'secondary';

const createToken = () => Date.now() + Math.random();

const releaseSlot = (state: SlotState | undefined) => {
  if (!state?.decoded) return;
  state.decoded.decodedBitmap.close();
  state.decoded.workingBitmap.close();
};

interface ImagePreviewProps {
  decoded: DecodedImage;
}

const ImagePreview = ({ decoded }: ImagePreviewProps) => {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [objectUrl, setObjectUrl] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    let previewBitmap: ImageBitmap | null = null;

    const render = async () => {
      const canvas = canvasRef.current;
      if (!canvas) return;

      const bitmapRenderer = canvas.getContext('bitmaprenderer') as ImageBitmapRenderingContext | null;
      const width = decoded.workingWidth;
      const height = decoded.workingHeight;
      canvas.width = width;
      canvas.height = height;

      if (bitmapRenderer) {
        previewBitmap = await createImageBitmap(decoded.workingBlob);
        if (!active) {
          previewBitmap.close();
          return;
        }
        bitmapRenderer.transferFromImageBitmap(previewBitmap);
        previewBitmap.close();
      } else {
        const context2d = canvas.getContext('2d');
        if (!context2d) return;
        context2d.clearRect(0, 0, width, height);
        context2d.drawImage(decoded.workingBitmap, 0, 0, width, height);
      }
    };

    render().catch(() => {
      /* ignore preview errors */
    });

    return () => {
      active = false;
      previewBitmap?.close();
    };
  }, [decoded]);

  useEffect(() => {
    const url = URL.createObjectURL(decoded.workingBlob);
    setObjectUrl(url);
    return () => {
      URL.revokeObjectURL(url);
    };
  }, [decoded]);

  return (
    <div className="upload-dropzone__preview" role="presentation">
      <canvas ref={canvasRef} className="upload-dropzone__previewCanvas" aria-hidden="true" />
      {objectUrl && <img src={objectUrl} alt="" className="upload-dropzone__previewImage" />}
    </div>
  );
};

interface DropzoneProps {
  label: string;
  description: string;
  slotKey: SlotKey;
  state: SlotState;
  onFile: (slot: SlotKey, file: File) => void;
}

const Dropzone = ({ label, description, slotKey, state, onFile }: DropzoneProps) => {
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [isDragActive, setIsDragActive] = useState(false);

  const openPicker = useCallback(() => {
    inputRef.current?.click();
  }, []);

  const handleDrop = useCallback(
    (event: DragEvent<HTMLDivElement>) => {
      event.preventDefault();
      setIsDragActive(false);
      const file = event.dataTransfer?.files?.[0];
      if (file) {
        onFile(slotKey, file);
      }
    },
    [slotKey, onFile]
  );

  const handleDragOver = useCallback(
    (event: DragEvent<HTMLDivElement>) => {
      event.preventDefault();
      if (!isDragActive) {
        setIsDragActive(true);
      }
    },
    [isDragActive]
  );

  const handleDragLeave = useCallback((event: DragEvent<HTMLDivElement>) => {
    if (event.currentTarget.contains(event.relatedTarget as Node)) {
      return;
    }
    setIsDragActive(false);
  }, []);

  const handleKeyDown = useCallback(
    (event: KeyboardEvent<HTMLDivElement>) => {
      if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault();
        openPicker();
      }
    },
    [openPicker]
  );

  const handleInputChange = useCallback(
    (event: ChangeEvent<HTMLInputElement>) => {
      const file = event.target.files?.[0];
      if (file) {
        onFile(slotKey, file);
      }
      event.target.value = '';
    },
    [slotKey, onFile]
  );

  const stateMessage = useMemo(() => {
    if (state.status === 'loading') {
      return 'Decoding image...';
    }
    if (state.status === 'error') {
      return state.error ?? 'We could not load this image.';
    }
    if (state.status === 'ready' && state.file) {
      const sizeKb = (state.file.size / 1024).toFixed(0);
      return `${state.file.name} · ${sizeKb} KB`;
    }
    return description;
  }, [state, description]);

  return (
    <div className="upload-dropzone-container">
      <div
        role="button"
        tabIndex={0}
        className={clsx(
          'upload-dropzone',
          isDragActive && 'upload-dropzone--active',
          state.status === 'error' && 'upload-dropzone--error'
        )}
        data-state={state.status}
        onClick={openPicker}
        onKeyDown={handleKeyDown}
        onDrop={handleDrop}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
      >
        <Stack gap={8} align="center" className="upload-dropzone__content">
          <Text as="span" variant="label">
            {label}
          </Text>
          <Text as="span" variant="body" className="upload-dropzone__message">
            {stateMessage}
          </Text>
          <Text as="span" variant="muted">
            Click to select or drop a file
          </Text>
        </Stack>
        {state.status === 'ready' && state.decoded && <ImagePreview decoded={state.decoded} />}
        <input
          ref={inputRef}
          type="file"
          accept={ACCEPT}
          className="upload-dropzone__input"
          onChange={handleInputChange}
          tabIndex={-1}
        />
      </div>
    </div>
  );
};

type BatchLoadState = 'idle' | 'loading' | 'ready' | 'error';

export const UploadStep = () => {
  const [slots, setSlots] = useState<Record<SlotKey, SlotState>>({
    primary: { status: 'empty' },
    secondary: { status: 'empty' }
  });
  const [showBatch, setShowBatch] = useState(false);
  const [batchState, setBatchState] = useState<BatchLoadState>('idle');
  const [batchMessage, setBatchMessage] = useState<string>('Select a folder containing one-card front and back scans.');
  const folderInputRef = useRef<HTMLInputElement | null>(null);

  const {
    intakeMode,
    files,
    sourcePairs,
    skippedFileIds,
    setIntakeMode,
    setFiles,
    setSourcePairs,
    setSkippedFileIds,
    setWorkingImage,
    clearWorkflowData
  } = useSessionStore((state) => ({
    intakeMode: state.intakeMode,
    files: state.files,
    sourcePairs: state.sourcePairs,
    skippedFileIds: state.skippedFileIds,
    setIntakeMode: state.setIntakeMode,
    setFiles: state.setFiles,
    setSourcePairs: state.setSourcePairs,
    setSkippedFileIds: state.setSkippedFileIds,
    setWorkingImage: state.setWorkingImage,
    clearWorkflowData: state.clearWorkflowData
  }));

  useEffect(() => {
    return () => {
      releaseSlot(slots.primary);
      releaseSlot(slots.secondary);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const updateSlot = useCallback((slot: SlotKey, next: SlotState | ((current: SlotState) => SlotState)) => {
    setSlots((prev) => {
      const current = prev[slot];
      const newState = typeof next === 'function' ? next(current) : next;
      return {
        ...prev,
        [slot]: newState
      };
    });
  }, []);

  const resetWorkflow = useCallback(
    (mode: 'simple' | 'batch') => {
      setIntakeMode(mode);
      clearWorkflowData();
    },
    [clearWorkflowData, setIntakeMode]
  );

  const stashDecodedImage = useCallback(
    (asset: FileAsset, decoded: DecodedImage) => {
      setWorkingImage(asset.id, {
        blob: decoded.workingBlob,
        width: decoded.workingWidth,
        height: decoded.workingHeight,
        originalBlob: decoded.decodedBlob,
        originalWidth: decoded.width,
        originalHeight: decoded.height,
        scaleX: decoded.width / Math.max(1, decoded.workingWidth),
        scaleY: decoded.height / Math.max(1, decoded.workingHeight)
      });
    },
    [setWorkingImage]
  );

  const handleFile = useCallback(
    async (slot: SlotKey, file: File) => {
      if (intakeMode !== 'simple') {
        resetWorkflow('simple');
        setShowBatch(false);
        setBatchState('idle');
        setBatchMessage('Select a folder containing one-card front and back scans.');
      }

      const token = createToken();
      updateSlot(slot, (current) => {
        releaseSlot(current);
        return { status: 'loading', token };
      });

      try {
        const decoded = await decodeImage(file);

        updateSlot(slot, (current) => {
          if (current.token !== token) {
            decoded.decodedBitmap.close();
            decoded.workingBitmap.close();
            return current;
          }
          releaseSlot(current);
          return {
            status: 'ready',
            token,
            file,
            decoded
          };
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Unable to decode this image.';
        updateSlot(slot, (current) => {
          releaseSlot(current);
          return { status: 'error', error: message };
        });
      }
    },
    [intakeMode, resetWorkflow, updateSlot]
  );

  useEffect(() => {
    const primary = slots.primary;
    const secondary = slots.secondary;
    if (
      primary.status === 'ready' &&
      secondary.status === 'ready' &&
      primary.file &&
      secondary.file &&
      primary.decoded &&
      secondary.decoded
    ) {
      const primaryAsset = toAsset(primary.file);
      const secondaryAsset = toAsset(secondary.file);
      resetWorkflow('simple');
      setFiles([primaryAsset, secondaryAsset]);
      setSourcePairs([
        {
          id: `source-${primaryAsset.id}-${secondaryAsset.id}`,
          primaryFileId: primaryAsset.id,
          secondaryFileId: secondaryAsset.id,
          status: 'confirmed',
          matchType: 'manual',
          confidence: 1,
          reason: 'Selected directly in the two-file upload flow.'
        }
      ]);
      setSkippedFileIds([]);
      stashDecodedImage(primaryAsset, primary.decoded);
      stashDecodedImage(secondaryAsset, secondary.decoded);
    }
  }, [resetWorkflow, setFiles, setSkippedFileIds, setSourcePairs, slots, stashDecodedImage]);

  const handleBatchOpen = useCallback(() => {
    resetWorkflow('batch');
    releaseSlot(slots.primary);
    releaseSlot(slots.secondary);
    setSlots({
      primary: { status: 'empty' },
      secondary: { status: 'empty' }
    });
    setShowBatch(true);
    folderInputRef.current?.click();
  }, [resetWorkflow, slots.primary, slots.secondary]);

  const handleBatchFiles = useCallback(
    async (selectedFiles: File[]) => {
      if (selectedFiles.length === 0) {
        return;
      }

      resetWorkflow('batch');
      setShowBatch(true);
      setBatchState('loading');
      setBatchMessage(`Preparing ${selectedFiles.length} file${selectedFiles.length === 1 ? '' : 's'}...`);

      const preparedAssets: FileAsset[] = [];
      const decodedEntries: Array<{ asset: FileAsset; decoded: DecodedImage }> = [];

      try {
        for (const file of selectedFiles) {
          const decoded = await decodeImage(file);
          const asset = toAsset(file);
          preparedAssets.push(asset);
          decodedEntries.push({ asset, decoded });
        }

        const matched = autoMatchBatchFiles(preparedAssets);
        setFiles(matched.files);
        setSourcePairs(matched.sourcePairs);
        setSkippedFileIds([]);
        decodedEntries.forEach(({ asset, decoded }) => {
          stashDecodedImage(asset, decoded);
          decoded.decodedBitmap.close();
          decoded.workingBitmap.close();
        });
        setBatchState('ready');
        setBatchMessage(
          `Found ${matched.sourcePairs.length} suggested pair${matched.sourcePairs.length === 1 ? '' : 's'} and ${matched.unmatchedFileIds.length} unmatched file${matched.unmatchedFileIds.length === 1 ? '' : 's'}.`
        );
      } catch (error) {
        decodedEntries.forEach(({ decoded }) => {
          decoded.decodedBitmap.close();
          decoded.workingBitmap.close();
        });
        setBatchState('error');
        setBatchMessage(error instanceof Error ? error.message : 'Unable to prepare this folder.');
      }
    },
    [resetWorkflow, setFiles, setSkippedFileIds, setSourcePairs, stashDecodedImage]
  );

  const handleFolderInputChange = useCallback(
    (event: ChangeEvent<HTMLInputElement>) => {
      const nextFiles = Array.from(event.target.files ?? []);
      const supported = nextFiles.filter((file) => file.type.startsWith('image/') || /\.(jpe?g|png|heic|heif|avif)$/i.test(file.name));
      void handleBatchFiles(supported);
      event.target.value = '';
    },
    [handleBatchFiles]
  );

  const bothReady = slots.primary.status === 'ready' && slots.secondary.status === 'ready';
  const readyForNext = intakeMode === 'batch' ? batchState === 'ready' && files.length > 0 : bothReady;
  const unmatchedCount = Math.max(0, files.length - sourcePairs.length * 2 - skippedFileIds.length);

  return (
    <Stack gap={24}>
      <Stack gap={8}>
        <Text as="h2" variant="title">
          Add front and back scans
        </Text>
        <Text variant="body">Start with one front and one back, or switch to batch if you already have a folder of scans.</Text>
      </Stack>
      <BannerChromium compact />

      {!showBatch && (
        <>
          <div className="upload-grid" role="group" aria-label="Photo upload options">
            <Dropzone
              label="Front photo"
              description="Add the front scan"
              slotKey="primary"
              state={slots.primary}
              onFile={handleFile}
            />
            <Dropzone
              label="Back photo"
              description="Add the back scan"
              slotKey="secondary"
              state={slots.secondary}
              onFile={handleFile}
            />
          </div>
          <div className="upload-batchCallout">
            <Text variant="muted">Have a folder instead?</Text>
            <Button type="button" variant="ghost" onClick={handleBatchOpen}>
              Batch upload folder
            </Button>
          </div>
        </>
      )}

      {showBatch && (
        <Stack gap={16} className="batch-upload">
          <div className="batch-upload__header">
            <Stack gap={6}>
              <Text as="h3" variant="label">
                Batch folder
              </Text>
              <Text variant="body">{batchMessage}</Text>
            </Stack>
            <Stack direction="row" gap={8}>
              <Button type="button" onClick={() => folderInputRef.current?.click()}>
                Choose folder
              </Button>
              <Button
                type="button"
                variant="ghost"
                onClick={() => {
                  resetWorkflow('simple');
                  setShowBatch(false);
                  setBatchState('idle');
                  setBatchMessage('Select a folder containing one-card front and back scans.');
                }}
              >
                Back to simple upload
              </Button>
            </Stack>
          </div>
          <Text variant="muted" className="batch-upload__status">
            {files.length > 0
              ? `${files.length} files loaded • ${sourcePairs.length} suggested pairs • ${unmatchedCount} unmatched`
              : 'Choose a folder to prepare matches for review.'}
          </Text>
        </Stack>
      )}

      <Text variant="muted">Working copies are capped at {WORKING_COPY_SIZE}px for speed. Originals stay available for export.</Text>

      <input
        ref={folderInputRef}
        type="file"
        multiple
        accept={ACCEPT}
        className="upload-dropzone__input"
        onChange={handleFolderInputChange}
        {...({ webkitdirectory: '', directory: '' } as Record<string, string>)}
      />

      <StepNavigation
        step="files"
        nextLabel={intakeMode === 'batch' ? 'Review source pairs' : 'Review detections'}
        nextDisabled={!readyForNext}
      />
    </Stack>
  );
};
