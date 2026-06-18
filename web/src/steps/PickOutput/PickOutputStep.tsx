import { ChangeEvent, useCallback, useEffect, useMemo, useRef, useState, useId } from 'react';

import { BannerChromium } from '../../components/BannerChromium';
import { StepNavigation } from '../../components/StepNavigation';
import {
  DetectionAdjustment,
  NamingPreset,
  OutputConfig,
  Pairing,
  useSessionStore,
  WorkingImageInfo
} from '../../state/session';
import type { CardCenteringMeasurement, CardCenteringSide } from '../../types/centering';
import type { DetectedCard } from '../../types/detections';
import { Stack } from '../../ui/Stack';
import { Text } from '../../ui/Text';
import { Button } from '../../ui/Button';
import { Modal } from '../../ui/Modal';
import { ProgressBar } from '../../ui/ProgressBar';
import { Spinner } from '../../ui/Spinner';
import { exportSession, ExportProgressUpdate } from '../../services/export';
import {
  buildCenteringMeasurement,
  buildEdgesFromPositions
} from '../../utils/centering/centeringCore';
import { createCenteringWorker, disposeCenteringWorker } from '../../utils/centering/centeringWorkerClient';
import { toFrontCenteringExportPayload, type CenteringReviewStatus } from '../../utils/centering/exportLinkage';
import { drawCenteringGuideLines } from '../../utils/centering/renderOverlay';

const defaultOutput: OutputConfig = {
  directoryHandle: null,
  directoryName: '',
  includeManifests: true,
  format: 'jpeg',
  quality: 92,
  includeWarped: true,
  includeCenteringOverlay: false
};

const qualityToLabel = (quality: number) => {
  if (quality >= 95) return 'High';
  if (quality >= 85) return 'Standard';
  return 'Space saver';
};

interface ExportContext {
  pairs: Pairing[];
  naming: NamingPreset[];
  workingImages: Record<string, WorkingImageInfo | undefined>;
}

interface CenteringReviewItem {
  pairId: string;
  label: string;
  blob: Blob;
  measurement: CardCenteringMeasurement;
  reviewStatus: CenteringReviewStatus;
}

const edgeSides: CardCenteringSide[] = ['left', 'right', 'top', 'bottom'];

const pairsReady = ({ pairs, naming, workingImages }: ExportContext) => {
  if (pairs.length === 0) {
    return false;
  }
  return pairs.every((pair) => {
    const namingEntry = naming.find((item) => item.pairId === pair.id);
    const frontImage = workingImages[pair.primaryFileId];
    return Boolean(namingEntry && frontImage);
  });
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

const cropImageBlob = async (
  blob: Blob,
  rect: { x: number; y: number; width: number; height: number }
) => {
  const bitmap = await createImageBitmap(blob);
  const canvas = document.createElement('canvas');
  canvas.width = rect.width;
  canvas.height = rect.height;
  const ctx = canvas.getContext('2d');
  if (!ctx) {
    bitmap.close();
    throw new Error('Unable to prepare front centering preview.');
  }
  ctx.drawImage(bitmap, rect.x, rect.y, rect.width, rect.height, 0, 0, rect.width, rect.height);
  bitmap.close();
  return await new Promise<Blob>((resolve, reject) => {
    canvas.toBlob((result) => {
      if (result) {
        resolve(result);
      } else {
        reject(new Error('Unable to prepare front centering preview.'));
      }
    }, 'image/png');
  });
};

const edgePositionsFromMeasurement = (
  measurement: CardCenteringMeasurement,
  edge: 'outer_edges' | 'inner_edges'
): Record<CardCenteringSide, number> => ({
  left: measurement[edge].left,
  top: measurement[edge].top,
  right: measurement[edge].right,
  bottom: measurement[edge].bottom
});

const updateMeasurementEdge = (
  measurement: CardCenteringMeasurement,
  kind: 'outer_edges' | 'inner_edges',
  side: CardCenteringSide,
  value: number
) => {
  const max = side === 'left' || side === 'right'
    ? measurement.image_width_px - 1
    : measurement.image_height_px - 1;
  const nextValue = Math.max(0, Math.min(max, Math.round(value)));
  const outer = edgePositionsFromMeasurement(measurement, 'outer_edges');
  const inner = edgePositionsFromMeasurement(measurement, 'inner_edges');
  if (kind === 'outer_edges') {
    outer[side] = nextValue;
  } else {
    inner[side] = nextValue;
  }
  return buildCenteringMeasurement(
    { width: measurement.image_width_px, height: measurement.image_height_px },
    buildEdgesFromPositions('outer', outer),
    buildEdgesFromPositions('inner', inner),
    measurement.rotation_degrees
  );
};

const CenteringReviewPreview = ({ item }: { item: CenteringReviewItem }) => {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) {
      return;
    }
    let cancelled = false;
    const render = async () => {
      const bitmap = await createImageBitmap(item.blob);
      if (cancelled) {
        bitmap.close();
        return;
      }
      const maxEdge = 560;
      const scale = Math.min(1, maxEdge / Math.max(bitmap.width, bitmap.height));
      const width = Math.max(1, Math.round(bitmap.width * scale));
      const height = Math.max(1, Math.round(bitmap.height * scale));
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext('2d');
      if (!ctx) {
        bitmap.close();
        return;
      }
      ctx.clearRect(0, 0, width, height);
      ctx.drawImage(bitmap, 0, 0, width, height);
      bitmap.close();
      drawCenteringGuideLines(ctx, item.measurement, width, height);
    };
    render().catch(() => {
      /* preview failures are surfaced by export preparation */
    });
    return () => {
      cancelled = true;
    };
  }, [item]);

  return <canvas ref={canvasRef} className="centering-review__canvas" aria-label={`Centering review for ${item.label}`} />;
};

