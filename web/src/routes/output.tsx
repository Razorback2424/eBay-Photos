import { ChangeEvent, useEffect, useState } from 'react';
import { createRoute, redirect } from '@tanstack/react-router';

import { StepNavigation } from '../components/StepNavigation';
import { getStepPath, OutputConfig, useSessionStore } from '../state/session';
import { Stack } from '../ui/Stack';
import { Text } from '../ui/Text';
import { rootRoute } from './__root';

const defaultOutput: OutputConfig = {
  directory: '',
  includeManifests: true,
  format: 'json'
};

const OutputStep = () => {
  const { files, detections, pairs, naming, output, setOutput } = useSessionStore((state) => ({
    files: state.files,
    detections: state.detections,
    pairs: state.pairs,
    naming: state.naming,
    output: state.output,
    setOutput: state.setOutput
  }));
  const [isFinished, setFinished] = useState(false);

  useEffect(() => {
    if (!output) {
      setOutput(defaultOutput);
    }
  }, [output, setOutput]);

  const handleChange = (key: keyof OutputConfig) => (event: ChangeEvent<HTMLInputElement | HTMLSelectElement>) => {
    const value =
      key === 'includeManifests' ? (event.target as HTMLInputElement).checked : event.target.value;
    setOutput({
      ...(output ?? defaultOutput),
      [key]: value
    });
  };

  const handleFinish = () => {
    setFinished(true);
  };

  const config = output ?? defaultOutput;

  return (
    <Stack gap={24}>
      <Stack gap={8}>
        <Text as="h2" variant="title">
          Export imagery
        </Text>
        <Text variant="body">
          Choose how the processed assets should be delivered. These settings drive the automation pipeline.
        </Text>
      </Stack>
      <Stack gap={16}>
        <label>
          <Text as="span" variant="muted">
            Output directory
          </Text>
          <input
            type="text"
            value={config.directory}
            onChange={handleChange('directory')}
            placeholder="e.g. /Users/me/exports"
          />
        </label>
        <label>
          <Stack direction="row" align="center" gap={8}>
            <input type="checkbox" checked={config.includeManifests} onChange={handleChange('includeManifests')} />
            <Text as="span" variant="body">
              Include manifest files
            </Text>
          </Stack>
        </label>
        <label>
          <Text as="span" variant="muted">
            Export format
          </Text>
          <select value={config.format} onChange={handleChange('format')}>
            <option value="json">JSON manifest</option>
            <option value="csv">CSV summary</option>
            <option value="xml">XML feed</option>
          </select>
        </label>
      </Stack>
      <Stack gap={8}>
        <Text as="h3" variant="label">
          Summary
        </Text>
        <Text variant="body">Files selected: {files.length}</Text>
        <Text variant="body">Accepted detections: {detections.filter((det) => det.accepted !== false).length}</Text>
        <Text variant="body">Pairs created: {pairs.length}</Text>
        <Text variant="body">Naming presets: {naming.length}</Text>
      </Stack>
      {isFinished && (
        <Text role="status" aria-live="polite" variant="muted">
          Output settings saved. You are ready to run the automation scripts.
        </Text>
      )}
      <StepNavigation
        step="output"
        nextLabel="Finish"
        nextDisabled={config.directory.trim() === ''}
        onNext={handleFinish}
      />
    </Stack>
  );
};

export const outputRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/output',
  beforeLoad: () => {
    const state = useSessionStore.getState();
    if (!state.canAccessStep('output')) {
      const fallback = state.getFirstAccessibleStep();
      throw redirect({ to: getStepPath(fallback) });
    }
  },
  component: OutputStep
});
