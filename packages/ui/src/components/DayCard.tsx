import React from 'react';

export interface DayCardProps {
  date: string;
  dayName: string;
  checked: boolean;
  disabled?: boolean;
  error?: string;
  onChange: (checked: boolean) => void;
}

export const DayCard: React.FC<DayCardProps> = ({
  date,
  dayName,
  checked,
  disabled,
  error,
  onChange,
}) => {
  return (
    <div
      style={{
        border: error ? '1px solid #d32f2f' : '1px solid #e0e0e0',
        borderRadius: '8px',
        padding: '16px',
        marginBottom: '12px',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        backgroundColor: disabled ? '#f5f5f5' : '#ffffff',
      }}
    >
      <div>
        <div style={{ fontWeight: '600', fontSize: '16px', color: '#333' }}>
          {dayName}
        </div>
        <div style={{ color: '#757575', fontSize: '14px', marginTop: '4px' }}>
          {date}
        </div>
        {error && (
          <div
            style={{
              color: '#d32f2f',
              fontSize: '12px',
              marginTop: '6px',
              fontWeight: '500',
            }}
          >
            {error}
          </div>
        )}
      </div>
      <div>
        <input
          type="checkbox"
          checked={checked}
          disabled={disabled}
          onChange={(e) => onChange(e.target.checked)}
          style={{
            width: '24px',
            height: '24px',
            cursor: disabled ? 'not-allowed' : 'pointer',
          }}
        />
      </div>
    </div>
  );
};
