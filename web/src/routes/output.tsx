import { createRoute, redirect } from '@tanstack/react-router';

import { PickOutputStep } from '../steps/PickOutput/PickOutputStep';
import { getStepPath, useSessionStore } from '../state/session';
import { rootRoute } from './__root';

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
  component: PickOutputStep
});
