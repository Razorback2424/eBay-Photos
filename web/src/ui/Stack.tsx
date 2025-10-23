import { HTMLAttributes } from 'react';
import clsx from 'clsx';

type StackDirection = 'row' | 'column';

export interface StackProps extends HTMLAttributes<HTMLDivElement> {
  direction?: StackDirection;
  gap?: number;
  align?: 'start' | 'center' | 'end' | 'stretch';
  justify?: 'start' | 'center' | 'end' | 'between';
}

export const Stack = ({
  direction = 'column',
  gap = 8,
  align = 'stretch',
  justify = 'start',
  className,
  style,
  ...rest
}: StackProps) => {
  const justifyContent =
    justify === 'between' ? 'space-between' : justify === 'end' ? 'flex-end' : justify === 'center' ? 'center' : 'flex-start';
  const alignItems =
    align === 'start' ? 'flex-start' : align === 'end' ? 'flex-end' : align === 'center' ? 'center' : 'stretch';

  return (
    <div
      className={clsx('ui-stack', className)}
      style={{
        display: 'flex',
        flexDirection: direction,
        gap,
        alignItems,
        justifyContent,
        ...style
      }}
      {...rest}
    />
  );
};
