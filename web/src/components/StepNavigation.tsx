import { useRouter } from '@tanstack/react-router';

import { getStepPath, SessionStep, useSessionStore } from '../state/session';
import { Button } from '../ui/Button';
import { Text } from '../ui/Text';

export interface StepNavigationProps {
  step: SessionStep;
  nextLabel?: string;
  backLabel?: string;
  nextDisabled?: boolean;
  onNext?: () => boolean | void | Promise<boolean | void>;
}

export const StepNavigation = ({
  step,
  nextLabel = 'Next',
  backLabel = 'Back',
  nextDisabled,
  onNext
}: StepNavigationProps) => {
  const router = useRouter();
  const { getNextStep, getPreviousStep, setCurrentStep, completeStep } = useSessionStore((state) => ({
    getNextStep: state.getNextStep,
    getPreviousStep: state.getPreviousStep,
    setCurrentStep: state.setCurrentStep,
    completeStep: state.completeStep
  }));

  const nextStep = getNextStep(step);
  const previousStep = getPreviousStep(step);

  const handleBack = () => {
    if (!previousStep) return;
    setCurrentStep(previousStep);
    router.navigate({ to: getStepPath(previousStep) });
  };

  const handleNext = async () => {
    if (onNext) {
      const result = await onNext();
      if (result === false) {
        return;
      }
    }
    completeStep(step);
    if (!nextStep) {
      return;
    }
    setCurrentStep(nextStep);
    router.navigate({ to: getStepPath(nextStep) });
  };

  const handleNextClick = () => {
    void handleNext();
  };

  return (
    <nav className="navigation-bar" aria-label="Wizard navigation">
      <div>
        <Text as="span" variant="muted">
          Use the buttons below or press Enter to continue.
        </Text>
      </div>
      <div className="navigation-bar__actions">
        <Button variant="secondary" onClick={handleBack} disabled={!previousStep} aria-disabled={!previousStep}>
          {backLabel}
        </Button>
        <Button onClick={handleNextClick} disabled={nextDisabled || (!nextStep && !onNext)}>
          {nextLabel}
        </Button>
      </div>
    </nav>
  );
};
