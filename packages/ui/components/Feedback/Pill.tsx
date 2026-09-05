import React from 'react';

export interface PillProps extends React.HTMLAttributes<HTMLDivElement> {
  status?: 'default' | 'good' | 'warn' | 'bad';
  variant?: 'soft' | 'outline' | 'solid';
  icon?: React.ReactNode;
}

export const Pill: React.FC<PillProps> = ({
  status = 'default',
  variant = 'soft',
  icon,
  className = '',
  children,
  ...props
}) => {
  const baseClasses =
    'inline-flex items-center gap-[6px] px-[14px] py-[6px] rounded-pill text-[12px] font-semibold tracking-[0.01em] flex-none font-body';

  let colorClasses = '';
  if (status === 'default') {
    if (variant === 'soft') colorClasses = 'bg-accent-soft text-accent-deep';
    else if (variant === 'outline')
      colorClasses = 'bg-transparent text-muted border border-border';
    else if (variant === 'solid') colorClasses = 'bg-accent-deep text-surface';
  } else if (status === 'good') {
    colorClasses = 'bg-status-good-tint text-status-good-deep';
  } else if (status === 'warn') {
    colorClasses = 'bg-status-warn-tint text-status-warn-deep';
  } else if (status === 'bad') {
    colorClasses = 'bg-status-bad-tint text-status-bad-deep';
  }

  return (
    <div className={`${baseClasses} ${colorClasses} ${className}`} {...props}>
      {icon && <span className="w-[13px] h-[13px] flex-none">{icon}</span>}
      {children}
    </div>
  );
};
