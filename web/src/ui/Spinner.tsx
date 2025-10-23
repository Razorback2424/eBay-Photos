import clsx from 'clsx';

import './styles.css';

export type SpinnerSize = 'sm' | 'md';

interface SpinnerProps {
  label?: string;
  size?: SpinnerSize;
  className?: string;
}

export const Spinner = ({ label, size = 'md', className }: SpinnerProps) => {
  return (
    <span
      className={clsx('ui-spinner', `ui-spinner--${size}`, className)}
      role="status"
      aria-live="polite"
      aria-label={label ?? 'Loading'}
    >
      <span className="ui-spinner__circle" aria-hidden="true" />
      {label && <span className="ui-spinner__label">{label}</span>}
    </span>
  );
};
