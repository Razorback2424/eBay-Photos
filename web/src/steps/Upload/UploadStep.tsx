import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { ChangeEvent, DragEvent, KeyboardEvent } from 'react';
import clsx from 'clsx';

import { StepNavigation } from '../../components/StepNavigation';
import { Stack } from '../../ui/Stack';
import { Text } from '../../ui/Text';
import { FileAsset, useSessionStore } from '../../state/session';
import { decodeImage, DecodedImage } from '../../utils/images/decodeImage';

const ACCEPT = 'image/jpeg,image/png,image/heic,image/heif,image/avif';
type PickerAccept = NonNullable<OpenFilePickerOptions['types']>[number];
const FILE_TYPES: PickerAccept[] = [
  {
    description: 'Images',
    accept: {
      'image/*': ['.jpg', '.jpeg', '.png', '.heic', '.heif', '.avif']
    }
  }
];
const WORKING_COPY_SIZE = 2500;

const toAsset = (file: File): FileAsset => ({
  id: `${file.name}-${file.size}-${file.lastModified}`,
  name: file.name,
  size: file.size,
  type: file.type,
  lastModified: file.lastModified
});

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
  if (!state) return;
  if (state.decoded) {
    state.decoded.decodedBitmap.close();
    state.decoded.workingBitmap.close();
  }
};

declare global {
  interface Window {
    showOpenFilePicker?: (options?: OpenFilePickerOptions) => Promise<FileSystemFileHandle[]>;
  }
}

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
      if (previewBitmap) {
        previewBitmap.close();
      }
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
  pickerSupported: boolean;
  onFile: (slot: SlotKey, file: File) => void;
  onError: (slot: SlotKey, message: string) => void;
}

const Dropzone = ({ label, description, slotKey, state, pickerSupported, onFile, onError }: DropzoneProps) => {
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [isDragActive, setIsDragActive] = useState(false);

  const openPicker = useCallback(async () => {
    if (pickerSupported && typeof window.showOpenFilePicker === 'function') {
      try {
        const handles = await window.showOpenFilePicker({
          multiple: false,
          excludeAcceptAllOption: true,
          types: FILE_TYPES
        });
        const handle = handles[0];
        if (!handle) return;
        const file = await handle.getFile();
        onFile(slotKey, file);
      } catch (error) {
        if ((error as DOMException)?.name === 'AbortError') {
          return;
        }
        onError(slotKey, 'Unable to open file picker.');
      }
      return;
    }

    inputRef.current?.click();
  }, [pickerSupported, slotKey, onError, onFile]);

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

  const handleDragOver = useCallback((event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    if (!isDragActive) {
      setIsDragActive(true);
    }
  }, [isDragActive]);

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
      return 'Decoding image…';
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

export const UploadStep = () => {
  const pickerSupported = typeof window !== 'undefined' && typeof window.showOpenFilePicker === 'function';

  const [slots, setSlots] = useState<Record<SlotKey, SlotState>>({
    primary: { status: 'empty' },
    secondary: { status: 'empty' }
  });

  const { setFiles, setWorkingImage, clearWorkingImages } = useSessionStore((state) => ({
    setFiles: state.setFiles,
    setWorkingImage: state.setWorkingImage,
    clearWorkingImages: state.clearWorkingImages
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
      const newState = typeof next === 'function' ? (next as (current: SlotState) => SlotState)(current) : next;
      return {
        ...prev,
        [slot]: newState
      };
    });
  }, []);

  const setError = useCallback((slot: SlotKey, message: string) => {
    updateSlot(slot, (current) => {
      releaseSlot(current);
      return { status: 'error', error: message };
    });
  }, [updateSlot]);

  const handleFile = useCallback(
    async (slot: SlotKey, file: File) => {
      const token = createToken();
      updateSlot(slot, (current) => {
        releaseSlot(current);
        return { status: 'loading', token };
      });

      try {
        const decoded = await decodeImage(file);

        updateSlot(slot, (current) => {
          if (current.token !== token) {
            releaseSlot({ status: 'ready', decoded });
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
    [updateSlot]
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
      setFiles([primaryAsset, secondaryAsset]);
      clearWorkingImages();
      setWorkingImage(primaryAsset.id, {
        blob: primary.decoded.workingBlob,
        width: primary.decoded.workingWidth,
        height: primary.decoded.workingHeight,
        originalBlob: primary.decoded.decodedBlob,
        originalWidth: primary.decoded.width,
        originalHeight: primary.decoded.height,
        scaleX: primary.decoded.width / Math.max(1, primary.decoded.workingWidth),
        scaleY: primary.decoded.height / Math.max(1, primary.decoded.workingHeight)
      });
      setWorkingImage(secondaryAsset.id, {
        blob: secondary.decoded.workingBlob,
        width: secondary.decoded.workingWidth,
        height: secondary.decoded.workingHeight,
        originalBlob: secondary.decoded.decodedBlob,
        originalWidth: secondary.decoded.width,
        originalHeight: secondary.decoded.height,
        scaleX: secondary.decoded.width / Math.max(1, secondary.decoded.workingWidth),
        scaleY: secondary.decoded.height / Math.max(1, secondary.decoded.workingHeight)
      });
    } else {
      setFiles([]);
      clearWorkingImages();
    }
  }, [slots, setFiles, setWorkingImage, clearWorkingImages]);

  const bothReady = slots.primary.status === 'ready' && slots.secondary.status === 'ready';

  return (
    <Stack gap={24}>
      <Stack gap={8}>
        <Text as="h2" variant="title">
          Upload both sides of your product
        </Text>
        <Text variant="body">
          Drag in the hero shot and the secondary angle. Images stay on this device; we only keep lightweight metadata
          while you work.
        </Text>
      </Stack>
      <div className="upload-grid" role="group" aria-label="Photo upload options">
        <Dropzone
          label="Primary photo"
          description="Add the main catalog image"
          slotKey="primary"
          state={slots.primary}
          pickerSupported={pickerSupported}
          onFile={handleFile}
          onError={setError}
        />
        <Dropzone
          label="Secondary photo"
          description="Add a supporting angle or detail"
          slotKey="secondary"
          state={slots.secondary}
          pickerSupported={pickerSupported}
          onFile={handleFile}
          onError={setError}
        />
      </div>
      <Stack gap={4}>
        <Text as="h3" variant="label">
          Working copies
        </Text>
        <Text variant="muted">
          We create a {WORKING_COPY_SIZE}px working copy to keep the experience fast while preserving your originals for
          export.
        </Text>
      </Stack>
      <StepNavigation step="files" nextLabel="Review detections" nextDisabled={!bothReady} />
    </Stack>
  );
};
