import { ChangeEvent, useCallback, useEffect, useMemo, useState } from 'react';

import { StepNavigation } from '../../components/StepNavigation';
import { NamingPreset, OutputConfig, Pairing, useSessionStore, WorkingImageInfo } from '../../state/session';
import { Stack } from '../../ui/Stack';
import { Text } from '../../ui/Text';
import { Button } from '../../ui/Button';
import { ProgressBar } from '../../ui/ProgressBar';
import { Spinner } from '../../ui/Spinner';
import { exportSession, ExportProgressUpdate } from '../../services/export';

const defaultOutput: OutputConfig = {
  directoryHandle: null,
  directoryName: '',
  includeManifests: true,
  format: 'jpeg',
  quality: 92,
  includeWarped: true
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
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [directorySupported, setDirectorySupported] = useState(
    () => typeof window !== 'undefined' && 'showDirectoryPicker' in window
  );

  useEffect(() => {
    if (!output) {
      setOutput(defaultOutput);
    }
  }, [output, setOutput]);

  const config = output ?? defaultOutput;

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
      return;
    }

    try {
      const handle = await window.showDirectoryPicker({ mode: 'readwrite' });
      setOutput({
        ...config,
        directoryHandle: handle,
        directoryName: handle.name ?? 'Selected folder'
      });
      setDirectorySupported(true);
    } catch (error) {
      if (error instanceof DOMException) {
        if (error.name === 'AbortError') {
          return;
        }
        if (error.name === 'NotAllowedError') {
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

  const handleExport = useCallback(async () => {
    if (!readyForExport) {
      return false;
    }

    setProgress(null);
    setExportState('running');
    setErrorMessage(null);

    try {
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
          includeWarped: config.includeWarped
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
    config.directoryHandle,
    config.directoryName,
    config.includeManifests,
    config.format,
    config.quality,
    config.includeWarped,
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

  const imageFormatLabel = config.format === 'jpeg' ? 'JPEG (.jpg)' : 'PNG (.png)';
  const qualityLabel =
    config.format === 'jpeg'
      ? `${config.quality}% • ${qualityToLabel(config.quality)}`
      : 'Only applies to JPEG exports';

  return (
    <Stack gap={24}>
      <Stack gap={8}>
        <Text as="h2" variant="title">
          Choose export destination
        </Text>
        <Text variant="body">
          Save processed imagery directly to a folder when supported, or fall back to a ZIP archive when
          directory access is unavailable.
        </Text>
      </Stack>
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
          <label className="output-options__field">
            <Text as="span" variant="label">
              Image format
            </Text>
            <select value={config.format} onChange={handleOptionChange('format', (value) => value as OutputConfig['format'])}>
              <option value="jpeg">JPEG (smaller files)</option>
              <option value="png">PNG (lossless)</option>
            </select>
            <Text as="span" variant="muted">
              Currently: {imageFormatLabel}
            </Text>
          </label>
          <label className="output-options__field">
            <Text as="span" variant="label">
              JPEG quality
            </Text>
            <input
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
            />
            <Text as="span" variant="muted">
              {qualityLabel}
            </Text>
          </label>
          <label className="output-options__toggle">
            <Stack direction="row" gap={8} align="center">
              <input
                type="checkbox"
                checked={config.includeWarped}
                onChange={handleOptionChange('includeWarped', (value) => Boolean(value))}
              />
              <Text as="span" variant="body">
                Include warped front export (OpenCV required)
              </Text>
            </Stack>
          </label>
          <label className="output-options__toggle">
            <Stack direction="row" gap={8} align="center">
              <input
                type="checkbox"
                checked={config.includeManifests}
                onChange={handleOptionChange('includeManifests', (value) => Boolean(value))}
              />
              <Text as="span" variant="body">
                Include JSON manifest per card pair
              </Text>
            </Stack>
          </label>
        </Stack>
      </details>
      <Stack gap={8}>
        <Text as="h3" variant="label">
          Session summary
        </Text>
        <Text variant="body">Files selected: {files.length}</Text>
        <Text variant="body">Pairs ready for export: {pairs.length}</Text>
        <Text variant="body">Naming presets: {naming.length}</Text>
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
          Export complete. Check your folder{directorySupported ? '' : ' or downloads list'} for the generated assets.
        </Text>
      )}
      {exportState === 'error' && errorMessage && (
        <Text role="alert" variant="body">
          {errorMessage}
        </Text>
      )}
      <StepNavigation
        step="output"
        nextLabel="Export now"
        nextDisabled={!readyForExport || exportState === 'running'}
        onNext={handleExport}
      />
    </Stack>
  );
};
