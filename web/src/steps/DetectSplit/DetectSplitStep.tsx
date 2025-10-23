import { useEffect, useMemo, useRef, useState } from 'react';

import { StepNavigation } from '../../components/StepNavigation';
import { useSessionStore } from '../../state/session';
import { Stack } from '../../ui/Stack';
import { Text } from '../../ui/Text';
import type { DetectedCard } from '../../types/detections';
import type { Detection } from '../../state/session';
import { releaseProxy, transfer, wrap } from 'comlink';
import type { Endpoint } from 'comlink';

type DetectionWorker = {
  detect: (image: ImageBitmap) => Promise<DetectedCard[]>;
};

type DetectionStatus = 'idle' | 'pending' | 'ready' | 'error';

type WorkerProxy = DetectionWorker & {
  [releaseProxy]?: () => void;
};

const workerUrl = new URL('../../workers/detection.worker.ts', import.meta.url);
const MAX_PREVIEW_EDGE = 720;
const THUMBNAIL_MAX_EDGE = 220;

interface DetectionPreviewProps {
  working: {
    blob: Blob;
    width: number;
    height: number;
  };
  detections: DetectedCard[];
  status: DetectionStatus;
}

const FrontDetectionPreview = ({ working, detections, status }: DetectionPreviewProps) => {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) {
      return;
    }
    let cancelled = false;
    let bitmap: ImageBitmap | null = null;

    const draw = async () => {
      const ctx = canvas.getContext('2d');
      if (!ctx) {
        return;
      }
      const scale = Math.min(1, MAX_PREVIEW_EDGE / Math.max(working.width, working.height));
      const width = Math.max(1, Math.round(working.width * scale));
      const height = Math.max(1, Math.round(working.height * scale));
      canvas.width = width;
      canvas.height = height;

      const image = await createImageBitmap(working.blob);
      if (cancelled) {
        image.close();
        return;
      }
      bitmap = image;
      ctx.clearRect(0, 0, width, height);
      ctx.drawImage(image, 0, 0, width, height);

      ctx.lineWidth = 2;
      ctx.strokeStyle = 'rgba(37, 99, 235, 0.9)';
      ctx.fillStyle = 'rgba(37, 99, 235, 0.2)';
      detections.forEach((detection, index) => {
        const x = detection.bbox.x * scale;
        const y = detection.bbox.y * scale;
        const w = detection.bbox.width * scale;
        const h = detection.bbox.height * scale;
        ctx.beginPath();
        ctx.rect(x, y, w, h);
        ctx.fill();
        ctx.stroke();

        const label = `${index + 1}`;
        ctx.font = '600 18px Inter, system-ui, sans-serif';
        ctx.textBaseline = 'top';
        ctx.lineWidth = 4;
        ctx.strokeStyle = 'rgba(15, 23, 42, 0.7)';
        ctx.strokeText(label, x + 8, y + 8);
        ctx.fillStyle = '#ffffff';
        ctx.fillText(label, x + 8, y + 8);
        ctx.strokeStyle = 'rgba(37, 99, 235, 0.9)';
        ctx.fillStyle = 'rgba(37, 99, 235, 0.2)';
      });

      if (status === 'pending') {
        ctx.fillStyle = 'rgba(15, 23, 42, 0.25)';
        ctx.fillRect(0, 0, width, height);
      }
    };

    draw().catch(() => {
      if (bitmap) {
        bitmap.close();
      }
    });

    return () => {
      cancelled = true;
      if (bitmap) {
        bitmap.close();
      }
    };
  }, [working.blob, working.width, working.height, detections, status]);

  return <canvas ref={canvasRef} className="detect-preview__canvas" aria-label="Primary detections" />;
};

interface DetectionThumbnailProps {
  detection: DetectedCard;
  index: number;
  working: {
    blob: Blob;
  };
}

