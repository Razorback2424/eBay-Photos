import { useCallback, useEffect, useMemo, useRef, useState, useId } from 'react';
import type { PointerEvent } from 'react';

import { StepNavigation } from '../../components/StepNavigation';
import { ManualDetectionAdjustment, useSessionStore } from '../../state/session';
import { Button } from '../../ui/Button';
import { Modal } from '../../ui/Modal';
import { Spinner } from '../../ui/Spinner';
import { Stack } from '../../ui/Stack';
import { Text } from '../../ui/Text';
import type { DetectedCard } from '../../types/detections';
import { detectCards } from '../../utils/detection/detectCards';

type DetectionStatus = 'idle' | 'pending' | 'ready' | 'error';
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
  const files = useSessionStore((state) => state.files);
  const sourcePairRecords = useSessionStore((state) => state.sourcePairs);
  const workingImages = useSessionStore((state) => state.workingImages);
  const detectedCards = useSessionStore((state) => state.detectedCards);
  const detectionAdjustments = useSessionStore((state) => state.detectionAdjustments);
  const setDetectedCards = useSessionStore((state) => state.setDetectedCards);
  const toggleDetectionActive = useSessionStore((state) => state.toggleDetectionActive);
  const addManualDetection = useSessionStore((state) => state.addManualDetection);
  const removeManualDetection = useSessionStore((state) => state.removeManualDetection);

  const sourcePairs = useMemo(() => sourcePairRecords.filter((pair) => pair.status === 'confirmed'), [sourcePairRecords]);

  const [activeSourcePairId, setActiveSourcePairId] = useState<string | null>(sourcePairs[0]?.id ?? null);
  const [statusByFileId, setStatusByFileId] = useState<Record<string, DetectionStatus>>({});
  const [errorByFileId, setErrorByFileId] = useState<Record<string, string | null>>({});
  const inFlightFileIdsRef = useRef<Set<string>>(new Set());
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  useEffect(() => {
    if (!sourcePairs.some((pair) => pair.id === activeSourcePairId)) {
      setActiveSourcePairId(sourcePairs[0]?.id ?? null);
    }
  }, [activeSourcePairId, sourcePairs]);

  const activeSourcePair = useMemo(
    () => sourcePairs.find((pair) => pair.id === activeSourcePairId) ?? sourcePairs[0] ?? null,
    [activeSourcePairId, sourcePairs]
  );

  const fileMap = useMemo(() => new Map(files.map((file) => [file.id, file])), [files]);
  const frontFile = activeSourcePair ? fileMap.get(activeSourcePair.primaryFileId) : files[0];
  const backFile = activeSourcePair ? fileMap.get(activeSourcePair.secondaryFileId) : files[1];
  const frontWorking = frontFile ? workingImages[frontFile.id] : undefined;
  const backWorking = backFile ? workingImages[backFile.id] : undefined;

  const frontDetections = useMemo(() => (frontFile ? detectedCards[frontFile.id] ?? [] : []), [frontFile, detectedCards]);
  const backDetections = useMemo(() => (backFile ? detectedCards[backFile.id] ?? [] : []), [backFile, detectedCards]);

  const [adjustDialogOpen, setAdjustDialogOpen] = useState(false);
  const adjustDialogId = useId();
  const adjustDialogTitleId = useId();
  const adjustDialogDescriptionId = useId();
  const adjustListLabelId = useId();

  const frontAdjustments = useMemo(
    () => (frontFile ? detectionAdjustments[frontFile.id] : undefined),
    [frontFile, detectionAdjustments]
  );
  const frontManualDetections = useMemo(() => frontAdjustments?.manual ?? [], [frontAdjustments]);
  const frontInactiveDetections = useMemo(() => frontAdjustments?.disabledAuto ?? [], [frontAdjustments]);

  const sourcePairFileIds = useMemo(
    () => Array.from(new Set(sourcePairs.flatMap((pair) => [pair.primaryFileId, pair.secondaryFileId]).filter(Boolean))),
    [sourcePairs]
  );

  const frontStatus = frontFile ? statusByFileId[frontFile.id] ?? (frontDetections.length > 0 ? 'ready' : 'idle') : 'idle';
  const frontError = frontFile ? errorByFileId[frontFile.id] ?? null : null;
  const backStatus = backFile ? statusByFileId[backFile.id] ?? (backDetections.length > 0 ? 'ready' : 'idle') : 'idle';
  const backError = backFile ? errorByFileId[backFile.id] ?? null : null;
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

  const updateFileStatus = useCallback((fileId: string, nextStatus: DetectionStatus) => {
    setStatusByFileId((current) => {
      if (current[fileId] === nextStatus) {
        return current;
      }
      return {
        ...current,
        [fileId]: nextStatus
      };
    });
  }, []);

  const updateFileError = useCallback((fileId: string, message: string | null) => {
    setErrorByFileId((current) => {
      if ((current[fileId] ?? null) === message) {
        return current;
      }
      return {
        ...current,
        [fileId]: message
      };
    });
  }, []);

  const renderPrimaryPreview = useCallback(
    (showOverlay: boolean) => {
      if (!frontWorking) {
        return null;
      }
      return (
        <div className="detect-preview__canvasWrapper">
          <FrontDetectionPreview
            working={frontWorking}
            detections={frontDetections}
            manual={frontManualDetections}
            inactive={frontInactiveDetections}
            status={frontStatus}
            showAdjust={showOverlay}
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
      );
    },
    [
      frontWorking,
      frontDetections,
      frontManualDetections,
      frontInactiveDetections,
      frontStatus,
      handleAddManualDetection,
      frontSpinnerVisible,
      frontError
    ]
  );

  useEffect(() => {
    if (!frontWorking || frontStatus !== 'ready') {
      setAdjustDialogOpen(false);
    }
  }, [frontStatus, frontWorking]);

  useEffect(() => {
    const readyFileIds = new Set(
      sourcePairFileIds.filter((fileId) => {
        const cards = detectedCards[fileId];
        return Array.isArray(cards) && cards.length > 0;
      })
    );

    readyFileIds.forEach((fileId) => {
      updateFileStatus(fileId, 'ready');
      updateFileError(fileId, null);
    });

    const pendingFileIds = sourcePairFileIds.filter((fileId) => {
      if (inFlightFileIdsRef.current.has(fileId)) {
        return false;
      }
      const working = workingImages[fileId];
      if (!working) {
        return false;
      }
      const hasDetectedEntry = Object.prototype.hasOwnProperty.call(detectedCards, fileId);
      if (hasDetectedEntry) {
        return false;
      }
      return !readyFileIds.has(fileId);
    });

    if (pendingFileIds.length === 0) {
      return;
    }

    pendingFileIds.forEach((fileId) => {
      const working = workingImages[fileId];
      if (!working) {
        return;
      }
      inFlightFileIdsRef.current.add(fileId);
      updateFileStatus(fileId, 'pending');
      updateFileError(fileId, null);

      void detectCards(working.blob)
        .then((detections) => {
          if (!mountedRef.current) {
            return;
          }
          setDetectedCards(fileId, detections);
          updateFileStatus(fileId, detections.length > 0 ? 'ready' : 'error');
          updateFileError(fileId, detections.length > 0 ? null : 'No cards detected.');
        })
        .catch((error) => {
          if (!mountedRef.current) {
            return;
          }
          console.error('[DetectSplitStep] Detection failed:', error);
          setDetectedCards(fileId, []);
          updateFileStatus(fileId, 'error');
          updateFileError(fileId, error instanceof Error ? error.message : 'Detection failed.');
        })
        .finally(() => {
          inFlightFileIdsRef.current.delete(fileId);
        });
    });
  }, [detectedCards, setDetectedCards, sourcePairFileIds, updateFileError, updateFileStatus, workingImages]);

  const thumbnails = useMemo(() => {
    if (!frontWorking || frontDetections.length === 0) {
      return null;
    }
    return frontDetections.map((detection, index) => (
      <DetectionThumbnail key={`${detection.bbox.x}-${detection.bbox.y}-${index}`} detection={detection} index={index} working={frontWorking} />
    ));
  }, [frontDetections, frontWorking]);

  return (
    <Stack gap={24}>
      <Stack gap={8}>
        <Text as="h2" variant="title">
          Review detections
        </Text>
        <Text variant="body">Check the front detection, then continue.</Text>
      </Stack>
      {sourcePairs.length > 1 && (
        <div className="source-pairTabs" role="tablist" aria-label="Source pairs">
          {sourcePairs.map((pair, index) => (
            <button
              key={pair.id}
              type="button"
              role="tab"
              className={`source-pairTabs__tab${pair.id === activeSourcePair?.id ? ' source-pairTabs__tab--active' : ''}`}
              aria-selected={pair.id === activeSourcePair?.id}
              onClick={() => setActiveSourcePairId(pair.id)}
            >
              Pair {index + 1}
            </button>
          ))}
        </div>
      )}
      <div className="detect-preview">
        <div>
          <Text as="h3" variant="label">
            Primary photo
          </Text>
          {frontWorking ? (
            <Stack gap={12}>
              {!adjustDialogOpen && renderPrimaryPreview(false)}
              <Button
                type="button"
                variant="secondary"
                onClick={() => setAdjustDialogOpen(true)}
                disabled={!frontWorking || frontStatus !== 'ready'}
                aria-haspopup="dialog"
                aria-controls={adjustDialogId}
                aria-expanded={adjustDialogOpen && frontStatus === 'ready'}
              >
                Adjust front detections
              </Button>
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
      {adjustDialogOpen && frontWorking && frontStatus === 'ready' && (
        <Modal
          isOpen={adjustDialogOpen}
          onClose={() => setAdjustDialogOpen(false)}
          labelledBy={adjustDialogTitleId}
          describedBy={adjustDialogDescriptionId}
          id={adjustDialogId}
        >
          <Stack gap={16}>
            <Stack gap={8}>
              <Text as="h2" variant="title" id={adjustDialogTitleId}>
                Adjust detections
              </Text>
              <Text variant="body" id={adjustDialogDescriptionId}>
                Use the preview to toggle detections or draw new rectangles. Press Escape to close this dialog.
              </Text>
            </Stack>
            <Stack gap={16}>
              {renderPrimaryPreview(true)}
              <Stack gap={8} className="detection-adjustments" role="group" aria-labelledby={adjustListLabelId}>
                <Text as="h3" variant="label" id={adjustListLabelId}>
                  Detection controls
                </Text>
                <Text variant="muted">
                  Click detections below to deactivate or draw on the preview to add missing cards.
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
              <Button type="button" onClick={() => setAdjustDialogOpen(false)}>
                Done adjusting
              </Button>
            </Stack>
          </Stack>
        </Modal>
      )}
      <StepNavigation
        step="detections"
        nextLabel="Pair imagery"
        nextDisabled={frontStatus !== 'ready' || totalActiveDetections === 0}
      />
    </Stack>
  );
};
