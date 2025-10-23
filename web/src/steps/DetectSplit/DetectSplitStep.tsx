import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { PointerEvent } from 'react';

import { StepNavigation } from '../../components/StepNavigation';
import { ManualDetectionAdjustment, useSessionStore } from '../../state/session';
import { Button } from '../../ui/Button';
import { Spinner } from '../../ui/Spinner';
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

interface FrontDetectionPreviewProps extends DetectionPreviewProps {
  manual: ManualDetectionAdjustment[];
  inactive: number[];
  showAdjust: boolean;
  onAddManual: (card: DetectedCard) => void;
}

const useDelayedVisibility = (active: boolean, delayMs: number) => {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | null = null;
    if (active) {
      timer = setTimeout(() => {
        setVisible(true);
      }, delayMs);
    } else {
      setVisible(false);
    }

    return () => {
      if (timer) {
        clearTimeout(timer);
      }
    };
  }, [active, delayMs]);

  return visible;
};

const FrontDetectionPreview = ({
  working,
  detections,
  manual,
  inactive,
  status,
  showAdjust,
  onAddManual
}: FrontDetectionPreviewProps) => {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const overlayRef = useRef<HTMLDivElement | null>(null);
  const [draftRect, setDraftRect] = useState<{
    x: number;
    y: number;
    width: number;
    height: number;
  } | null>(null);
  const startRef = useRef<{
    x: number;
    y: number;
    boundsWidth: number;
    boundsHeight: number;
  } | null>(null);

  const drawPreview = useCallback(async () => {
    const canvas = canvasRef.current;
    if (!canvas) {
      return;
    }
    const ctx = canvas.getContext('2d');
    if (!ctx) {
      return;
    }
    const image = await createImageBitmap(working.blob);
    const scale = Math.min(1, MAX_PREVIEW_EDGE / Math.max(working.width, working.height));
    const width = Math.max(1, Math.round(working.width * scale));
    const height = Math.max(1, Math.round(working.height * scale));
    canvas.width = width;
    canvas.height = height;

    ctx.clearRect(0, 0, width, height);
    ctx.drawImage(image, 0, 0, width, height);
    image.close();

    const inactiveSet = new Set(inactive);
    const items = [
      ...detections.map((card, index) => ({
        card,
        label: `${index + 1}`,
        active: !inactiveSet.has(index),
        source: 'auto' as const
      })),
      ...manual.map((entry, index) => ({
        card: entry.card,
        label: `M${index + 1}`,
        active: true,
        source: 'manual' as const
      }))
    ];

    items.forEach((item) => {
      const { card, label, active, source } = item;
      const x = card.bbox.x * scale;
      const y = card.bbox.y * scale;
      const w = card.bbox.width * scale;
      const h = card.bbox.height * scale;
      ctx.beginPath();
      ctx.rect(x, y, w, h);
      if (source === 'manual') {
        ctx.strokeStyle = 'rgba(22, 163, 74, 0.9)';
        ctx.fillStyle = 'rgba(34, 197, 94, 0.2)';
      } else if (!active) {
        ctx.strokeStyle = 'rgba(148, 163, 184, 0.9)';
        ctx.fillStyle = 'rgba(148, 163, 184, 0.18)';
      } else {
        ctx.strokeStyle = 'rgba(37, 99, 235, 0.9)';
        ctx.fillStyle = 'rgba(37, 99, 235, 0.2)';
      }
      ctx.fill();
      ctx.stroke();

      ctx.font = '600 18px Inter, system-ui, sans-serif';
      ctx.textBaseline = 'top';
      ctx.lineWidth = 4;
      ctx.strokeStyle = 'rgba(15, 23, 42, 0.7)';
      ctx.strokeText(label, x + 8, y + 8);
      ctx.fillStyle = '#ffffff';
      ctx.fillText(label, x + 8, y + 8);
    });

    if (status === 'pending') {
      ctx.fillStyle = 'rgba(15, 23, 42, 0.25)';
      ctx.fillRect(0, 0, width, height);
    }
  }, [detections, inactive, manual, status, working.blob, working.height, working.width]);

  useEffect(() => {
    let cancelled = false;
    let drawing: Promise<void> | null = null;

    const run = async () => {
      if (cancelled) return;
      await drawPreview();
    };
    drawing = run();

    return () => {
      cancelled = true;
      if (drawing) {
        drawing.catch(() => {
          /* ignore */
        });
      }
    };
  }, [drawPreview]);

  const handlePointerDown = useCallback(
    (event: PointerEvent<HTMLDivElement>) => {
      if (!showAdjust) {
        return;
      }
      const overlay = overlayRef.current;
      if (!overlay) {
        return;
      }
      overlay.setPointerCapture(event.pointerId);
      const bounds = overlay.getBoundingClientRect();
      const x = Math.max(0, Math.min(bounds.width, event.clientX - bounds.left));
      const y = Math.max(0, Math.min(bounds.height, event.clientY - bounds.top));
      startRef.current = { x, y, boundsWidth: bounds.width, boundsHeight: bounds.height };
      setDraftRect({ x, y, width: 0, height: 0 });
    },
    [showAdjust]
  );

  const handlePointerMove = useCallback((event: PointerEvent<HTMLDivElement>) => {
    const overlay = overlayRef.current;
    const start = startRef.current;
    if (!overlay || !start) {
      return;
    }
    const bounds = overlay.getBoundingClientRect();
    const x = Math.max(0, Math.min(bounds.width, event.clientX - bounds.left));
    const y = Math.max(0, Math.min(bounds.height, event.clientY - bounds.top));
    const rectX = Math.min(start.x, x);
    const rectY = Math.min(start.y, y);
    const rectW = Math.abs(start.x - x);
    const rectH = Math.abs(start.y - y);
    setDraftRect({ x: rectX, y: rectY, width: rectW, height: rectH });
  }, []);

  const commitManualDetection = useCallback(
    (event: PointerEvent<HTMLDivElement>) => {
      const overlay = overlayRef.current;
      const start = startRef.current;
      if (!overlay || !start) {
        setDraftRect(null);
        return;
      }
      overlay.releasePointerCapture(event.pointerId);
      const bounds = overlay.getBoundingClientRect();
      const x = Math.max(0, Math.min(bounds.width, event.clientX - bounds.left));
      const y = Math.max(0, Math.min(bounds.height, event.clientY - bounds.top));
      const rectX = Math.min(start.x, x);
      const rectY = Math.min(start.y, y);
      const rectW = Math.abs(start.x - x);
      const rectH = Math.abs(start.y - y);
      setDraftRect(null);
      startRef.current = null;

      if (rectW < 10 || rectH < 10) {
        return;
      }

      const scaleX = working.width / bounds.width;
      const scaleY = working.height / bounds.height;
      const bbox = {
        x: rectX * scaleX,
        y: rectY * scaleY,
        width: rectW * scaleX,
        height: rectH * scaleY
      };
      const manualCard: DetectedCard = {
        bbox,
        quad: [
          [bbox.x, bbox.y],
          [bbox.x + bbox.width, bbox.y],
          [bbox.x + bbox.width, bbox.y + bbox.height],
          [bbox.x, bbox.y + bbox.height]
        ],
        centerNorm: [
          (bbox.x + bbox.width / 2) / Math.max(1, working.width),
          (bbox.y + bbox.height / 2) / Math.max(1, working.height)
        ],
        warpSize: {
          width: Math.max(1, Math.round(bbox.width)),
          height: Math.max(1, Math.round(bbox.height))
        }
      };
      onAddManual(manualCard);
    },
    [onAddManual, working.height, working.width]
  );

  const handlePointerUp = useCallback(
    (event: PointerEvent<HTMLDivElement>) => {
      if (!showAdjust) {
        return;
      }
      commitManualDetection(event);
    },
    [commitManualDetection, showAdjust]
  );

  const handlePointerLeave = useCallback(
    (event: PointerEvent<HTMLDivElement>) => {
      if (!showAdjust) {
        return;
      }
      commitManualDetection(event);
    },
    [commitManualDetection, showAdjust]
  );

  return (
    <div className="detect-preview__canvasWrapper">
      <canvas ref={canvasRef} className="detect-preview__canvas" aria-label="Primary detections" />
      <div
        ref={overlayRef}
        className={`detect-preview__overlay${showAdjust ? ' detect-preview__overlay--active' : ''}`}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerLeave={handlePointerLeave}
        role="presentation"
        aria-hidden={!showAdjust}
      >
        {draftRect && showAdjust && (
          <div
            className="detect-preview__draft"
            style={{
              left: `${draftRect.x}px`,
              top: `${draftRect.y}px`,
              width: `${draftRect.width}px`,
              height: `${draftRect.height}px`
            }}
          />
        )}
      </div>
    </div>
  );
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
  const {
    files,
    workingImages,
    detectedCards,
    detectionAdjustments,
    setDetectedCards,
    setDetections,
    toggleDetectionActive,
    addManualDetection,
    removeManualDetection
  } = useSessionStore((state) => ({
    files: state.files,
    workingImages: state.workingImages,
    detectedCards: state.detectedCards,
    detectionAdjustments: state.detectionAdjustments,
    setDetectedCards: state.setDetectedCards,
    setDetections: state.setDetections,
    toggleDetectionActive: state.toggleDetectionActive,
    addManualDetection: state.addManualDetection,
    removeManualDetection: state.removeManualDetection
  }));

  const frontFile = files[0];
  const backFile = files[1];
  const frontWorking = frontFile ? workingImages[frontFile.id] : undefined;
  const backWorking = backFile ? workingImages[backFile.id] : undefined;

  const frontDetections = frontFile ? detectedCards[frontFile.id] ?? [] : [];

  const [showAdjust, setShowAdjust] = useState(false);

  const frontAdjustments = frontFile ? detectionAdjustments[frontFile.id] : undefined;
  const frontManualDetections = frontAdjustments?.manual ?? [];
  const frontInactiveDetections = frontAdjustments?.disabledAuto ?? [];

  const [frontStatus, setFrontStatus] = useState<DetectionStatus>(frontDetections.length > 0 ? 'ready' : 'idle');
  const [frontError, setFrontError] = useState<string | null>(null);
  const [backStatus, setBackStatus] = useState<DetectionStatus>('idle');
  const [backError, setBackError] = useState<string | null>(null);
  const frontSpinnerVisible = useDelayedVisibility(frontStatus === 'pending', 300);
  const backSpinnerVisible = useDelayedVisibility(backStatus === 'pending', 300);

  const totalActiveDetections = useMemo(() => {
    const inactiveSet = new Set(frontInactiveDetections);
    const activeAuto = frontDetections.reduce((count, _, index) => {
      return inactiveSet.has(index) ? count : count + 1;
    }, 0);
    return activeAuto + frontManualDetections.length;
  }, [frontDetections, frontInactiveDetections, frontManualDetections]);

  const noDetectionsReady = frontStatus === 'ready' && totalActiveDetections === 0;

  const handleToggleAutoDetection = useCallback(
    (index: number) => {
      if (!frontFile) {
        return;
      }
      toggleDetectionActive(frontFile.id, index);
    },
    [frontFile, toggleDetectionActive]
  );

  const handleAddManualDetection = useCallback(
    (card: DetectedCard) => {
      if (!frontFile) {
        return;
      }
      addManualDetection(frontFile.id, card);
    },
    [addManualDetection, frontFile]
  );

  const handleRemoveManualDetection = useCallback(
    (manualId: string) => {
      if (!frontFile) {
        return;
      }
      removeManualDetection(frontFile.id, manualId);
    },
    [frontFile, removeManualDetection]
  );

  useEffect(() => {
    if (!frontWorking || frontStatus !== 'ready') {
      setShowAdjust(false);
    }
  }, [frontStatus, frontWorking]);

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
    const fileIds = new Set([
      ...Object.keys(detectedCards),
      ...Object.keys(detectionAdjustments)
    ]);

    for (const fileId of fileIds) {
      const working = workingImages[fileId];
      if (!working) {
        continue;
      }
      const width = Math.max(1, working.width);
      const height = Math.max(1, working.height);
      const cards = detectedCards[fileId] ?? [];
      const adjustments = detectionAdjustments[fileId];
      const disabledSet = new Set(adjustments?.disabledAuto ?? []);

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
          accepted: disabledSet.has(index) ? false : true
        });
      });

      adjustments?.manual.forEach((entry) => {
        const card = entry.card;
        const x1 = Math.max(0, Math.min(1, card.bbox.x / width));
        const y1 = Math.max(0, Math.min(1, card.bbox.y / height));
        const x2 = Math.max(0, Math.min(1, (card.bbox.x + card.bbox.width) / width));
        const y2 = Math.max(0, Math.min(1, (card.bbox.y + card.bbox.height) / height));
        detectionList.push({
          id: `${fileId}-manual-${entry.id}`,
          fileId,
          label: 'Card',
          confidence: 1,
          bounds: [x1, y1, x2, y2],
          accepted: true
        });
      });
    }

    setDetections(detectionList);
  }, [detectedCards, detectionAdjustments, workingImages, setDetections]);

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
                <FrontDetectionPreview
                  working={frontWorking}
                  detections={frontDetections}
                  manual={frontManualDetections}
                  inactive={frontInactiveDetections}
                  status={frontStatus}
                  showAdjust={showAdjust && frontStatus === 'ready'}
                  onAddManual={handleAddManualDetection}
                />
                {frontSpinnerVisible && (
                  <span className="detect-preview__status">
                    <Spinner size="sm" label="Detecting primary photo…" />
                  </span>
                )}
                {frontStatus === 'error' && frontError && (
                  <span className="detect-preview__status detect-preview__status--error" role="alert">
                    {frontError}
                  </span>
                )}
              </div>
              <Button
                type="button"
                variant="secondary"
                onClick={() => setShowAdjust((value) => !value)}
                disabled={!frontWorking || frontStatus !== 'ready'}
                aria-expanded={showAdjust && frontStatus === 'ready'}
              >
                {showAdjust ? 'Hide adjust detections' : 'Adjust detections'}
              </Button>
              {showAdjust && frontWorking && frontStatus === 'ready' && (
                <Stack gap={8} className="detection-adjustments" role="region" aria-label="Adjust detections">
                  <Text variant="muted">
                    Click detections below to deactivate or draw a rectangle on the preview to add missing cards.
                  </Text>
                  <div className="detection-adjustments__list">
                    {frontDetections.length > 0 ? (
                      frontDetections.map((_, index) => {
                        const inactive = frontInactiveDetections.includes(index);
                        return (
                          <button
                            key={`auto-${index}`}
                            type="button"
                            className={`detection-adjustments__toggle${inactive ? ' detection-adjustments__toggle--inactive' : ''}`}
                            onClick={() => handleToggleAutoDetection(index)}
                            aria-pressed={!inactive}
                          >
                            <span>Detection {index + 1}</span>
                            <span>{inactive ? 'Inactive' : 'Active'}</span>
                          </button>
                        );
                      })
                    ) : (
                      <Text variant="muted">No automatic detections available.</Text>
                    )}
                  </div>
                  {frontManualDetections.length > 0 && (
                    <Stack gap={4}>
                      <Text as="span" variant="label">
                        Manual additions
                      </Text>
                      <div className="detection-adjustments__manualList">
                        {frontManualDetections.map((item, index) => {
                          const width = Math.round(item.card.bbox.width);
                          const height = Math.round(item.card.bbox.height);
                          return (
                            <div key={item.id} className="detection-adjustments__manualItem">
                              <span>
                                Manual {index + 1}{' '}
                                <span className="detection-adjustments__manualSize">
                                  {width}×{height}px
                                </span>
                              </span>
                              <button type="button" onClick={() => handleRemoveManualDetection(item.id)}>
                                Remove
                              </button>
                            </div>
                          );
                        })}
                      </div>
                    </Stack>
                  )}
                </Stack>
              )}
              {noDetectionsReady && (
                <Text variant="muted" role="alert">
                  No active detections are available. Draw a manual rectangle or reactivate a detection to continue.
                </Text>
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
              <Text variant="muted">
                Secondary detections run automatically to help with pairing suggestions.
              </Text>
              {backSpinnerVisible && <Spinner size="sm" label="Detecting secondary photo…" />}
              {backStatus === 'ready' && (
                <Text variant="muted" aria-live="polite">
                  {detectedCards[backFile!.id]?.length ?? 0} potential card{(detectedCards[backFile!.id]?.length ?? 0) === 1 ? '' : 's'} identified on the back image.
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
      <StepNavigation
        step="detections"
        nextLabel="Pair imagery"
        nextDisabled={frontStatus !== 'ready' || totalActiveDetections === 0}
      />
    </Stack>
  );
};
