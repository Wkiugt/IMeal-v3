import { describe, expect, it } from 'vitest';
import {
  loadNotificationModule,
  supportsNotificationModule,
} from './notificationRuntime';

describe('notification runtime compatibility', () => {
  it('does not load remote notifications in Expo Go', async () => {
    let loadCount = 0;

    const module = await loadNotificationModule('android', true, async () => {
      loadCount += 1;
      throw new Error('expo-notifications must not load in Expo Go');
    });

    expect(module).toBeNull();
    expect(loadCount).toBe(0);
    expect(supportsNotificationModule('android', true)).toBe(false);
  });

  it('loads remote notifications in a native development build', async () => {
    const module = { getExpoPushTokenAsync: async () => ({ data: 'token' }) };

    await expect(
      loadNotificationModule('android', false, async () => module),
    ).resolves.toBe(module);
    expect(supportsNotificationModule('android', false)).toBe(true);
  });

  it('does not load native remote notifications on web', async () => {
    const module = await loadNotificationModule('web', false, async () => ({
      getExpoPushTokenAsync: async () => ({ data: 'token' }),
    }));

    expect(module).toBeNull();
    expect(supportsNotificationModule('web', false)).toBe(false);
  });
});
