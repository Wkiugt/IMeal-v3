import React from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  MobileApiError,
  throwMobileResponseError,
} from '../api/mobileApiError';
import {
  SessionProvider,
  useSession,
  type SessionContextValue,
} from './session';

const storage = new Map<string, string>();
const authMock = vi.hoisted(() => ({
  bootstrapSession: vi.fn(),
  logout: vi.fn(),
  requestOtp: vi.fn(),
  verifyOtp: vi.fn(),
}));
const navigationMock = vi.hoisted(() => ({
  isReady: vi.fn(() => true),
  reset: vi.fn(),
}));

vi.mock('react-native', () => ({ Platform: { OS: 'ios' } }));
vi.mock('expo-secure-store', () => ({
  getItemAsync: vi.fn(async (key: string) => storage.get(key) ?? null),
  setItemAsync: vi.fn(async (key: string, value: string) => {
    storage.set(key, value);
  }),
  deleteItemAsync: vi.fn(async (key: string) => {
    storage.delete(key);
  }),
}));
vi.mock('../api/authAPI', () => ({ authAPI: authMock }));
vi.mock('../i18n/LanguageProvider', () => ({
  useLanguage: () => ({ t: (key: string) => key }),
}));
vi.mock('../navigation', () => ({ navigationRef: navigationMock }));

let snapshot: SessionContextValue | null = null;

let rendered: ReactTestRenderer | null = null;

function Probe() {
  snapshot = useSession();
  return null;
}

afterEach(async () => {
  if (rendered) {
    await act(async () => {
      rendered?.unmount();
    });
  }
  rendered = null;
  storage.clear();
  snapshot = null;
  authMock.bootstrapSession.mockReset();
  authMock.logout.mockReset();
  authMock.requestOtp.mockReset();
  authMock.verifyOtp.mockReset();
  navigationMock.reset.mockReset();
});

