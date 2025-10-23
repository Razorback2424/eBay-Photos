import { createRoute, redirect } from '@tanstack/react-router';

import { NameCardsStep } from '../steps/NameCards/NameCardsStep';
import { getStepPath, useSessionStore } from '../state/session';
import { rootRoute } from './__root';

const NamingStep = () => <NameCardsStep />;

export const namingRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/naming',
  beforeLoad: () => {
    const state = useSessionStore.getState();
    if (!state.canAccessStep('naming')) {
      const fallback = state.getFirstAccessibleStep();
      throw redirect({ to: getStepPath(fallback) });
    }
  },
  component: NamingStep
});

