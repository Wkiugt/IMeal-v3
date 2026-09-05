import React from 'react';

export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'primary' | 'secondary' | 'ghost' | 'icon';
  icon?: React.ReactNode;
}

export const Button: React.FC<ButtonProps> = ({
  variant = 'primary',
  icon,
  className = '',
  type = 'button',
  children,
  ...props
}) => {
  // Base classes enforce mobile-friendly touch targets and strict token mapping
  // FIX: changed active:scale-98 to active:scale-[0.98] to properly compile in Tailwind
  const baseClasses =
    'inline-flex items-center justify-center gap-2 rounded-pill font-body font-semibold transition-all duration-150 motion-reduce:transition-none focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-deep focus-visible:ring-offset-2 active:scale-[0.98] flex-none';

  let variantClasses = '';
  if (variant === 'primary') {
    variantClasses =
      'bg-accent-deep text-surface shadow-sm hover:shadow-md hover:bg-[color-mix(in_oklch,var(--accent-deep)_88%,black)] px-5 py-[11px] text-[14px]';
  } else if (variant === 'secondary') {
    variantClasses =
      'bg-surface text-fg border border-border hover:border-muted hover:bg-fg-soft px-5 py-[11px] text-[14px]';
  } else if (variant === 'ghost') {
    variantClasses =
      'bg-transparent text-muted hover:text-fg hover:bg-fg-soft px-3 py-2 text-[13px]';
  } else if (variant === 'icon') {
    variantClasses =
      'w-[36px] h-[36px] p-0 grid place-items-center text-muted border border-border hover:text-fg hover:border-muted hover:bg-fg-soft';
  }

  return (
    <button
      type={type}
      className={`${baseClasses} ${variantClasses} ${className}`}
      {...props}
    >
      {icon && <span className="w-4 h-4 flex-none">{icon}</span>}
      {children}
    </button>
  );
};