const DetectionThumbnail = ({ detection, index, working }: DetectionThumbnailProps) => {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) {
      return;
    }
    let cancelled = false;
    let bitmap: ImageBitmap | null = null;

    const draw = async () => {
      const ctx = canvas.getContext('2d');
      if (!ctx) {
        return;
      }
      const scale = Math.min(1, THUMBNAIL_MAX_EDGE / Math.max(detection.bbox.width, detection.bbox.height));
      const width = Math.max(1, Math.round(detection.bbox.width * scale));
      const height = Math.max(1, Math.round(detection.bbox.height * scale));
      canvas.width = width;
      canvas.height = height;

      const image = await createImageBitmap(working.blob);
      if (cancelled) {
        image.close();
        return;
      }
      bitmap = image;
      ctx.clearRect(0, 0, width, height);
      ctx.drawImage(image, detection.bbox.x, detection.bbox.y, detection.bbox.width, detection.bbox.height, 0, 0, width, height);
      ctx.fillStyle = 'rgba(37, 99, 235, 0.2)';
      ctx.fillRect(0, 0, width, height);

      const label = `${index + 1}`;
      ctx.font = '600 20px Inter, system-ui, sans-serif';
      ctx.textBaseline = 'top';
      ctx.lineWidth = 4;
      ctx.strokeStyle = 'rgba(15, 23, 42, 0.7)';
      ctx.strokeText(label, 8, 8);
      ctx.fillStyle = '#ffffff';
      ctx.fillText(label, 8, 8);
    };

    draw().catch(() => {
      if (bitmap) {
        bitmap.close();
      }
    });

    return () => {
      cancelled = true;
      if (bitmap) {
        bitmap.close();
      }
    };
  }, [working.blob, detection.bbox.x, detection.bbox.y, detection.bbox.width, detection.bbox.height, index]);

  return (
    <div className="detection-thumbnail">
      <canvas ref={canvasRef} className="detection-thumbnail__canvas" aria-label={`Detection ${index + 1}`} />
      <span className="detection-thumbnail__label">Detection {index + 1}</span>
    </div>
  );
};

