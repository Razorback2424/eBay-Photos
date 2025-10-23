import clsx from 'clsx';
import { useMemo } from 'react';

import './styles.css';

interface ProgressBarProps {
  value: number;
  max: number;
  label?: string;
  className?: string;
}

export const ProgressBar = ({ value, max, label, className }: ProgressBarProps) => {
  const clampedValue = useMemo(() => {
    if (!Number.isFinite(value)) {
      return 0;
    }
    return Math.min(Math.max(value, 0), Math.max(1, max));
  }, [value, max]);

  const percentage = max > 0 ? Math.round((clampedValue / max) * 100) : 0;

  return (
    <div className={clsx('ui-progress', className)}>
      <div
        className="ui-progress__meter"
        role="progressbar"
        aria-label={label}
        aria-valuemin={0}
        aria-valuenow={clampedValue}
        aria-valuemax={Math.max(1, max)}
      >
        <span className="ui-progress__value" style={{ width: `${percentage}%` }} aria-hidden="true" />
      </div>
      <span className="ui-progress__text">{percentage}%</span>
    </div>
  );
};