export const PickOutputStep = () => {
  const {
    files,
    pairs,
    naming,
    detectedCards,
    detectionAdjustments,
    workingImages,
    output,
    setOutput
  } = useSessionStore((state) => ({
    files: state.files,
    pairs: state.pairs,
    naming: state.naming,
    detectedCards: state.detectedCards,
    detectionAdjustments: state.detectionAdjustments,
    workingImages: state.workingImages,
    output: state.output,
    setOutput: state.setOutput
  }));

  const [exportState, setExportState] = useState<'idle' | 'running' | 'success' | 'error'>('idle');
  const [progress, setProgress] = useState<ExportProgressUpdate | null>(null);
  const [errorTitle, setErrorTitle] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [directorySupported, setDirectorySupported] = useState(
    () => typeof window !== 'undefined' && 'showDirectoryPicker' in window
  );
  const [centeringReviewItems, setCenteringReviewItems] = useState<CenteringReviewItem[]>([]);
  const [centeringReviewOpen, setCenteringReviewOpen] = useState(false);
  const [centeringReviewIndex, setCenteringReviewIndex] = useState(0);
  const [centeringPrepareState, setCenteringPrepareState] = useState<'idle' | 'preparing'>('idle');

  const dialogTitleId = useId();
  const dialogDescriptionId = useId();
  const formatFieldId = useId();
  const formatDescriptionId = useId();
  const qualityFieldId = useId();
  const qualityDescriptionId = useId();
  const includeWarpedId = useId();
  const includeManifestsId = useId();
  const includeCenteringOverlayId = useId();
  const centeringDialogTitleId = useId();
  const centeringDialogDescriptionId = useId();

  useEffect(() => {
    if (!output) {
      setOutput(defaultOutput);
    }
  }, [output, setOutput]);

  const config = output ?? defaultOutput;

  useEffect(() => {
    setCenteringReviewItems([]);
    setCenteringReviewOpen(false);
    setCenteringReviewIndex(0);
  }, [detectedCards, detectionAdjustments, pairs, workingImages]);

  const handleOptionChange = useCallback(
    (key: keyof OutputConfig, parser: (value: string | boolean) => OutputConfig[keyof OutputConfig]) =>
      (event: ChangeEvent<HTMLInputElement | HTMLSelectElement>) => {
        const rawValue =
          event.target instanceof HTMLInputElement && event.target.type === 'checkbox'
            ? event.target.checked
            : event.target.value;
        const parsed = parser(rawValue);
        setOutput({
          ...config,
          [key]: parsed
        });
      },
    [config, setOutput]
  );

  const handlePickDirectory = useCallback(async () => {
    if (!('showDirectoryPicker' in window)) {
      setDirectorySupported(false);
      setOutput({
        ...config,
        directoryHandle: null,
        directoryName: ''
      });
      setErrorTitle('Directory access unavailable');
      setErrorMessage('Your browser does not support directory exports. A ZIP archive will be prepared instead.');
      setExportState('error');
      return;
    }

    try {
      const handle = await (window as Window & {
        showDirectoryPicker: (options?: { mode?: 'readwrite' | 'read' }) => Promise<FileSystemDirectoryHandle>;
      }).showDirectoryPicker({ mode: 'readwrite' });
      setOutput({
        ...config,
        directoryHandle: handle,
        directoryName: handle.name ?? 'Selected folder'
      });
      setDirectorySupported(true);
      setErrorTitle(null);
      setErrorMessage(null);
      setExportState('idle');
    } catch (error) {
      if (error instanceof DOMException) {
        if (error.name === 'AbortError') {
          return;
        }
        if (error.name === 'NotAllowedError') {
          setErrorTitle('Folder access denied');
          setErrorMessage('Access to this folder was denied. Please allow access and try again.');
          setOutput({
            ...config,
            directoryHandle: null,
            directoryName: ''
          });
          setExportState('error');
          return;
        }
      }
      setErrorTitle('Unable to access folder');
      setErrorMessage(error instanceof Error ? error.message : 'Unable to access this folder.');
      setExportState('error');
    }
  }, [config, setOutput]);

  const readyForExport = useMemo(
    () =>
      pairsReady({
        pairs,
        naming,
        workingImages
      }),
    [pairs, naming, workingImages]
  );

  const isDialogOpen = exportState === 'error' && Boolean(errorTitle && errorMessage);

  const handleCloseDialog = useCallback(() => {
    setErrorMessage(null);
    setErrorTitle(null);
    setExportState('idle');
  }, [setErrorMessage, setErrorTitle, setExportState]);

  const prepareCenteringReview = useCallback(async () => {
    setCenteringPrepareState('preparing');
    setProgress(null);
    setErrorMessage(null);
    setErrorTitle(null);
    setExportState('running');

    const current = createCenteringWorker();
    try {
      const namingMap = new Map(naming.map((entry) => [entry.pairId, entry]));
      const nextItems: CenteringReviewItem[] = [];
      for (const pair of pairs) {
        const frontImage = workingImages[pair.primaryFileId];
        const frontCard = resolveDetectedCard(
          pair.primaryFileId,
          pair.primaryDetectionId,
          detectedCards,
          detectionAdjustments
        );
        if (!frontImage || !frontCard) {
          throw new Error(`Unable to prepare centering review for pair ${pair.id}.`);
        }
        const crop = await cropImageBlob(frontImage.originalBlob, mapBoundingBox(frontCard, frontImage));
        const result = await current.worker.measureImage(crop, 0);
        const namingEntry = namingMap.get(pair.id);
        nextItems.push({
          pairId: pair.id,
          label: namingEntry?.cardName?.trim() || `Pair ${nextItems.length + 1}`,
          blob: crop,
          measurement: result.measurement,
          reviewStatus: 'auto'
        });
      }
      setCenteringReviewItems(nextItems);
      setCenteringReviewIndex(0);
      setCenteringReviewOpen(true);
      setExportState('idle');
      return true;
    } catch (error) {
      setExportState('error');
      setErrorTitle('Centering review failed');
      setErrorMessage(error instanceof Error ? error.message : 'Unable to prepare centering review.');
      return false;
    } finally {
      disposeCenteringWorker(current);
      setCenteringPrepareState('idle');
    }
  }, [detectedCards, detectionAdjustments, naming, pairs, workingImages]);

  const runExport = useCallback(async (reviewItems: CenteringReviewItem[]) => {
    if (!readyForExport) {
      return false;
    }

    setProgress(null);
    setExportState('running');
    setErrorMessage(null);
    setErrorTitle(null);

    try {
      const frontCenteringByPairId = Object.fromEntries(
        reviewItems.map((item) => [
          item.pairId,
          toFrontCenteringExportPayload(item.measurement, item.reviewStatus)
        ])
      );
      await exportSession({
        files,
        pairs,
        naming,
        workingImages,
        detectedCards,
        detectionAdjustments,
        options: {
          directoryHandle: directorySupported ? config.directoryHandle : null,
          includeManifests: config.includeManifests,
          format: config.format,
          quality: config.quality,
          includeWarped: config.includeWarped,
          includeCenteringOverlay: config.includeCenteringOverlay,
          frontCenteringByPairId
        },
        onProgress: (update) => {
          setProgress(update);
        }
      });
      setExportState('success');
      return true;
    } catch (error) {
      setExportState('error');
      const message = error instanceof Error ? error.message : 'Export failed.';
      setErrorTitle('Export failed');
      setErrorMessage(message);
      if (error instanceof Error && error.message.toLowerCase().includes('selected folder was revoked')) {
        setOutput({
          ...config,
          directoryHandle: null,
          directoryName: ''
        });
      }
      return false;
    }
  }, [
    config,
    directorySupported,
    detectedCards,
    detectionAdjustments,
    files,
    naming,
    pairs,
    readyForExport,
    setOutput,
    workingImages
  ]);

  const handleExport = useCallback(async () => {
    if (!readyForExport) {
      return false;
    }

    if (config.includeCenteringOverlay && centeringReviewItems.length === 0) {
      await prepareCenteringReview();
      return false;
    }

    return await runExport(config.includeCenteringOverlay ? centeringReviewItems : []);
  }, [
    centeringReviewItems,
    config.includeCenteringOverlay,
    prepareCenteringReview,
    readyForExport,
    runExport
  ]);

  const handleCenteringReviewExport = useCallback(async () => {
    setCenteringReviewOpen(false);
    return await runExport(centeringReviewItems);
  }, [centeringReviewItems, runExport]);

  const updateCenteringReviewItem = useCallback(
    (kind: 'outer_edges' | 'inner_edges', side: CardCenteringSide, value: number) => {
      setCenteringReviewItems((items) =>
        items.map((item, index) => {
          if (index !== centeringReviewIndex) {
            return item;
          }
          return {
            ...item,
            measurement: updateMeasurementEdge(item.measurement, kind, side, value),
            reviewStatus: 'manual'
          };
        })
      );
    },
    [centeringReviewIndex]
  );

  const imageFormatLabel = config.format === 'jpeg' ? 'JPEG (.jpg)' : 'PNG (.png)';
  const qualityLabel =
    config.format === 'jpeg'
      ? `${config.quality}% • ${qualityToLabel(config.quality)}`
      : 'Only applies to JPEG exports';
  const activeCenteringReviewItem = centeringReviewItems[centeringReviewIndex] ?? null;

  return (
    <Stack gap={24}>
      <Stack gap={8}>
        <Text as="h2" variant="title">
          Export
        </Text>
        <Text variant="body">Choose where the finished assets should go.</Text>
      </Stack>
      <BannerChromium compact />
      <Stack gap={12}>
        <Stack direction="row" gap={12} align="center">
          <Button type="button" onClick={handlePickDirectory}>
            {config.directoryHandle ? 'Change folder' : 'Choose folder'}
          </Button>
          <Text as="span" variant="body" aria-live="polite">
            {config.directoryHandle ? `Selected: ${config.directoryName}` : 'No folder selected — ZIP download will be used.'}
          </Text>
        </Stack>
        {!directorySupported && (
          <Text variant="muted" role="status" aria-live="polite">
            Your browser does not support directory exports. We will create a ZIP file for download instead.
          </Text>
        )}
      </Stack>
      <details>
        <summary className="output-options__summary">Advanced export options</summary>
        <Stack gap={16} className="output-options" role="group" aria-label="Advanced export options">
          <div className="output-options__field">
            <label htmlFor={formatFieldId}>
              <Text as="span" variant="label">
                Image format
              </Text>
            </label>
            <select
              id={formatFieldId}
              value={config.format}
              onChange={handleOptionChange('format', (value) => value as OutputConfig['format'])}
              aria-describedby={formatDescriptionId}
            >
              <option value="jpeg">JPEG (smaller files)</option>
              <option value="png">PNG (lossless)</option>
            </select>
            <Text as="span" variant="muted" id={formatDescriptionId}>
              Currently: {imageFormatLabel}
            </Text>
          </div>
          <div className="output-options__field">
            <label htmlFor={qualityFieldId}>
              <Text as="span" variant="label">
                JPEG quality
              </Text>
            </label>
            <input
              id={qualityFieldId}
              type="range"
              min={70}
              max={100}
              step={1}
              value={config.quality}
              disabled={config.format !== 'jpeg'}
              onChange={handleOptionChange('quality', (value) => Math.min(100, Math.max(70, Number(value))))}
              aria-valuemin={70}
              aria-valuemax={100}
              aria-valuenow={config.quality}
              aria-disabled={config.format !== 'jpeg'}
              aria-describedby={qualityDescriptionId}
            />
            <Text as="span" variant="muted" id={qualityDescriptionId}>
              {qualityLabel}
            </Text>
          </div>
          <div className="output-options__toggle">
            <input
              id={includeWarpedId}
              type="checkbox"
              checked={config.includeWarped}
              onChange={handleOptionChange('includeWarped', (value) => Boolean(value))}
            />
            <label htmlFor={includeWarpedId}>
              <Stack direction="row" gap={8} align="center">
                <Text as="span" variant="body">
                  Include warped front export (OpenCV required)
                </Text>
              </Stack>
            </label>
          </div>
          <div className="output-options__toggle">
            <input
              id={includeManifestsId}
              type="checkbox"
              checked={config.includeManifests}
              onChange={handleOptionChange('includeManifests', (value) => Boolean(value))}
            />
            <label htmlFor={includeManifestsId}>
              <Stack direction="row" gap={8} align="center">
                <Text as="span" variant="body">
                  Include JSON manifest per card pair
                </Text>
              </Stack>
            </label>
          </div>
          <div className="output-options__toggle">
            <input
              id={includeCenteringOverlayId}
              type="checkbox"
              checked={Boolean(config.includeCenteringOverlay)}
              onChange={(event) => {
                setCenteringReviewItems([]);
                setCenteringReviewOpen(false);
                setOutput({
                  ...config,
                  includeCenteringOverlay: event.target.checked
                });
              }}
            />
            <label htmlFor={includeCenteringOverlayId}>
              <Stack direction="row" gap={8} align="center">
                <Text as="span" variant="body">
                  Include front centering line PNGs
                </Text>
              </Stack>
            </label>
          </div>
        </Stack>
      </details>
      <Stack gap={8}>
        <Text as="h3" variant="label">
          Ready to export
        </Text>
        <Text variant="muted">{files.length} files • {pairs.length} card pairs • {naming.length} naming presets</Text>
      </Stack>
      {(exportState === 'running' || progress) && (
        <Stack gap={8} role="status" aria-live="polite">
          {progress ? (
            <>
              <ProgressBar value={progress.completed} max={progress.total} label="Export progress" />
              <Text variant="muted">{progress.message}</Text>
            </>
          ) : (
            <Spinner size="sm" label="Preparing export…" />
          )}
        </Stack>
      )}
      {exportState === 'success' && (
        <Text role="status" aria-live="polite" variant="muted">
          Export complete. Check your {directorySupported ? 'chosen folder' : 'downloads'} for the generated assets.
        </Text>
      )}
      {isDialogOpen && errorTitle && errorMessage && (
        <Modal
          isOpen={isDialogOpen}
          onClose={handleCloseDialog}
          labelledBy={dialogTitleId}
          describedBy={dialogDescriptionId}
        >
          <Stack gap={12}>
            <Text as="h2" variant="title" id={dialogTitleId}>
              {errorTitle}
            </Text>
            <Text variant="body" id={dialogDescriptionId}>
              {errorMessage}
            </Text>
            <Button type="button" onClick={handleCloseDialog}>
              Close
            </Button>
          </Stack>
        </Modal>
      )}
      {centeringReviewOpen && activeCenteringReviewItem && (
        <Modal
          isOpen={centeringReviewOpen}
          onClose={() => setCenteringReviewOpen(false)}
          labelledBy={centeringDialogTitleId}
          describedBy={centeringDialogDescriptionId}
        >
          <Stack gap={16} className="centering-review">
            <Stack gap={4}>
              <Text as="h2" variant="title" id={centeringDialogTitleId}>
                Review centering lines
              </Text>
              <Text variant="muted" id={centeringDialogDescriptionId}>
                {centeringReviewIndex + 1} of {centeringReviewItems.length}: {activeCenteringReviewItem.label}
              </Text>
            </Stack>
            <CenteringReviewPreview item={activeCenteringReviewItem} />
            <div className="centering-metrics">
              <span><strong>Left</strong>{activeCenteringReviewItem.measurement.borders_px.left}px</span>
              <span><strong>Right</strong>{activeCenteringReviewItem.measurement.borders_px.right}px</span>
              <span><strong>Top</strong>{activeCenteringReviewItem.measurement.borders_px.top}px</span>
              <span><strong>Bottom</strong>{activeCenteringReviewItem.measurement.borders_px.bottom}px</span>
              <span><strong>L/R</strong>{activeCenteringReviewItem.measurement.centering.left_right}</span>
              <span><strong>T/B</strong>{activeCenteringReviewItem.measurement.centering.top_bottom}</span>
            </div>
            <div className="centering-review__edges">
              {edgeSides.map((side) => (
                <div className="centering-edge-row" key={side}>
                  <Text as="h3" variant="label">{side}</Text>
                  {(['outer_edges', 'inner_edges'] as const).map((kind) => {
                    const label = kind === 'outer_edges' ? 'Outer' : 'Inner';
                    const value = activeCenteringReviewItem.measurement[kind][side];
                    const max = side === 'left' || side === 'right'
                      ? activeCenteringReviewItem.measurement.image_width_px - 1
                      : activeCenteringReviewItem.measurement.image_height_px - 1;
                    return (
                      <div className="centering-edge-control" key={kind}>
                        <span>{label}</span>
                        <Button type="button" variant="secondary" onClick={() => updateCenteringReviewItem(kind, side, value - 5)}>-5</Button>
                        <Button type="button" variant="secondary" onClick={() => updateCenteringReviewItem(kind, side, value - 1)}>-1</Button>
                        <input
                          type="number"
                          min={0}
                          max={max}
                          value={value}
                          onChange={(event) => updateCenteringReviewItem(kind, side, Number(event.target.value))}
                          aria-label={`${label} ${side} centering line`}
                        />
                        <Button type="button" variant="secondary" onClick={() => updateCenteringReviewItem(kind, side, value + 1)}>+1</Button>
                        <Button type="button" variant="secondary" onClick={() => updateCenteringReviewItem(kind, side, value + 5)}>+5</Button>
                      </div>
                    );
                  })}
                </div>
              ))}
            </div>
            {activeCenteringReviewItem.measurement.warnings.length > 0 && (
              <div className="centering-warning" role="alert">
                {activeCenteringReviewItem.measurement.warnings.map((warning) => <p key={warning}>{warning}</p>)}
              </div>
            )}
            <Stack direction="row" gap={8} justify="between" className="centering-review__actions">
              <Stack direction="row" gap={8}>
                <Button
                  type="button"
                  variant="secondary"
                  disabled={centeringReviewIndex === 0}
                  onClick={() => setCenteringReviewIndex((index) => Math.max(0, index - 1))}
                >
                  Previous
                </Button>
                <Button
                  type="button"
                  variant="secondary"
                  disabled={centeringReviewIndex >= centeringReviewItems.length - 1}
                  onClick={() => setCenteringReviewIndex((index) => Math.min(centeringReviewItems.length - 1, index + 1))}
                >
                  Next
                </Button>
              </Stack>
              <Button type="button" onClick={() => void handleCenteringReviewExport()}>
                Export with centering PNGs
              </Button>
            </Stack>
          </Stack>
        </Modal>
      )}
      <StepNavigation
        step="output"
        nextLabel="Export now"
        nextDisabled={!readyForExport || exportState === 'running' || centeringPrepareState === 'preparing'}
        onNext={handleExport}
      />
    </Stack>
  );
};
