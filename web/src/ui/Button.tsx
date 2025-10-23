import { ButtonHTMLAttributes, forwardRef } from 'react';
import clsx from 'clsx';

export type ButtonVariant = 'primary' | 'secondary' | 'ghost';

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(({ variant = 'primary', className, ...rest }, ref) => {
  return <button ref={ref} className={clsx('ui-button', `ui-button--${variant}`, className)} {...rest} />;
});

Button.displayName = 'Button';
