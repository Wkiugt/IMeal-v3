import { describe, expect, it } from 'vitest';
import { getNotificationPresentation } from './profilePresentation';

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
