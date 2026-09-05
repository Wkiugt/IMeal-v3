import React, { useState, useMemo } from 'react';
import { DayCard } from './DayCard';

export interface RegistrationDay {
  id: string;
  date: string;
  dayName: string;
  editable: boolean;
}

export interface RegistrationFormProps {
  days: RegistrationDay[];
  initialSelectedIds?: string[];
  onSubmit: (selectedIds: string[]) => Promise<{
    success: boolean;
    failedIds?: string[];
    errorMsg?: string;
  }>;
}

export const RegistrationForm: React.FC<RegistrationFormProps> = ({
  days,
  initialSelectedIds = [],
  onSubmit,
}) => {
  const [selectedIds, setSelectedIds] = useState<Set<string>>(
    new Set(initialSelectedIds),
  );
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [failedIds, setFailedIds] = useState<Set<string>>(new Set());
  const [globalError, setGlobalError] = useState<string | null>(null);

  const editableDays = useMemo(() => days.filter((d) => d.editable), [days]);

  const isAllSelected = useMemo(() => {
    if (editableDays.length === 0) return false;
    return editableDays.every((d) => selectedIds.has(d.id));
  }, [editableDays, selectedIds]);

  const handleSelectAll = (checked: boolean) => {
    const newSelected = new Set(selectedIds);
    editableDays.forEach((d) => {
      if (checked) {
        newSelected.add(d.id);
      } else {
        newSelected.delete(d.id);
      }
    });
    setSelectedIds(newSelected);
    setFailedIds(new Set()); // clear errors on change
    setGlobalError(null);
  };

  const handleDayChange = (id: string, checked: boolean) => {
    const newSelected = new Set(selectedIds);
    if (checked) {
      newSelected.add(id);
    } else {
      newSelected.delete(id);
    }
    setSelectedIds(newSelected);
    setFailedIds(new Set());
    setGlobalError(null);
  };

  const handleSubmit = async () => {
    setIsSubmitting(true);
    setGlobalError(null);
    setFailedIds(new Set());

    try {
      const result = await onSubmit(Array.from(selectedIds));
      if (!result.success) {
        if (result.failedIds && result.failedIds.length > 0) {
          setFailedIds(new Set(result.failedIds));
          setGlobalError(
            result.errorMsg || 'Một số ngày đăng ký không thành công.',
          );
        } else {
          setGlobalError(result.errorMsg || 'Đã xảy ra lỗi khi lưu đăng ký.');
        }
      }
    } catch (err) {
      setGlobalError('Lỗi kết nối, vui lòng thử lại.');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div
      style={{
        paddingBottom: '90px',
        position: 'relative',
        maxWidth: '600px',
        margin: '0 auto',
        fontFamily: 'sans-serif',
      }}
    >
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          marginBottom: '16px',
          padding: '0 8px',
        }}
      >
        <h2 style={{ margin: 0, fontSize: '20px', color: '#333' }}>
          Đăng ký cơm tuần
        </h2>
        {editableDays.length > 0 && (
          <label
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '8px',
              fontWeight: 'bold',
              color: '#1976d2',
              cursor: 'pointer',
            }}
          >
            <input
              type="checkbox"
              checked={isAllSelected}
              onChange={(e) => handleSelectAll(e.target.checked)}
              disabled={isSubmitting}
              style={{ width: '18px', height: '18px' }}
            />
            Chọn cả tuần
          </label>
        )}
      </div>

      {globalError && (
        <div
          style={{
            backgroundColor: '#ffebee',
            color: '#c62828',
            padding: '12px',
            borderRadius: '8px',
            marginBottom: '16px',
            margin: '0 8px 16px 8px',
          }}
        >
          {globalError}
        </div>
      )}

      <div style={{ padding: '0 8px' }}>
        {days.map((day) => (
          <DayCard
            key={day.id}
            date={day.date}
            dayName={day.dayName}
            checked={selectedIds.has(day.id)}
            disabled={!day.editable || isSubmitting}
            onChange={(checked) => handleDayChange(day.id, checked)}
            error={
              failedIds.has(day.id) ? 'Đăng ký không thành công' : undefined
            }
          />
        ))}
      </div>

      <div
        style={{
          position: 'fixed',
          bottom: 0,
          left: 0,
          right: 0,
          backgroundColor: '#ffffff',
          padding: '16px',
          boxShadow: '0 -4px 12px rgba(0,0,0,0.05)',
          display: 'flex',
          justifyContent: 'center',
          zIndex: 100,
        }}
      >
        <button
          onClick={handleSubmit}
          disabled={isSubmitting}
          style={{
            width: '100%',
            maxWidth: '400px',
            padding: '14px',
            backgroundColor: isSubmitting ? '#e0e0e0' : '#1976d2',
            color: isSubmitting ? '#9e9e9e' : '#ffffff',
            border: 'none',
            borderRadius: '12px',
            fontSize: '16px',
            fontWeight: 'bold',
            cursor: isSubmitting ? 'not-allowed' : 'pointer',
            transition: 'background-color 0.2s',
          }}
        >
          {isSubmitting ? 'Đang lưu...' : 'Lưu đăng ký'}
        </button>
      </div>
    </div>
  );
};
