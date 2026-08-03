import { ChangeEvent, useCallback, useEffect, useMemo, useRef, useState } from 'react';

import type { CardCenteringMeasurement, CardCenteringSide } from '../../types/centering';
import { Button } from '../../ui/Button';
import { Card } from '../../ui/Card';
import { Spinner } from '../../ui/Spinner';
import { Stack } from '../../ui/Stack';
import { Text } from '../../ui/Text';
import { cropForZoom, normalizeRotationDegrees, rotationIsStale } from '../../utils/centering/centeringCore';
import { createCenteringWorker, disposeCenteringWorker } from '../../utils/centering/centeringWorkerClient';
import { drawCenteringGuideLines, getRotatedSize } from '../../utils/centering/renderOverlay';

const EDGE_SIDES: CardCenteringSide[] = ['left', 'right', 'top', 'bottom'];
const ZOOM_LEVELS = [1, 2, 4, 8];
const CENTERING_ANALYSIS_MAX_EDGE = 320;

type EdgePositions = Record<CardCenteringSide, number>;

const prepareCenteringAnalysisBlob = async (blob: Blob) => {
  const url = URL.createObjectURL(blob);
  const image = new Image();
  image.decoding = 'async';
  image.src = url;
  try {
    await image.decode();
    const scale = Math.min(1, CENTERING_ANALYSIS_MAX_EDGE / Math.max(image.naturalWidth, image.naturalHeight));
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(image.naturalWidth * scale));
    canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));
    const context = canvas.getContext('2d');
    if (!context) {
      throw new Error('Unable to prepare the centering analysis image.');
    }
    context.drawImage(image, 0, 0, canvas.width, canvas.height);
    return await new Promise<Blob>((resolve, reject) => {
      canvas.toBlob((result) => {
        if (result) {
          resolve(result);
        } else {
          reject(new Error('Unable to prepare the centering analysis image.'));
        }
      }, 'image/jpeg', 0.85);
    });
  } finally {
    URL.revokeObjectURL(url);
    image.src = '';
  }
};

const downloadBlob = (blob: Blob, fileName: string) => {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = fileName;
  document.body.appendChild(anchor);
  anchor.click();
  document.body.removeChild(anchor);
  URL.revokeObjectURL(url);
};

const drawOverlay = async (
  canvas: HTMLCanvasElement,
  blob: Blob,
  measurement: CardCenteringMeasurement,
  rotationDegrees: number,
  zoom: number,
  panX: number,
  panY: number
) => {
  const image = await createImageBitmap(blob);
  const normalized = normalizeRotationDegrees(rotationDegrees);
  const rotated = getRotatedSize(image.width, image.height, normalized);
  const rotatedWidth = rotated.width;
  const rotatedHeight = rotated.height;
  const measurementOffsetX = Math.round((rotatedWidth - measurement.image_width_px) / 2);
  const measurementOffsetY = Math.round((rotatedHeight - measurement.image_height_px) / 2);
  const sourceCanvas = document.createElement('canvas');
  sourceCanvas.width = rotatedWidth;
  sourceCanvas.height = rotatedHeight;
  const sourceCtx = sourceCanvas.getContext('2d');
  if (!sourceCtx) {
    image.close();
    throw new Error('Unable to draw centering preview.');
  }

  sourceCtx.fillStyle = '#ffffff';
  sourceCtx.fillRect(0, 0, rotatedWidth, rotatedHeight);
  sourceCtx.translate(rotatedWidth / 2, rotatedHeight / 2);
  sourceCtx.rotate((normalized * Math.PI) / 180);
  sourceCtx.drawImage(image, -image.width / 2, -image.height / 2);
  image.close();
  sourceCtx.setTransform(1, 0, 0, 1, 0, 0);

  drawCenteringGuideLines(
    sourceCtx,
    {
      ...measurement,
      image_width_px: rotatedWidth,
      image_height_px: rotatedHeight,
      outer_edges: {
        left: measurement.outer_edges.left + measurementOffsetX,
        right: measurement.outer_edges.right + measurementOffsetX,
        top: measurement.outer_edges.top + measurementOffsetY,
        bottom: measurement.outer_edges.bottom + measurementOffsetY
      },
      inner_edges: {
        left: measurement.inner_edges.left + measurementOffsetX,
        right: measurement.inner_edges.right + measurementOffsetX,
        top: measurement.inner_edges.top + measurementOffsetY,
        bottom: measurement.inner_edges.bottom + measurementOffsetY
      }
    },
    rotatedWidth,
    rotatedHeight
  );

  const crop = cropForZoom({ width: rotatedWidth, height: rotatedHeight }, zoom, panX, panY);
  const maxEdge = 920;
  const scale = Math.min(1, maxEdge / Math.max(crop.width, crop.height));
  canvas.width = Math.max(1, Math.round(crop.width * scale));
  canvas.height = Math.max(1, Math.round(crop.height * scale));
  const ctx = canvas.getContext('2d');
  if (!ctx) {
    throw new Error('Unable to render centering preview.');
  }
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(sourceCanvas, crop.x, crop.y, crop.width, crop.height, 0, 0, canvas.width, canvas.height);
};

