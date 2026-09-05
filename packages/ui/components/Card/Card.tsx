import React from 'react';

export const Card: React.FC<React.HTMLAttributes<HTMLDivElement>> = ({
  className = '',
  children,
  ...props
}) => {
  // FIX: Drop default p-6 if a custom padding (like p-5) is passed in className to avoid using !important
  const defaultPadding = className.includes('p-') ? '' : 'p-6';

  return (
    <div
      className={`bg-surface border border-border rounded-lg shadow-sm flex flex-col gap-4 ${defaultPadding} ${className}`}
      {...props}
    >
      {children}
    </div>
  );
};
