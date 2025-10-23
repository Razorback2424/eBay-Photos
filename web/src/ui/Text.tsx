import { HTMLAttributes } from 'react';
import clsx from 'clsx';

export type TextVariant = 'body' | 'muted' | 'label' | 'title';

export interface TextProps extends HTMLAttributes<HTMLParagraphElement> {
  variant?: TextVariant;
  as?: 'p' | 'span' | 'h1' | 'h2' | 'h3';
}

export const Text = ({ variant = 'body', as = 'p', className, ...rest }: TextProps) => {
  const Component = as;
  return <Component className={clsx('ui-text', `ui-text--${variant}`, className)} {...rest} />;
};