export const DetectSplitStep = () => {
  const { files, workingImages, detectedCards, setDetectedCards, setDetections } = useSessionStore((state) => ({
    files: state.files,
    workingImages: state.workingImages,
    detectedCards: state.detectedCards,
    setDetectedCards: state.setDetectedCards,
    setDetections: state.setDetections
  }));

  const frontFile = files[0];
  const backFile = files[1];
  const frontWorking = frontFile ? workingImages[frontFile.id] : undefined;
  const backWorking = backFile ? workingImages[backFile.id] : undefined;

  const frontDetections = frontFile ? detectedCards[frontFile.id] ?? [] : [];

  const [frontStatus, setFrontStatus] = useState<DetectionStatus>(frontDetections.length > 0 ? 'ready' : 'idle');
  const [frontError, setFrontError] = useState<string | null>(null);
  const [backStatus, setBackStatus] = useState<DetectionStatus>('idle');
  const [backError, setBackError] = useState<string | null>(null);

  const workerRef = useRef<Worker | null>(null);
  const proxyRef = useRef<WorkerProxy | null>(null);
  const [workerReady, setWorkerReady] = useState(false);

  useEffect(() => {
    const worker = new Worker(workerUrl, { type: 'module' });
    workerRef.current = worker;
    const endpoint = worker as unknown as Endpoint;
    proxyRef.current = wrap<DetectionWorker>(endpoint) as WorkerProxy;
    setWorkerReady(true);

    return () => {
      proxyRef.current?.[releaseProxy]?.();
      proxyRef.current = null;
      setWorkerReady(false);
      workerRef.current?.terminate();
      workerRef.current = null;
    };
  }, []);

  useEffect(() => {
    if (!frontWorking) {
      setFrontStatus('idle');
      setFrontError(null);
    }
    if (!backWorking) {
      setBackStatus('idle');
      setBackError(null);
    }
  }, [frontWorking, backWorking]);

  useEffect(() => {
    if (!workerReady || !frontFile || !frontWorking) {
      return;
    }
    if (frontStatus === 'error') {
      return;
    }
    if (frontDetections.length > 0) {
      setFrontStatus('ready');
      return;
    }

    let cancelled = false;
    const proxy = proxyRef.current;
    if (!proxy) {
      return;
    }

    setFrontStatus('pending');
    setFrontError(null);

    (async () => {
      try {
        const bitmap = await createImageBitmap(frontWorking.blob);
        const detections = await proxy.detect(transfer(bitmap, [bitmap]));
        if (cancelled) {
          return;
        }
        setDetectedCards(frontFile.id, detections);
        setFrontStatus('ready');
      } catch (error) {
        if (cancelled) {
          return;
        }
        setFrontStatus('error');
        setFrontError(error instanceof Error ? error.message : 'Detection failed.');
        setDetectedCards(frontFile.id, []);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [workerReady, frontFile, frontWorking, frontDetections.length, frontStatus, setDetectedCards]);

  useEffect(() => {
    if (!workerReady || !backFile || !backWorking) {
      return;
    }
    if (backStatus === 'error') {
      return;
    }

    let cancelled = false;
    const proxy = proxyRef.current;
    if (!proxy) {
      return;
    }

    setBackStatus('pending');
    setBackError(null);

    (async () => {
      try {
        const bitmap = await createImageBitmap(backWorking.blob);
        const detections = await proxy.detect(transfer(bitmap, [bitmap]));
        if (cancelled) {
          return;
        }
        setDetectedCards(backFile.id, detections);
        setBackStatus('ready');
      } catch (error) {
        if (cancelled) {
          return;
        }
        setBackStatus('error');
        setBackError(error instanceof Error ? error.message : 'Detection failed.');
        setDetectedCards(backFile.id, []);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [workerReady, backFile, backWorking, backStatus, setDetectedCards]);

  const thumbnails = useMemo(() => {
    if (!frontWorking || frontDetections.length === 0) {
      return null;
    }
    return frontDetections.map((detection, index) => (
      <DetectionThumbnail key={`${detection.bbox.x}-${detection.bbox.y}-${index}`} detection={detection} index={index} working={frontWorking} />
    ));
  }, [frontDetections, frontWorking]);

  useEffect(() => {
    const detectionList: Detection[] = [];
    for (const [fileId, cards] of Object.entries(detectedCards)) {
      const working = workingImages[fileId];
      if (!working) {
        continue;
      }
      const width = Math.max(1, working.width);
      const height = Math.max(1, working.height);
      cards.forEach((card, index) => {
        const x1 = Math.max(0, Math.min(1, card.bbox.x / width));
        const y1 = Math.max(0, Math.min(1, card.bbox.y / height));
        const x2 = Math.max(0, Math.min(1, (card.bbox.x + card.bbox.width) / width));
        const y2 = Math.max(0, Math.min(1, (card.bbox.y + card.bbox.height) / height));
        detectionList.push({
          id: `${fileId}-card-${index}`,
          fileId,
          label: 'Card',
          confidence: 1,
          bounds: [x1, y1, x2, y2],
          accepted: true
        });
      });
    }
    setDetections(detectionList);
  }, [detectedCards, workingImages, setDetections]);

  return (
    <Stack gap={24}>
      <Stack gap={8}>
        <Text as="h2" variant="title">
          Review detections
        </Text>
        <Text variant="body">
          We analyse working copies to find card boundaries. Confirm the primary detections before pairing photos.
        </Text>
      </Stack>
      <div className="detect-preview">
        <div>
          <Text as="h3" variant="label">
            Primary photo
          </Text>
          {frontWorking ? (
            <Stack gap={12}>
              <div className="detect-preview__canvasWrapper">
                <FrontDetectionPreview working={frontWorking} detections={frontDetections} status={frontStatus} />
                {frontStatus === 'pending' && (
                  <span className="detect-preview__status" role="status">
                    Detecting primary photo…
                  </span>
                )}
                {frontStatus === 'error' && frontError && (
                  <span className="detect-preview__status detect-preview__status--error" role="alert">
                    {frontError}
                  </span>
                )}
              </div>
              {frontStatus === 'ready' && frontDetections.length === 0 && (
                <Text variant="muted">No cards detected in the primary image.</Text>
              )}
              {thumbnails && thumbnails.length > 0 && <div className="detection-thumbnails">{thumbnails}</div>}
            </Stack>
          ) : (
            <Text variant="muted">Add a primary photo to run detection.</Text>
          )}
        </div>
        <div>
          <Text as="h3" variant="label">
            Secondary photo
          </Text>
          {backWorking ? (
            <Stack gap={8}>
              {backStatus === 'pending' && <Text variant="muted">Detecting secondary photo…</Text>}
              {backStatus === 'ready' && (
                <Text variant="muted">
                  {detectedCards[backFile!.id]?.length ?? 0} possible card{(detectedCards[backFile!.id]?.length ?? 0) === 1 ? '' : 's'} found.
                </Text>
              )}
              {backStatus === 'error' && backError && (
                <Text variant="muted" role="alert">
                  {backError}
                </Text>
              )}
            </Stack>
          ) : (
            <Text variant="muted">Add a secondary photo to include it in detection.</Text>
          )}
        </div>
      </div>
      <StepNavigation step="detections" nextLabel="Pair imagery" nextDisabled={frontStatus === 'pending'} />
    </Stack>
  );
};
