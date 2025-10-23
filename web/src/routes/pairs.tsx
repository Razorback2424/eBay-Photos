import { createRoute, redirect } from '@tanstack/react-router';

import { StepNavigation } from '../components/StepNavigation';
import { getStepPath, Pairing, useSessionStore } from '../state/session';
import { Stack } from '../ui/Stack';
import { Text } from '../ui/Text';
import { rootRoute } from './__root';

const buildPairs = (): Pairing[] => {
  const state = useSessionStore.getState();
  const acceptedDetections = state.detections.filter((det) => det.accepted !== false);
  return acceptedDetections.map((det, index) => ({
    id: `${det.id}-pair-${index}`,
    primaryFileId: det.fileId,
    status: 'pending'
  }));
};

const PairsStep = () => {
  const { pairs, files, detections, setPairs } = useSessionStore((state) => ({
    pairs: state.pairs,
    files: state.files,
    detections: state.detections,
    setPairs: state.setPairs
  }));

  const handleAutoPair = () => {
    const generated = buildPairs();
    setPairs(generated);
  };

  return (
    <Stack gap={24}>
      <Stack gap={8}>
        <Text as="h2" variant="title">
          Pair related imagery
        </Text>
        <Text variant="body">
          Group hero, detail, and lifestyle shots so naming and export settings can apply consistently.
        </Text>
      </Stack>
      <Stack gap={8}>
        <Text variant="muted">
          Start with auto-pair suggestions based on detections. You can refine matches manually.
        </Text>
        <button type="button" className="ui-button ui-button--secondary" onClick={handleAutoPair} disabled={detections.length === 0}>
          Suggest pairs from detections
        </button>
      </Stack>
      {pairs.length > 0 ? (
        <Stack gap={12} aria-live="polite">
          {pairs.map((pair) => {
            const file = files.find((item) => item.id === pair.primaryFileId);
            return (
              <Stack key={pair.id} className="ui-card" gap={4}>
                <Text as="span" variant="label">
                  Pair {pair.id}
                </Text>
                <Text as="span" variant="body">
                  Primary: {file?.name ?? 'Unknown file'}
                </Text>
                <Text as="span" variant="muted">
                  Status: {pair.status}
                </Text>
              </Stack>
            );
          })}
        </Stack>
      ) : (
        <Text variant="muted">No pairs yet. Generate suggestions to begin.</Text>
      )}
      <StepNavigation step="pairs" nextLabel="Naming" />
    </Stack>
  );
};

export const pairsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/pairs',
  beforeLoad: () => {
    const state = useSessionStore.getState();
    if (!state.canAccessStep('pairs')) {
      const fallback = state.getFirstAccessibleStep();
      throw redirect({ to: getStepPath(fallback) });
    }
  },
  component: PairsStep
});
