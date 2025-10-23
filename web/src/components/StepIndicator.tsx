import clsx from 'clsx';

import { SESSION_STEPS, SessionStep, useSessionStore } from '../state/session';
import { Text } from '../ui/Text';

const STEP_LABELS: Record<SessionStep, string> = {
  files: 'Import files',
  detections: 'Review detections',
  pairs: 'Pair imagery',
  naming: 'Naming',
  output: 'Output'
};

export const StepIndicator = () => {
  const { currentStep, completedSteps } = useSessionStore((state) => ({
    currentStep: state.currentStep,
    completedSteps: state.completedSteps
  }));

  return (
    <ul className="step-indicator" aria-label="Wizard progress">
      {SESSION_STEPS.map((step) => {
        const isActive = currentStep === step;
        const isComplete = completedSteps.includes(step);
        return (
          <li
            key={step}
            className={clsx('step-indicator__item', {
              'step-indicator__item--active': isActive,
              'step-indicator__item--complete': isComplete
            })}
            aria-current={isActive ? 'step' : undefined}
          >
            <span className="step-indicator__dot" aria-hidden="true" />
            <Text as="span" variant={isActive ? 'body' : 'muted'}>
              {STEP_LABELS[step]}
            </Text>
          </li>
        );
      })}
    </ul>
  );
};
