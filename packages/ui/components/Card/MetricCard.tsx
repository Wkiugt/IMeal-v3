import React from 'react';
import { Card } from './Card';

export interface MetricCardProps extends React.HTMLAttributes<HTMLDivElement> {
  label: string;
  value: string | number;
  icon?: React.ReactNode;
}

export const MetricCard: React.FC<MetricCardProps> = ({
  label,
  value,
  icon,
  className = '',
  ...props
}) => {
  // FIX: removed !p-5, relying on Card's new conditional padding override
  return (
    <Card
      className={`bg-gradient-to-br from-accent-tint to-accent-soft p-5 ${className}`}
      {...props}
    >
      <div className="flex flex-col gap-2">
        {icon && <div className="text-accent-deep w-6 h-6">{icon}</div>}
        <div className="font-display text-[34px] font-bold tracking-[-0.02em] text-fg leading-none">
          {value}
        </div>
        <div className="text-[13px] text-muted font-body">{label}</div>
      </div>
    </Card>
  );
};