describe('Mobile SESSION_INVALID recovery', () => {
  it('clears persisted auth state and resets navigation from the mounted provider', async () => {
    storage.set('imeal.opaque.session-token', 'old-token');
    authMock.bootstrapSession.mockResolvedValue({
      id: 'user-1',
      userId: 'user-1',
      email: 'person@example.test',
      name: 'Person',
      roles: ['staff'],
      permissions: [],
    });

    await act(async () => {
      rendered = create(
        <SessionProvider>
          <Probe />
        </SessionProvider>,
      );
    });

    expect(snapshot?.token).toBe('old-token');
    expect(snapshot?.profile?.userId).toBe('user-1');

    const response = new Response(
      JSON.stringify({
        error: {
          code: 'SESSION_INVALID',
          message: 'Invalid or expired session.',
        },
        requestId: 'request-1',
      }),
      { status: 401 },
    );
    await act(async () => {
      await expect(
        throwMobileResponseError(response, 'errors.loadCalendar', {
          token: 'old-token',
        }),
      ).rejects.toMatchObject({ code: 'SESSION_INVALID' });
      await Promise.resolve();
    });

    expect(snapshot?.token).toBeNull();
    expect(snapshot?.profile).toBeNull();
    expect(storage.has('imeal.opaque.session-token')).toBe(false);
    expect(navigationMock.reset).toHaveBeenCalledWith({
      index: 0,
      routes: [{ name: 'Auth' }],
    });
    expect(authMock.logout).not.toHaveBeenCalled();
  });

  it('does not clear a newly authenticated token after a delayed old-session response', async () => {
    storage.set('imeal.opaque.session-token', 'old-token');
    authMock.bootstrapSession.mockResolvedValueOnce({
      id: 'user-1',
      userId: 'user-1',
      email: 'person@example.test',
      name: 'Person',
      roles: ['staff'],
      permissions: [],
    });

    await act(async () => {
      rendered = create(
        <SessionProvider>
          <Probe />
        </SessionProvider>,
      );
    });

    await act(async () => {
      authMock.verifyOtp.mockResolvedValue({ sessionToken: 'new-token' });
      authMock.bootstrapSession.mockResolvedValueOnce({
        id: 'user-2',
        userId: 'user-2',
        email: 'new@example.test',
        name: 'New Person',
        roles: ['staff'],
        permissions: [],
      });
      await snapshot?.verifyOtp('new@example.test', '123456');
    });

    const delayedResponse = new Response(
      JSON.stringify({
        error: {
          code: 'SESSION_INVALID',
          message: 'Invalid or expired session.',
        },
      }),
      { status: 401 },
    );
    await act(async () => {
      await expect(
        throwMobileResponseError(delayedResponse, 'errors.loadCalendar', {
          token: 'old-token',
        }),
      ).rejects.toMatchObject({ code: 'SESSION_INVALID' });
    });

    expect(snapshot?.token).toBe('new-token');
    expect(snapshot?.profile?.userId).toBe('user-2');
    expect(storage.get('imeal.opaque.session-token')).toBe('new-token');
  });

  it('preserves the current authenticated state when OTP verification is invalid', async () => {
    storage.set('imeal.opaque.session-token', 'current-token');
    authMock.bootstrapSession.mockResolvedValue({
      id: 'user-1',
      userId: 'user-1',
      email: 'person@example.test',
      name: 'Person',
      roles: ['staff'],
      permissions: [],
    });

    await act(async () => {
      rendered = create(
        <SessionProvider>
          <Probe />
        </SessionProvider>,
      );
    });

    authMock.verifyOtp.mockRejectedValue(
      new MobileApiError(
        'OTP_INVALID_OR_EXPIRED',
        'errors.otpInvalidOrExpired',
      ),
    );

    await expect(
      act(async () => {
        await snapshot?.verifyOtp('person@example.test', '000000');
      }),
    ).rejects.toMatchObject({ code: 'OTP_INVALID_OR_EXPIRED' });

    expect(snapshot?.token).toBe('current-token');
    expect(snapshot?.profile?.userId).toBe('user-1');
    expect(storage.get('imeal.opaque.session-token')).toBe('current-token');
    expect(authMock.logout).not.toHaveBeenCalled();
  });

  it('does not restore a remotely invalidated session when a pending OTP later fails', async () => {
    storage.set('imeal.opaque.session-token', 'current-token');
    authMock.bootstrapSession.mockResolvedValue({
      id: 'user-1',
      userId: 'user-1',
      email: 'person@example.test',
      name: 'Person',
      roles: ['staff'],
      permissions: [],
    });

    await act(async () => {
      rendered = create(
        <SessionProvider>
          <Probe />
        </SessionProvider>,
      );
    });

    let rejectOtp: (error: unknown) => void = () => undefined;
    authMock.verifyOtp.mockImplementation(
      () =>
        new Promise((_, reject) => {
          rejectOtp = reject;
        }),
    );
    let pendingOtp!: Promise<void>;
    await act(async () => {
      pendingOtp = snapshot!.verifyOtp('person@example.test', '000000');
      await Promise.resolve();
    });

    const invalidationResponse = new Response(
      JSON.stringify({
        error: {
          code: 'SESSION_INVALID',
          message: 'Invalid or expired session.',
        },
      }),
      { status: 401 },
    );
    await act(async () => {
      await expect(
        throwMobileResponseError(invalidationResponse, 'errors.loadCalendar', {
          token: 'current-token',
        }),
      ).rejects.toMatchObject({ code: 'SESSION_INVALID' });
    });

    expect(snapshot?.token).toBeNull();
    expect(snapshot?.profile).toBeNull();
    expect(storage.get('imeal.opaque.session-token')).toBeUndefined();

    const otpError = new MobileApiError(
      'OTP_INVALID_OR_EXPIRED',
      'errors.otpInvalidOrExpired',
    );
    rejectOtp(otpError);
    await expect(
      act(async () => {
        await pendingOtp;
      }),
    ).rejects.toMatchObject({ code: 'OTP_INVALID_OR_EXPIRED' });

    expect(snapshot?.token).toBeNull();
    expect(snapshot?.profile).toBeNull();
    expect(storage.get('imeal.opaque.session-token')).toBeUndefined();
  });
});
