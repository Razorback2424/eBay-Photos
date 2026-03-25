import { createRoute, redirect } from '@tanstack/react-router';

import { SourcePairReviewStep } from '../steps/SourcePairs/SourcePairReviewStep';
import { getStepPath, useSessionStore } from '../state/session';
import { rootRoute } from './__root';

export const sourcePairsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/source-pairs',
  beforeLoad: () => {
    const state = useSessionStore.getState();
    if (state.intakeMode !== 'batch') {
      throw redirect({ to: getStepPath('detections') });
    }
    if (!state.canAccessStep('sourcePairs')) {
      const fallback = state.getFirstAccessibleStep();
      throw redirect({ to: getStepPath(fallback) });
    }
  },
  component: SourcePairReviewStep
});
