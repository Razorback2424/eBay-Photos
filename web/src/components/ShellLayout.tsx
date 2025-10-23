import { ReactNode, useEffect } from 'react';
import { useRouterState } from '@tanstack/react-router';

import { SessionStep, STEP_PATHS, useSessionStore } from '../state/session';
import { Card } from '../ui/Card';
import { Stack } from '../ui/Stack';
import { Text } from '../ui/Text';
import { StepIndicator } from './StepIndicator';

export interface ShellLayoutProps {
  banner?: ReactNode;
  children: ReactNode;
}

const pathToStep = (pathname: string): SessionStep => {
  const entry = Object.entries(STEP_PATHS).find(([, path]) => path === pathname);
  if (!entry) {
    return 'files';
  }
  return entry[0] as SessionStep;
};

export const ShellLayout = ({ banner, children }: ShellLayoutProps) => {
  const routerState = useRouterState();
  const { setCurrentStep, currentStep } = useSessionStore((state) => ({
    setCurrentStep: state.setCurrentStep,
    currentStep: state.currentStep
  }));

  useEffect(() => {
    const pathname = routerState.location.pathname;
    const step = pathToStep(pathname);
    if (step !== currentStep) {
      setCurrentStep(step);
    }
  }, [routerState.location.pathname, currentStep, setCurrentStep]);

  return (
    <div className="app-shell">
      <Stack gap={24}>
        {banner}
        <header>
          <Text as="h1" variant="title">
            eBay Photos Workflow
          </Text>
          <Text variant="muted">Guided wizard to prepare product imagery for listing.</Text>
        </header>
        <StepIndicator />
        <Card>{children}</Card>
      </Stack>
    </div>
  );
};
