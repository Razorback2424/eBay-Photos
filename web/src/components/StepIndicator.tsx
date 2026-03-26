import clsx from 'clsx';

import { SessionStep, useSessionStore } from '../state/session';
import { Text } from '../ui/Text';

const STEP_LABELS: Record<SessionStep, string> = {
  files: 'Import files',
  sourcePairs: 'Review source pairs',
  detections: 'Review detections',
  pairs: 'Pair imagery',
  naming: 'Naming',
  output: 'Output'
};

export const StepIndicator = () => {
  const { currentStep, completedSteps, visibleSteps } = useSessionStore((state) => ({
    currentStep: state.currentStep,
    completedSteps: state.completedSteps,
    visibleSteps: state.getVisibleSteps()
  }));

  const currentIndex = Math.max(visibleSteps.indexOf(currentStep), 0);
  const currentLabel = STEP_LABELS[currentStep];
  const completedCount = completedSteps.filter((step) => visibleSteps.includes(step)).length;

  return (
    <div className="step-indicator" aria-label="Wizard progress">
      <div className="step-indicator__summary">
        <Text as="span" variant="label">
          Step {currentIndex + 1} of {visibleSteps.length}
        </Text>
        <Text as="span" variant="body">
          {currentLabel}
        </Text>
      </div>
      <div className="step-indicator__track" aria-hidden="true">
        {visibleSteps.map((step) => {
          const isActive = currentStep === step;
          const isComplete = completedSteps.includes(step);
          return (
            <span
              key={step}
              className={clsx('step-indicator__segment', {
                'step-indicator__segment--active': isActive,
                'step-indicator__segment--complete': isComplete
              })}
            />
          );
        })}
      </div>
      <Text as="span" variant="muted" className="step-indicator__count">
        {completedCount} completed
      </Text>
    </div>
  );
};
