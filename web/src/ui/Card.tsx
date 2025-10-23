import { HTMLAttributes } from 'react';
import clsx from 'clsx';

export const Card = ({ className, ...rest }: HTMLAttributes<HTMLElement>) => {
  return <section className={clsx('ui-card', className)} {...rest} />;
};
