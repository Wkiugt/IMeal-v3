// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';

type RequestRecord = { url: string; method: string; body?: string };
type FetchHandler = (
  input: RequestInfo | URL,
  init?: RequestInit,
) => Promise<Response>;

const TOKEN = 'admin-session-token';
const NOW = '2026-10-02T03:00:00.000Z';
const defaultConfirm = window.confirm;

function response(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function profile(permissions: string[] = ['user.manage']) {
  return {
    id: 'admin-1',
    userId: 'admin-1',
    name: 'Admin User',
    email: 'admin@example.test',
    roles: ['admin'],
    permissions,
  };
}

function listResponse(page = 1) {
  return {
    items: [
      {
        id: 'user-1',
        name: 'Person One',
        email: 'person@example.test',
        isActive: true,
        managedRoles: ['staff'],
        employeeCode: 'EMP-1',
        effectiveServiceLocation: {
          id: 'location-1',
          shortCode: 'LOC-A',
          displayName: 'Location A',
        },
        activeSessionCount: 1,
      },
    ],
    pagination: {
      page,
      limit: 20,
      total: 21,
      totalPages: 2,
      hasNextPage: page < 2,
    },
  };
}

function detailResponse() {
  return {
    id: 'user-1',
    name: 'Person One',
    email: 'person@example.test',
    isActive: true,
    managedRoles: ['staff'],
    allRoles: ['staff', 'admin'],
    employeeCode: 'EMP-1',
    effectiveServiceLocation: {
      id: 'location-1',
      shortCode: 'LOC-A',
      displayName: 'Location A',
    },
    rosterAssignment: null,
    allowlist: {
      state: 'ACTIVE',
      effectiveFrom: NOW,
      effectiveTo: null,
    },
    sessions: { activeCount: 1, totalCount: 2 },
    lifecycle: {
      createdAt: NOW,
      updatedAt: NOW,
      lastRoleChangeAt: null,
      lastDisableAt: null,
      lastEnableAt: null,
      lastSessionRevokeAt: null,
    },
    auditSummary: {
      recent: [
        {
          id: 'audit-1',
          action: 'USER_ROLES_UPDATED',
          actorUserId: 'admin-1',
          targetUserId: 'user-1',
          createdAt: NOW,
          details: { result: 'ACCEPTED' },
        },
      ],
      actionCounts: { USER_ROLES_UPDATED: 1 },
    },
  };
}

function sessionResponse(page: number) {
  const first = page === 1;
  return {
    items: [
      {
        id: first ? 'session-1' : 'session-2',
        createdAt: first ? NOW : '2026-09-01T03:00:00.000Z',
        lastUsedAt: NOW,
        idleExpiresAt: null,
        absoluteExpiresAt: '2026-11-01T03:00:00.000Z',
        revokedAt: first ? null : NOW,
        revokedReason: first ? null : 'ADMIN_REVOKED',
        isActive: first,
      },
    ],
    pagination: {
      page,
      limit: 20,
      total: 21,
      totalPages: 2,
      hasNextPage: first,
    },
  };
}

function auditResponse(page: number) {
  const first = page === 1;
  return {
    items: [
      {
        id: first ? 'audit-1' : 'audit-2',
        action: first ? 'USER_ROLES_UPDATED' : 'USER_SESSIONS_REVOKED',
        actorUserId: 'admin-1',
        targetUserId: 'user-1',
        details: first
          ? { result: 'ACCEPTED' }
          : {
              previousManagedRoles: ['staff'],
              nextManagedRoles: ['staff', 'kitchen'],
            },
        createdAt: NOW,
      },
    ],
    pagination: {
      page,
      limit: 25,
      total: 26,
      totalPages: 2,
      hasNextPage: first,
    },
  };
}

function previewResponse() {
  return {
    userId: 'user-1',
    name: 'Person One',
    email: 'person@example.test',
    isActive: true,
    managedRoles: ['staff'],
    allRoles: ['staff', 'admin'],
    activeSessionCount: 1,
    actionableFromDate: '2026-10-02',
    generatedAt: NOW,
    registrations: { count: 2, items: [] },
    outgoingDelegations: { count: 1, items: [] },
    incomingDelegations: { count: 3, items: [] },
  };
}

function disableResponse() {
  return {
    userId: 'user-1',
    isActive: false,
    changed: true,
    affected: {
      registrationsCancelled: 2,
      delegationsRevoked: 4,
      sessionsRevoked: 1,
    },
    auditCreated: true,
    completedAt: NOW,
  };
}

function makeFetch(
  records: RequestRecord[],
  options: {
    invalidAuth?: boolean;
    invalidDetail?: boolean;
    otpInvalid?: boolean;
    permissions?: string[];
  } = {},
): FetchHandler {
  return async (input, init) => {
    const url = String(input);
    const method = init?.method ?? 'GET';
    records.push({
      url,
      method,
      body: typeof init?.body === 'string' ? init.body : undefined,
    });
    if (url.endsWith('/auth/me')) {
      if (options.invalidAuth) {
        return response(
          {
            error: {
              code: 'SESSION_INVALID',
              message: 'Invalid or expired session.',
            },
          },
          401,
        );
      }
      return response(profile(options.permissions));
    }
    if (url.endsWith('/auth/otp/request')) return response({ accepted: true });
    if (url.endsWith('/auth/otp/verify') && options.otpInvalid) {
      return response(
        { error: { code: 'OTP_INVALID_OR_EXPIRED', message: 'Invalid code.' } },
        401,
      );
    }
    if (url.endsWith('/auth/logout')) return response({ revoked: true });
    if (options.invalidDetail && url.endsWith('/v1/admin/users/user-1')) {
      return response(
        {
          error: {
            code: 'SESSION_INVALID',
            message: 'Invalid or expired session.',
          },
        },
        401,
      );
    }
    if (url.includes('/v1/admin/users?')) {
      const page = Number(new URL(url).searchParams.get('page') ?? '1');
      return response(listResponse(page));
    }
    if (url.endsWith('/disable/preview')) return response(previewResponse());
    if (url.endsWith('/disable')) return response(disableResponse());
    if (url.endsWith('/enable'))
      return response({
        userId: 'user-1',
        isActive: true,
        changed: true,
        auditCreated: true,
        completedAt: NOW,
      });
    if (url.endsWith('/roles'))
      return response({
        userId: 'user-1',
        managedRoles: ['staff'],
        allRoles: ['staff', 'admin'],
        changed: true,
        updatedAt: NOW,
      });
    if (url.includes('/sessions?')) {
      const page = Number(new URL(url).searchParams.get('page') ?? '1');
      return response(sessionResponse(page));
    }
    if (url.includes('/audit?')) {
      const page = Number(new URL(url).searchParams.get('page') ?? '1');
      return response(auditResponse(page));
    }
    if (url.includes('/v1/admin/users/')) return response(detailResponse());
    return response({});
  };
}

async function loadMain(
  fetchHandler: FetchHandler,
  token: string | null = TOKEN,
): Promise<void> {
  document.body.innerHTML = '<main id="app" aria-live="polite"></main>';
  sessionStorage.clear();
  if (token) sessionStorage.setItem('imeal.session-token', token);
  vi.stubGlobal('fetch', vi.fn(fetchHandler));
  vi.resetModules();
  // Each test reloads the entrypoint to exercise its real bootstrap DOM flow.
  await import('./main');
  await vi.waitFor(() => {
    expect(document.querySelector('.content, .login')).not.toBeNull();
  });
}

async function clickButton(label: string): Promise<HTMLButtonElement> {
  let button: HTMLButtonElement | undefined;
  await vi.waitFor(() => {
    button = Array.from(document.querySelectorAll('button')).find(
      (candidate) => candidate.textContent === label,
    );
    expect(button).not.toBeUndefined();
  });
  if (!button) throw new Error(`Missing button ${label}`);
  button.click();
  return button;
}

afterEach(() => {
  vi.unstubAllGlobals();
  window.confirm = defaultConfirm;
  sessionStorage.clear();
  document.body.innerHTML = '';
});

describe('Admin Web auth recovery', () => {
  it('renders login for a protected SESSION_INVALID response without logout recursion', async () => {
    const records: RequestRecord[] = [];
    await loadMain(makeFetch(records, { invalidAuth: true }));

    await vi.waitFor(() => {
      expect(document.querySelector('.login')).not.toBeNull();
      expect(document.querySelector('.error')?.textContent).toContain(
        'Invalid or expired session.',
      );
    });
    expect(sessionStorage.getItem('imeal.session-token')).toBeNull();
    expect(
      records.some((request) => request.url.endsWith('/auth/logout')),
    ).toBe(false);
  });

  it('keeps unrelated session storage on OTP_INVALID_OR_EXPIRED', async () => {
    const records: RequestRecord[] = [];
    await loadMain(makeFetch(records, { otpInvalid: true }), null);

    const email = document.querySelector<HTMLInputElement>(
      'input[type="email"]',
    );
    const form = document.querySelector('form');
    if (!email || !form) throw new Error('Missing OTP request form');
    email.value = 'person@example.test';
    form.dispatchEvent(
      new Event('submit', { bubbles: true, cancelable: true }),
    );
    await vi.waitFor(() => {
      expect(
        Array.from(document.querySelectorAll('button')).some(
          (button) => button.textContent === 'Xác nhận OTP',
        ),
      ).toBe(true);
    });

    sessionStorage.setItem('imeal.session-token', 'unrelated-session');
    const otpForm = document.querySelector('form');
    const code = document.querySelector<HTMLInputElement>(
      'input[inputmode="numeric"]',
    );
    if (!otpForm || !code) throw new Error('Missing OTP verification form');
    code.value = '000000';
    otpForm.dispatchEvent(
      new Event('submit', { bubbles: true, cancelable: true }),
    );
    await vi.waitFor(() => {
      expect(
        records.some((request) => request.url.endsWith('/auth/otp/verify')),
      ).toBe(true);
    });
    await vi.waitFor(() => {
      expect(document.querySelector('.form-feedback')?.textContent).toContain(
        'Invalid code.',
      );
    });

    expect(sessionStorage.getItem('imeal.session-token')).toBe(
      'unrelated-session',
    );
    expect(
      records.some((request) => request.url.endsWith('/auth/logout')),
    ).toBe(false);
  });

  it('returns an already authenticated Admin to login on a protected detail SESSION_INVALID', async () => {
    const records: RequestRecord[] = [];
    await loadMain(makeFetch(records, { invalidDetail: true }));

    expect(sessionStorage.getItem('imeal.session-token')).toBe(TOKEN);
    await clickButton('Chi tiết');
    await vi.waitFor(() => {
      expect(document.querySelector('.login')).not.toBeNull();
    });

    expect(sessionStorage.getItem('imeal.session-token')).toBeNull();
    expect(
      records.some((request) => request.url.endsWith('/auth/logout')),
    ).toBe(false);
    expect(document.body.textContent).not.toContain('Vai trò Staff/Kitchen');
  });
});

describe('Admin Web users surface', () => {
  it('gates navigation and exposes only Staff/Kitchen controls with real session and audit pagination', async () => {
    const records: RequestRecord[] = [];
    await loadMain(makeFetch(records));

    expect(document.querySelector('nav')?.textContent).toContain(
      'Người dùng & vai trò',
    );
    await clickButton('Chi tiết');
    await vi.waitFor(() => {
      expect(document.body.textContent).toContain('Vai trò Staff/Kitchen');
      expect(document.body.textContent).toContain('Phiên session-1');
      expect(document.body.textContent).toContain('USER_ROLES_UPDATED');
    });
    expect(
      Array.from(document.querySelectorAll('input[type="checkbox"]')).map(
        (input) => (input as HTMLInputElement).value,
      ),
    ).toEqual(['staff', 'kitchen']);

    const sessionSection = Array.from(
      document.querySelectorAll('section.operation-section'),
    ).find((section) => section.textContent?.includes('Phiên đăng nhập'));
    const sessionNext =
      sessionSection &&
      Array.from(sessionSection.querySelectorAll('button')).find(
        (button) => button.textContent === 'Trang sau',
      );
    if (!sessionNext) throw new Error('Missing session pagination');
    sessionNext.click();
    await vi.waitFor(() =>
      expect(document.body.textContent).toContain('Phiên session-2'),
    );

    const auditSection = Array.from(
      document.querySelectorAll('section.operation-section'),
    ).find((section) =>
      section.textContent?.includes('Nhật ký vòng đời đã lưu trên server'),
    );
    const auditNext =
      auditSection &&
      Array.from(auditSection.querySelectorAll('button')).find(
        (button) => button.textContent === 'Trang sau',
      );
    if (!auditNext) throw new Error('Missing audit pagination');
    auditNext.click();
    await vi.waitFor(() => {
      expect(
        records.some((request) => request.url.includes('/audit?page=2')),
      ).toBe(true);
    });
    await vi.waitFor(() => {
      expect(document.body.textContent).toContain('USER_SESSIONS_REVOKED');
      expect(document.body.textContent).toContain(
        'previousManagedRoles: staff',
      );
      expect(document.body.textContent).toContain(
        'nextManagedRoles: staff, kitchen',
      );
    });
    expect(
      records.some((request) => request.url.includes('/sessions?page=2')),
    ).toBe(true);
    expect(
      records.some((request) => request.url.includes('/audit?page=2')),
    ).toBe(true);
  });

  it('does not expose Users navigation without user.manage', async () => {
    await loadMain(makeFetch([], { permissions: [] }));

    expect(document.querySelector('nav')?.textContent ?? '').not.toContain(
      'Người dùng & vai trò',
    );
    expect(
      Array.from(document.querySelectorAll('button')).some(
        (button) => button.textContent === 'Người dùng & vai trò',
      ),
    ).toBe(false);
  });

  it('does not reattach a protected detail after logout while its request is pending', async () => {
    const records: RequestRecord[] = [];
    const baseFetch = makeFetch(records);
    let releaseDetail: (() => void) | undefined;
    const fetchHandler: FetchHandler = async (input, init) => {
      if (String(input).endsWith('/v1/admin/users/user-1')) {
        return new Promise<Response>((resolve) => {
          releaseDetail = () => resolve(response(detailResponse()));
        });
      }
      return baseFetch(input, init);
    };

    await loadMain(fetchHandler);
    await clickButton('Chi tiết');
    await vi.waitFor(() => {
      expect(releaseDetail).toBeTypeOf('function');
    });

    await clickButton('Đăng xuất');
    await vi.waitFor(() => {
      expect(document.querySelector('.login')).not.toBeNull();
    });
    releaseDetail?.();
    await vi.waitFor(() => {
      expect(document.body.textContent).not.toContain('Vai trò Staff/Kitchen');
      expect(document.body.textContent).not.toContain('Person One');
    });
  });

  it('requires preview and explicit confirmation before disabling an account', async () => {
    const records: RequestRecord[] = [];
    await loadMain(makeFetch(records));
    await clickButton('Chi tiết');
    await vi.waitFor(() =>
      expect(document.body.textContent).toContain('Vô hiệu hóa tài khoản'),
    );
    await clickButton('Vô hiệu hóa tài khoản');
    await vi.waitFor(() =>
      expect(document.body.textContent).toContain(
        'Xác nhận vô hiệu hóa tài khoản',
      ),
    );

    const originalConfirm = window.confirm;
    window.confirm = vi.fn(() => false);
    await clickButton('Xác nhận và vô hiệu hóa');
    expect(
      records.some(
        (request) =>
          request.url.endsWith('/disable') && request.method === 'POST',
      ),
    ).toBe(false);

    window.confirm = vi.fn(() => true);
    await clickButton('Xác nhận và vô hiệu hóa');
    await vi.waitFor(() =>
      expect(
        records.some(
          (request) =>
            request.url.endsWith('/disable') && request.method === 'POST',
        ),
      ).toBe(true),
    );
    const disableRequest = records.find(
      (request) =>
        request.url.endsWith('/disable') && request.method === 'POST',
    );
    expect(disableRequest?.body).toBe(JSON.stringify({ confirm: true }));
    window.confirm = originalConfirm;
  });
});
