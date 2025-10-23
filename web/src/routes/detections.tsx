import { createRoute, redirect } from '@tanstack/react-router';

import { StepNavigation } from '../components/StepNavigation';
import { Detection, FileAsset, getStepPath, useSessionStore } from '../state/session';
import { Stack } from '../ui/Stack';
import { Text } from '../ui/Text';
import { rootRoute } from './__root';

const createMockDetections = (files: FileAsset[]): Detection[] => {
  return files.map((file, index) => ({
    id: `${file.id}-det-${index}`,
    fileId: file.id,
    label: 'Product',
    confidence: 0.9,
    bounds: [0.1, 0.1, 0.8, 0.8],
    accepted: true
  }));
};

const DetectionsStep = () => {
  const { files, detections, setDetections } = useSessionStore((state) => ({
    files: state.files,
    detections: state.detections,
    setDetections: state.setDetections
  }));

  const handleMock = () => {
    if (files.length === 0) return;
    setDetections(createMockDetections(files));
  };

  const toggleAccepted = (id: string, accepted: boolean) => {
    setDetections(
      detections.map((det) =>
        det.id === id
          ? {
              ...det,
              accepted
            }
          : det
      )
    );
  };

  return (
    <Stack gap={24}>
      <Stack gap={8}>
        <Text as="h2" variant="title">
          Review detections
        </Text>
        <Text variant="body">
          The wizard highlights detected objects to help you quickly curate which photos should continue to
          pairing.
        </Text>
      </Stack>
      <Stack gap={8}>
        <Text variant="muted">
          Detections are typically generated automatically. Use the mock button while the model integration is in
          progress.
        </Text>
        <button type="button" className="ui-button ui-button--secondary" onClick={handleMock} disabled={files.length === 0}>
          Mock detections from selected files
        </button>
      </Stack>
      {detections.length > 0 ? (
        <Stack gap={12} aria-live="polite">
          {detections.map((det) => {
            const file = files.find((item) => item.id === det.fileId);
            return (
              <Stack key={det.id} direction="row" gap={12} align="center" justify="between" className="ui-card">
                <Text as="span" variant="body">
                  {file?.name ?? 'Unknown file'} — {(det.confidence * 100).toFixed(0)}% confidence
                </Text>
                <Stack direction="row" gap={8}>
                  <button
                    type="button"
                    className="ui-button ui-button--secondary"
                    onClick={() => toggleAccepted(det.id, true)}
                    aria-pressed={det.accepted === true}
                  >
                    Accept
                  </button>
                  <button
                    type="button"
                    className="ui-button ui-button--ghost"
                    onClick={() => toggleAccepted(det.id, false)}
                    aria-pressed={det.accepted === false}
                  >
                    Reject
                  </button>
                </Stack>
              </Stack>
            );
          })}
        </Stack>
      ) : (
        <Text variant="muted">No detections yet.</Text>
      )}
      <StepNavigation step="detections" nextLabel="Pair imagery" />
    </Stack>
  );
};

export const detectionsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/detections',
  beforeLoad: () => {
    const state = useSessionStore.getState();
    if (!state.canAccessStep('detections')) {
      const fallback = state.getFirstAccessibleStep();
      throw redirect({ to: getStepPath(fallback) });
    }
  },
  component: DetectionsStep
});
