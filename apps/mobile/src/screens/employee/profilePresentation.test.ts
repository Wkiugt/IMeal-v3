import { describe, expect, it } from 'vitest';
import { initials } from '../../businessDate';
import {
  getNotificationPresentation,
  resolveProfileIdentity,
} from './profilePresentation';

describe('profile notification presentation', () => {
  const labels = {
    enabled: 'Enabled',
    disabled: 'Disabled',
    notConfigured: 'Not configured',
    unavailable: 'Unavailable',
  };

  it('shows the disabled status and contextual warning only for denied permissions', () => {
    expect(getNotificationPresentation('denied', labels)).toEqual({
      status: 'inactive',
      label: 'Disabled',
      showWarning: true,
    });
  });

  it('removes the warning when system notifications are enabled', () => {
    expect(getNotificationPresentation('granted', labels)).toEqual({
      status: 'active',
      label: 'Enabled',
      showWarning: false,
    });
  });
});

describe('profile identity presentation', () => {
  it('prefers the trimmed employee name and derives initials from it', () => {
    const name = resolveProfileIdentity(
      { name: '  Ada Lovelace  ', email: 'ada@example.test' },
      'Employee name unavailable',
    );

    expect(name).toBe('Ada Lovelace');
    expect(initials(name, '?')).toBe('AL');
  });

  it.each([
    ['  ', '  blank@example.test  ', 'blank', 'B'],
    [undefined, '  staff01@example.test  ', 'staff01', 'S'],
  ])(
    'uses the trimmed email local-part when name is %s',
    (name, email, expectedName, expectedInitials) => {
      const resolved = resolveProfileIdentity(
        { name, email },
        'Employee name unavailable',
      );

      expect(resolved).toBe(expectedName);
      expect(initials(resolved, '?')).toBe(expectedInitials);
    },
  );

  it('uses the translated identity placeholder and its initials when both are unavailable', () => {
    const resolved = resolveProfileIdentity(
      { name: undefined, email: '   ' },
      'Tên nhân viên chưa có',
    );

    expect(resolved).toBe('Tên nhân viên chưa có');
    expect(initials(resolved, '?')).toBe('TN');
  });
});
