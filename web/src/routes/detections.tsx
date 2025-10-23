import { createRoute, redirect } from '@tanstack/react-router';

import { DetectSplitStep } from '../steps/DetectSplit/DetectSplitStep';
import { getStepPath, useSessionStore } from '../state/session';
import { rootRoute } from './__root';

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
  component: DetectSplitStep
});