const makeAnnotatedBlob = async (blob: Blob, measurement: CardCenteringMeasurement, rotationDegrees: number) => {
  const canvas = document.createElement('canvas');
  await drawOverlay(canvas, blob, measurement, rotationDegrees, 1, 50, 50);
  return await new Promise<Blob>((resolve, reject) => {
    canvas.toBlob((result) => {
      if (result) {
        resolve(result);
      } else {
        reject(new Error('Unable to create annotated PNG.'));
      }
    }, 'image/png');
  });
};

const edgePositionsFromMeasurement = (measurement: CardCenteringMeasurement, edge: 'outer_edges' | 'inner_edges'): EdgePositions => ({
  left: measurement[edge].left,
  top: measurement[edge].top,
  right: measurement[edge].right,
  bottom: measurement[edge].bottom
});

export const CenteringToolPage = () => {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const workerRef = useRef<ReturnType<typeof createCenteringWorker> | null>(null);
  const [fileBlob, setFileBlob] = useState<Blob | null>(null);
  const [fileName, setFileName] = useState('');
  const [measurement, setMeasurement] = useState<CardCenteringMeasurement | null>(null);
  const [autoOuter, setAutoOuter] = useState<EdgePositions | null>(null);
  const [autoInner, setAutoInner] = useState<EdgePositions | null>(null);
  const [rotationDraft, setRotationDraft] = useState(0);
  const [appliedRotation, setAppliedRotation] = useState(0);
  const [zoom, setZoom] = useState(1);
  const [panX, setPanX] = useState(50);
  const [panY, setPanY] = useState(50);
  const [status, setStatus] = useState<'idle' | 'detecting' | 'ready' | 'error'>('idle');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    workerRef.current = createCenteringWorker();
    return () => {
      disposeCenteringWorker(workerRef.current);
      workerRef.current = null;
    };
  }, []);

  const staleRotation = rotationIsStale(rotationDraft, appliedRotation);

  const runDetection = useCallback(async (blob: Blob, rotationDegrees: number) => {
    const current = workerRef.current;
    if (!current) return;
    setStatus('detecting');
    setError(null);
    try {
      const result = await Promise.race([
        (async () => {
          const analysisBlob = await prepareCenteringAnalysisBlob(blob);
          return await current.worker.measureImage(analysisBlob, rotationDegrees);
        })(),
        new Promise<never>((_, reject) => {
          window.setTimeout(() => reject(new Error('Card edge detection took too long. Try a smaller image or a clearer scan.')), 12000);
        })
      ]);
      setMeasurement(result.measurement);
      setAutoOuter(edgePositionsFromMeasurement(result.measurement, 'outer_edges'));
      setAutoInner(edgePositionsFromMeasurement(result.measurement, 'inner_edges'));
      setAppliedRotation(normalizeRotationDegrees(rotationDegrees));
      setStatus('ready');
    } catch (err) {
      disposeCenteringWorker(current);
      workerRef.current = createCenteringWorker();
      setStatus('error');
      setError(err instanceof Error ? err.message : 'Card centering detection failed.');
    }
  }, []);

  const handleFileChange = useCallback(
    (event: ChangeEvent<HTMLInputElement>) => {
      const file = event.target.files?.[0];
      if (!file) return;
      setFileBlob(file);
      setFileName(file.name);
      setRotationDraft(0);
      setAppliedRotation(0);
      setZoom(1);
      setPanX(50);
      setPanY(50);
      void runDetection(file, 0);
    },
    [runDetection]
  );

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !fileBlob || !measurement) return;
    let cancelled = false;
    drawOverlay(canvas, fileBlob, measurement, rotationDraft, zoom, panX, panY).catch((err) => {
      if (!cancelled) {
        setError(err instanceof Error ? err.message : 'Unable to render centering preview.');
      }
    });
    return () => {
      cancelled = true;
    };
  }, [fileBlob, measurement, panX, panY, rotationDraft, zoom]);

  const updateManualEdge = useCallback(
    async (kind: 'outer_edges' | 'inner_edges', side: CardCenteringSide, value: number) => {
      if (!measurement || !workerRef.current) return;
      const outer = edgePositionsFromMeasurement(measurement, 'outer_edges');
      const inner = edgePositionsFromMeasurement(measurement, 'inner_edges');
      const nextOuter = kind === 'outer_edges' ? { ...outer, [side]: value } : outer;
      const nextInner = kind === 'inner_edges' ? { ...inner, [side]: value } : inner;
      const next = await workerRef.current.worker.buildManualMeasurement(
        measurement.image_width_px,
        measurement.image_height_px,
        nextOuter,
        nextInner,
        appliedRotation
      );
      setMeasurement(next);
    },
    [appliedRotation, measurement]
  );

  const resetToAuto = useCallback(async () => {
    if (!measurement || !autoOuter || !autoInner || !workerRef.current) return;
    const next = await workerRef.current.worker.buildManualMeasurement(
      measurement.image_width_px,
      measurement.image_height_px,
      autoOuter,
      autoInner,
      appliedRotation
    );
    setMeasurement(next);
  }, [appliedRotation, autoInner, autoOuter, measurement]);

  const edgeControls = useMemo(() => {
    if (!measurement) return null;
    const maxX = measurement.image_width_px - 1;
    const maxY = measurement.image_height_px - 1;
    return EDGE_SIDES.map((side) => {
      const max = side === 'left' || side === 'right' ? maxX : maxY;
      return (
        <div className="centering-edge-row" key={side}>
          <Text as="h3" variant="label">{side}</Text>
          {(['outer_edges', 'inner_edges'] as const).map((kind) => {
            const label = kind === 'outer_edges' ? 'Outer' : 'Inner';
            const value = measurement[kind][side];
            return (
              <div className="centering-edge-control" key={kind}>
                <span>{label}</span>
                <Button type="button" variant="secondary" onClick={() => void updateManualEdge(kind, side, value - 5)}>-5</Button>
                <Button type="button" variant="secondary" onClick={() => void updateManualEdge(kind, side, value - 1)}>-1</Button>
                <input
                  type="number"
                  min={0}
                  max={max}
                  value={value}
                  onChange={(event) => void updateManualEdge(kind, side, Number(event.target.value))}
                  aria-label={`${label} ${side}`}
                />
                <Button type="button" variant="secondary" onClick={() => void updateManualEdge(kind, side, value + 1)}>+1</Button>
                <Button type="button" variant="secondary" onClick={() => void updateManualEdge(kind, side, value + 5)}>+5</Button>
              </div>
            );
          })}
        </div>
      );
    });
  }, [measurement, updateManualEdge]);

  const handleDownloadJson = useCallback(() => {
    if (!measurement) return;
    const blob = new Blob([JSON.stringify(measurement, null, 2)], { type: 'application/json' });
    downloadBlob(blob, 'card-centering.json');
  }, [measurement]);

  const handleDownloadPng = useCallback(async () => {
    if (!fileBlob || !measurement) return;
    const blob = await makeAnnotatedBlob(fileBlob, measurement, appliedRotation);
    downloadBlob(blob, 'card-centering-annotated.png');
  }, [appliedRotation, fileBlob, measurement]);

  return (
    <Stack gap={24} className="centering-tool">
      <Stack gap={8}>
        <Text as="h2" variant="title">Card Centering</Text>
        <Text variant="body">Measure card borders, adjust the guide lines, and export a QA image or JSON report.</Text>
      </Stack>

      <Card className="centering-upload-card">
        <label className="centering-upload">
          <span>Upload card scan or photo</span>
          <input type="file" accept="image/png,image/jpeg,image/webp" onChange={handleFileChange} />
        </label>
        {fileName && <Text variant="muted">Selected: {fileName}</Text>}
      </Card>

      {status === 'detecting' && <Spinner label="Detecting card edges…" />}
      {status === 'error' && error && <Text variant="body" className="centering-error" role="alert">{error}</Text>}

      {measurement && fileBlob && (
        <div className="centering-layout">
          <section className="centering-preview-panel" aria-label="Card centering preview">
            <div className="centering-toolbar">
              <div className="centering-zoom-group" aria-label="Zoom">
                {ZOOM_LEVELS.map((level) => (
                  <Button
                    type="button"
                    key={level}
                    variant={zoom === level ? 'primary' : 'secondary'}
                    onClick={() => setZoom(level)}
                  >
                    {level}x
                  </Button>
                ))}
              </div>
              <label>
                Pan X
                <input type="range" min={0} max={100} value={panX} disabled={zoom === 1} onChange={(event) => setPanX(Number(event.target.value))} />
              </label>
              <label>
                Pan Y
                <input type="range" min={0} max={100} value={panY} disabled={zoom === 1} onChange={(event) => setPanY(Number(event.target.value))} />
              </label>
            </div>
            <canvas ref={canvasRef} className="centering-canvas" aria-label="Annotated card centering preview" />
          </section>

          <aside className="centering-controls">
            <Card className="centering-panel">
              <Text as="h3" variant="label">Rotation</Text>
              <div className="centering-rotation-grid">
                {[-1, -0.1, -0.01, 0.01, 0.1, 1].map((delta) => (
                  <Button type="button" key={delta} variant="secondary" onClick={() => setRotationDraft(normalizeRotationDegrees(rotationDraft + delta))}>
                    {delta > 0 ? `+${delta}` : delta}
                  </Button>
                ))}
              </div>
              <input
                type="number"
                step={0.01}
                min={-45}
                max={45}
                value={rotationDraft}
                onChange={(event) => setRotationDraft(normalizeRotationDegrees(Number(event.target.value)))}
                aria-label="Rotation degrees"
              />
              <Button type="button" onClick={() => fileBlob && void runDetection(fileBlob, rotationDraft)}>
                Apply rotation and re-detect
              </Button>
              {staleRotation && <Text variant="muted">Preview rotation is not applied to measurements yet.</Text>}
            </Card>

            <Card className="centering-panel">
              <Stack direction="row" justify="between" align="center">
                <Text as="h3" variant="label">Line Tweaks</Text>
                <Button type="button" variant="secondary" onClick={() => void resetToAuto()}>Reset</Button>
              </Stack>
              {edgeControls}
            </Card>
          </aside>
        </div>
      )}

      {measurement && (
        <Card className="centering-results">
          <div className="centering-metrics">
            <span><strong>Left</strong>{measurement.borders_px.left}px</span>
            <span><strong>Right</strong>{measurement.borders_px.right}px</span>
            <span><strong>Top</strong>{measurement.borders_px.top}px</span>
            <span><strong>Bottom</strong>{measurement.borders_px.bottom}px</span>
            <span><strong>L/R</strong>{measurement.centering.left_right}</span>
            <span><strong>T/B</strong>{measurement.centering.top_bottom}</span>
          </div>
          {measurement.warnings.length > 0 && (
            <div className="centering-warning" role="alert">
              {measurement.warnings.map((warning) => <p key={warning}>{warning}</p>)}
            </div>
          )}
          <Stack direction="row" gap={12} className="centering-downloads">
            <Button type="button" onClick={() => void handleDownloadPng()}>Download annotated PNG</Button>
            <Button type="button" variant="secondary" onClick={handleDownloadJson}>Download JSON</Button>
          </Stack>
        </Card>
      )}
    </Stack>
  );
};
