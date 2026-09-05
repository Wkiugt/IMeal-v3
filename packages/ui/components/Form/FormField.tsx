import React, { useId } from 'react';

export interface FormFieldProps extends React.InputHTMLAttributes<HTMLInputElement> {
  label: string;
  error?: string;
}

export const FormField: React.FC<FormFieldProps> = ({
  label,
  error,
  className = '',
  id,
  ...props
}) => {
  // FIX: Generated unique ID for a11y linking between label and input
  const generatedId = useId();
  const inputId = id || generatedId;

  // FIX: Dynamic error classes applying exact status-bad tokens
  const errorClasses = error
    ? 'border-status-bad-deep focus:border-status-bad-deep focus:ring-status-bad-tint'
    : 'border-border focus:border-accent-deep focus:ring-accent-soft';

  return (
    <div className={`flex flex-col gap-[6px] w-full ${className}`}>
      <label
        htmlFor={inputId}
        className="text-[11.5px] font-bold tracking-[0.03em] text-muted uppercase font-body"
      >
        {label}
      </label>
      <input
        id={inputId}
        className={`w-full px-[13px] py-[11px] rounded-sm border bg-accent-tint text-[13.5px] text-fg font-body transition-all duration-150 motion-reduce:transition-none placeholder:text-muted focus:outline-none focus:ring-[3px] focus:bg-surface ${errorClasses}`}
        {...props}
      />
      {/* Render error text strictly using bad status token */}
      {error && (
        <span className="text-[12px] text-status-bad-deep font-body font-semibold">
          {error}
        </span>
      )}
    </div>
  );
};
