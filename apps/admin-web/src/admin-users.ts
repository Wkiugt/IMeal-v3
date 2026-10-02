import { v1 } from '@imeal/contracts';

type AdminApi = (path: string, init?: RequestInit) => Promise<unknown>;
type ProfileIdentity = { id?: string; userId?: string } | null;

export interface AdminUsersViewDeps {
  api: AdminApi;
  profile: ProfileIdentity;
  onRefresh: () => Promise<void>;
}

const LIST_LIMIT = 20;
const DETAIL_LIMIT = 20;
const AUDIT_LIMIT = 25;
const renderVersions = new WeakMap<HTMLElement, number>();

function beginRender(root: HTMLElement): () => boolean {
  const version = (renderVersions.get(root) ?? 0) + 1;
  renderVersions.set(root, version);
  return () => root.isConnected && renderVersions.get(root) === version;
}

type ElementTag = keyof HTMLElementTagNameMap;

function createElement<K extends ElementTag>(
  tag: K,
  className?: string,
  text?: string,
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function button(
  text: string,
  action: () => void,
  variant: 'primary' | 'secondary' | 'danger' = 'primary',
): HTMLButtonElement {
  const node = createElement(
    'button',
    `button ${variant === 'primary' ? '' : variant}`,
    text,
  );
  node.type = 'button';
  node.addEventListener('click', action);
  return node;
}

function dateTime(value: string | null | undefined): string {
  if (!value) return '—';
  const parsed = new Date(value);
  if (!Number.isFinite(parsed.getTime())) return '—';
  return new Intl.DateTimeFormat('vi-VN', {
    dateStyle: 'medium',
    timeStyle: 'short',
    timeZone: 'Asia/Ho_Chi_Minh',
  }).format(parsed);
}

function date(value: string | null | undefined): string {
  if (!value) return '—';
  const parsed = new Date(value);
  if (!Number.isFinite(parsed.getTime())) return '—';
  return new Intl.DateTimeFormat('vi-VN', {
    dateStyle: 'medium',
    timeZone: 'Asia/Ho_Chi_Minh',
  }).format(parsed);
}

function errorMessage(error: unknown, fallback: string): string {
  return error instanceof Error && error.message ? error.message : fallback;
}

function displayRole(role: string): string {
  if (role === 'staff') return 'Staff';
  if (role === 'kitchen') return 'Kitchen';
  if (role === 'admin') return 'Admin';
  return role;
}

function auditValue(value: unknown): string {
  if (Array.isArray(value)) return value.join(', ') || '—';
  if (value === null) return '—';
  return String(value);
}

function statusBadge(active: boolean): HTMLSpanElement {
  return createElement(
    'span',
    `status ${active ? 'paid' : 'waived'}`,
    active ? 'Đang hoạt động' : 'Đã vô hiệu hóa',
  );
}

function roleBadges(roles: readonly string[]): HTMLDivElement {
  const wrapper = createElement('div', 'stack');
  if (roles.length === 0) {
    wrapper.append(createElement('span', 'muted', 'Chưa có vai trò'));
    return wrapper;
  }
  for (const role of roles) {
    wrapper.append(createElement('span', 'status paid', displayRole(role)));
  }
  return wrapper;
}

function locationText(
  location: v1.AdminSafeLocationSummary | null | undefined,
): string {
  if (!location) return 'Chưa có địa điểm hiệu lực';
  return `${location.shortCode} · ${location.displayName}`;
}

function paginationControls(
  pagination: v1.PagePaginationMeta,
  onPage: (page: number) => void,
): HTMLDivElement {
  const controls = createElement('div', 'row-actions');
  const previous = button(
    'Trang trước',
    () => onPage(pagination.page - 1),
    'secondary',
  );
  const next = button(
    'Trang sau',
    () => onPage(pagination.page + 1),
    'secondary',
  );
  previous.disabled = pagination.page <= 1;
  next.disabled = !pagination.hasNextPage;
  controls.append(
    createElement(
      'span',
      'muted',
      `Trang ${pagination.page} / ${Math.max(1, pagination.totalPages)} · ${pagination.total} người dùng`,
    ),
    previous,
    next,
  );
  return controls;
}

function userCard(
  item: v1.AdminUserListItem,
  deps: AdminUsersViewDeps,
  root: HTMLElement,
): HTMLElement {
  const card = createElement('article', 'card row');
  const main = createElement('div', 'row-main');
  main.append(
    createElement('strong', '', item.name || item.email),
    createElement('div', 'muted', item.email),
    createElement(
      'div',
      'muted',
      `${item.employeeCode || 'Chưa có mã nhân viên'} · ${locationText(item.effectiveServiceLocation)}`,
    ),
    roleBadges(item.managedRoles),
  );
  const actions = createElement('div', 'row-actions');
  actions.append(statusBadge(item.isActive));
  actions.append(
    createElement(
      'span',
      'muted',
      `${item.activeSessionCount} phiên đang hoạt động`,
    ),
    button(
      'Chi tiết',
      () => {
        void renderUserDetail(root, item.id, deps);
      },
      'secondary',
    ),
  );
  card.append(main, actions);
  return card;
}

async function renderUserList(
  root: HTMLElement,
  deps: AdminUsersViewDeps,
  page: number,
  searchValue: string,
  statusValue: v1.AdminUserStatusFilter,
  roleValue: v1.AdminUserRoleFilter,
  current: () => boolean,
): Promise<void> {
  const query = v1.AdminUserListQuerySchema.safeParse({
    page,
    limit: LIST_LIMIT,
    search: searchValue.trim() || undefined,
    status: statusValue,
    role: roleValue,
  });
  if (!query.success) {
    if (current()) {
      root.append(
        createElement('div', 'error', 'Bộ lọc người dùng không hợp lệ.'),
      );
    }
    return;
  }
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query.data)) {
    if (value !== undefined) params.set(key, String(value));
  }
  try {
    const result = v1.AdminUserListResponseSchema.parse(
      await deps.api(`/v1/admin/users?${params.toString()}`),
    );
    if (!current()) return;
    if (result.items.length === 0) {
      root.append(
        createElement('div', 'card empty', 'Không có người dùng phù hợp.'),
      );
    } else {
      const list = createElement('div', 'stack');
      for (const item of result.items) list.append(userCard(item, deps, root));
      root.append(list);
    }
    root.append(
      paginationControls(result.pagination, (nextPage) => {
        if (!current()) return;
        void renderUsers(root, deps, {
          page: nextPage,
          searchValue,
          statusValue,
          roleValue,
        });
      }),
    );
  } catch (error: unknown) {
    if (!current()) return;
    root.append(
      createElement(
        'div',
        'error',
        errorMessage(error, 'Không thể tải danh sách người dùng.'),
      ),
    );
  }
}

function appendAuditEntries(
  section: HTMLElement,
  entries: readonly v1.AdminUserAuditEntry[],
): void {
  if (entries.length === 0) {
    section.append(
      createElement('div', 'card empty', 'Chưa có nhật ký vòng đời tài khoản.'),
    );
    return;
  }
  const list = createElement('div', 'stack');
  for (const entry of entries) {
    const card = createElement('article', 'card audit-card');
    const heading = createElement('div', 'section-heading');
    heading.append(
      createElement('h3', '', entry.action),
      createElement('span', 'muted', dateTime(entry.createdAt)),
    );
    const details = createElement('div', 'audit-details');
    details.append(
      createElement('span', 'muted', `Actor: ${entry.actorUserId || 'system'}`),
      createElement('span', 'muted', `Target: ${entry.targetUserId}`),
    );
    for (const [key, value] of Object.entries(entry.details)) {
      details.append(
        createElement('span', 'muted', `${key}: ${auditValue(value)}`),
      );
    }
    card.append(heading, details);
    list.append(card);
  }
  section.append(list);
}

async function renderSessions(
  section: HTMLElement,
  userId: string,
  deps: AdminUsersViewDeps,
  current: () => boolean,
  page = 1,
): Promise<void> {
  if (!current()) return;
  const heading = section.firstElementChild;
  if (heading) section.replaceChildren(heading);
  try {
    const params = new URLSearchParams({
      page: String(page),
      limit: String(DETAIL_LIMIT),
      includeRevoked: 'true',
    });
    const result = v1.AdminUserSessionsResponseSchema.parse(
      await deps.api(
        `/v1/admin/users/${encodeURIComponent(userId)}/sessions?${params.toString()}`,
      ),
    );
    if (!current()) return;
    if (result.items.length === 0) {
      section.append(
        createElement('div', 'card empty', 'Chưa có phiên đăng nhập nào.'),
      );
      return;
    }
    const list = createElement('div', 'stack');
    for (const session of result.items) {
      const card = createElement('article', 'card row');
      const details = createElement('div', 'row-main');
      details.append(
        createElement(
          'strong',
          '',
          `Phiên ${session.id} · ${session.isActive ? 'đang hoạt động' : 'đã kết thúc'}`,
        ),
        createElement(
          'div',
          'muted',
          `Tạo: ${dateTime(session.createdAt)} · Dùng gần nhất: ${dateTime(session.lastUsedAt)}`,
        ),
        createElement(
          'div',
          'muted',
          `Hết hạn tuyệt đối: ${dateTime(session.absoluteExpiresAt)}`,
        ),
      );
      const status = session.revokedAt
        ? `${session.revokedReason || 'Đã thu hồi'} · ${dateTime(session.revokedAt)}`
        : session.isActive
          ? 'Chưa thu hồi'
          : 'Đã hết hạn';
      card.append(details, createElement('span', 'muted', status));
      list.append(card);
    }
    section.append(
      list,
      paginationControls(result.pagination, (nextPage) => {
        if (!current()) return;
        void renderSessions(section, userId, deps, current, nextPage);
      }),
    );
  } catch (error: unknown) {
    if (!current()) return;
    section.append(
      createElement(
        'div',
        'error',
        errorMessage(error, 'Không thể tải danh sách phiên.'),
      ),
    );
  }
}

async function renderAudit(
  section: HTMLElement,
  userId: string,
  deps: AdminUsersViewDeps,
  fallback: readonly v1.AdminUserAuditEntry[],
  current: () => boolean,
  page = 1,
): Promise<void> {
  if (!current()) return;
  const heading = section.firstElementChild;
  if (heading) section.replaceChildren(heading);
  try {
    const params = new URLSearchParams({
      page: String(page),
      limit: String(AUDIT_LIMIT),
    });
    const result = v1.AdminUserAuditResponseSchema.parse(
      await deps.api(
        `/v1/admin/users/${encodeURIComponent(userId)}/audit?${params.toString()}`,
      ),
    );
    if (!current()) return;
    appendAuditEntries(section, result.items);
    section.append(
      paginationControls(result.pagination, (nextPage) => {
        if (!current()) return;
        void renderAudit(section, userId, deps, fallback, current, nextPage);
      }),
    );
  } catch (error: unknown) {
    if (!current()) return;
    appendAuditEntries(section, fallback);
    section.append(
      createElement(
        'div',
        'notice',
        errorMessage(
          error,
          'Không thể tải thêm nhật ký; đang hiển thị bản tóm tắt đã lưu.',
        ),
      ),
    );
  }
}

function detailHeader(
  user: v1.AdminUserDetail,
  deps: AdminUsersViewDeps,
  root: HTMLElement,
): HTMLElement {
  const section = createElement('section', 'operation-section');
  const heading = createElement('div', 'section-heading');
  heading.append(
    createElement('h2', '', user.name || user.email),
    statusBadge(user.isActive),
  );
  const identity = createElement('div', 'card operation-card');
  identity.append(
    createElement('p', '', `Email: ${user.email}`),
    createElement('p', '', `Mã nhân viên: ${user.employeeCode || 'Chưa có'}`),
    createElement(
      'p',
      '',
      `Địa điểm hiệu lực: ${locationText(user.effectiveServiceLocation)}`,
    ),
    createElement(
      'p',
      '',
      `Vai trò server: ${user.allRoles.map(displayRole).join(', ') || 'Chưa có'}`,
    ),
    createElement(
      'p',
      '',
      `Allowlist A: ${user.allowlist ? (user.allowlist.state === 'ACTIVE' ? 'Đang cho phép' : 'Đã tắt') : 'Chưa liên kết'}`,
    ),
  );
  if (user.rosterAssignment) {
    identity.append(
      createElement(
        'p',
        '',
        `Roster: ${user.rosterAssignment.rosterRole} · ${user.rosterAssignment.isActive ? 'đang hoạt động' : 'đã tắt'}`,
      ),
      createElement(
        'p',
        '',
        `Hiệu lực: ${date(user.rosterAssignment.effectiveFrom)} – ${date(user.rosterAssignment.effectiveTo)}`,
      ),
      createElement(
        'p',
        '',
        `Địa điểm roster: ${locationText(user.rosterAssignment.serviceLocation)}`,
      ),
    );
  }
  section.append(heading, identity);
  const back = button(
    'Quay lại danh sách',
    () => void deps.onRefresh(),
    'secondary',
  );
  section.prepend(back);
  return section;
}

async function renderRoleControls(
  root: HTMLElement,
  user: v1.AdminUserDetail,
  deps: AdminUsersViewDeps,
  current: () => boolean,
): Promise<void> {
  if (!current()) return;
  const section = createElement('section', 'operation-section');
  section.append(
    createElement('div', 'section-heading', 'Vai trò Staff/Kitchen'),
    createElement(
      'p',
      'muted',
      'Hai vai trò được quản lý độc lập. Admin không thể được cấp hoặc thu hồi tại đây.',
    ),
  );
  const form = createElement('form', 'card operation-form');
  const fields = createElement('div', 'stack');
  const selected = new Set(user.managedRoles);
  for (const role of ['staff', 'kitchen'] as const) {
    const label = createElement('label', 'check-field');
    const input = createElement('input');
    input.type = 'checkbox';
    input.value = role;
    input.checked = selected.has(role);
    label.append(input, createElement('span', '', displayRole(role)));
    fields.append(label);
  }
  const save = button('Lưu vai trò', () => undefined);
  save.type = 'submit';
  const feedback = createElement('div', 'form-feedback');
  form.append(fields, save, feedback);
  form.addEventListener('submit', (event) => {
    event.preventDefault();
    save.disabled = true;
    const roles = Array.from(
      fields.querySelectorAll<HTMLInputElement>('input:checked'),
    ).map((input) => input.value);
    const parsedRequest = v1.AdminUserRolesUpdateRequestSchema.safeParse({
      roles,
    });
    if (!parsedRequest.success) {
      feedback.textContent = 'Vai trò không hợp lệ.';
      save.disabled = false;
      return;
    }
    void (async () => {
      try {
        const response = v1.AdminUserRolesUpdateResponseSchema.parse(
          await deps.api(
            `/v1/admin/users/${encodeURIComponent(user.id)}/roles`,
            {
              method: 'PUT',
              body: JSON.stringify(parsedRequest.data),
            },
          ),
        );
        if (!current()) return;
        feedback.textContent = response.changed
          ? 'Đã cập nhật vai trò server.'
          : 'Vai trò không thay đổi.';
        await renderUserDetail(root, user.id, deps);
      } catch (error: unknown) {
        if (current()) {
          feedback.textContent = errorMessage(
            error,
            'Không thể cập nhật vai trò.',
          );
        }
      } finally {
        if (current()) save.disabled = false;
      }
    })();
  });
  section.append(form);
  if (current()) root.append(section);
}

async function renderDisableControls(
  root: HTMLElement,
  user: v1.AdminUserDetail,
  deps: AdminUsersViewDeps,
  current: () => boolean,
): Promise<void> {
  if (!current()) return;
  const section = createElement('section', 'operation-section');
  section.append(
    createElement('div', 'section-heading', 'Vòng đời tài khoản'),
    createElement(
      'p',
      'muted',
      'Bật tài khoản chỉ khôi phục trạng thái active; không khôi phục các đăng ký, ủy quyền hoặc phiên đã bị xử lý.',
    ),
  );
  const actions = createElement('div', 'card operation-form');
  const isSelf =
    user.id === deps.profile?.id || user.id === deps.profile?.userId;
  if (isSelf) {
    actions.append(
      createElement(
        'div',
        'notice',
        'Không thể vô hiệu hóa tài khoản quản trị đang đăng nhập.',
      ),
    );
  } else if (user.isActive) {
    const disable = button('Vô hiệu hóa tài khoản', () => undefined, 'danger');
    const previewTarget = createElement('div', 'preview-target');
    disable.addEventListener('click', () => {
      disable.disabled = true;
      void (async () => {
        try {
          const preview = v1.AdminUserDisablePreviewResponseSchema.parse(
            await deps.api(
              `/v1/admin/users/${encodeURIComponent(user.id)}/disable/preview`,
              { method: 'POST' },
            ),
          );
          if (!current()) return;
          const previewCard = createElement('div', 'card preview-card');
          previewCard.append(
            createElement('h3', '', 'Xác nhận vô hiệu hóa tài khoản'),
            createElement(
              'p',
              'notice',
              `Từ ${preview.actionableFromDate}: ${preview.registrations.count} đăng ký suất, ${preview.outgoingDelegations.count} ủy quyền gửi, ${preview.incomingDelegations.count} ủy quyền nhận sẽ được xử lý. ${preview.activeSessionCount} phiên đang hoạt động sẽ bị thu hồi.`,
            ),
          );
          const confirm = button(
            'Xác nhận và vô hiệu hóa',
            () => {
              if (!current()) return;
              if (
                !window.confirm(
                  'Vô hiệu hóa tài khoản và hủy các cam kết tương lai với lý do ACCOUNT_DISABLED?',
                )
              )
                return;
              confirm.disabled = true;
              void (async () => {
                try {
                  const result = v1.AdminUserDisableResponseSchema.parse(
                    await deps.api(
                      `/v1/admin/users/${encodeURIComponent(user.id)}/disable`,
                      {
                        method: 'POST',
                        body: JSON.stringify({ confirm: true }),
                      },
                    ),
                  );
                  if (!current()) return;
                  previewCard.append(
                    createElement(
                      'div',
                      'notice',
                      `Đã vô hiệu hóa. Đăng ký hủy: ${result.affected.registrationsCancelled}; ủy quyền thu hồi: ${result.affected.delegationsRevoked}; phiên thu hồi: ${result.affected.sessionsRevoked}.`,
                    ),
                  );
                  await renderUserDetail(root, user.id, deps);
                } catch (error: unknown) {
                  if (current()) {
                    previewCard.append(
                      createElement(
                        'div',
                        'error',
                        errorMessage(error, 'Không thể vô hiệu hóa tài khoản.'),
                      ),
                    );
                  }
                } finally {
                  if (current()) confirm.disabled = false;
                }
              })();
            },
            'danger',
          );
          previewCard.append(confirm);
          previewTarget.replaceChildren(previewCard);
        } catch (error: unknown) {
          if (current()) {
            previewTarget.replaceChildren(
              createElement(
                'div',
                'error',
                errorMessage(error, 'Không thể tạo bản xem trước vô hiệu hóa.'),
              ),
            );
          }
        } finally {
          if (current()) disable.disabled = false;
        }
      })();
    });
    actions.append(disable, previewTarget);
  } else {
    const enable = button('Bật tài khoản', () => undefined);
    enable.addEventListener('click', () => {
      if (!current()) return;
      void (async () => {
        try {
          v1.AdminUserEnableResponseSchema.parse(
            await deps.api(
              `/v1/admin/users/${encodeURIComponent(user.id)}/enable`,
              {
                method: 'POST',
                body: JSON.stringify({}),
              },
            ),
          );
          await renderUserDetail(root, user.id, deps);
        } catch (error: unknown) {
          if (current()) {
            actions.append(
              createElement(
                'div',
                'error',
                errorMessage(error, 'Không thể bật tài khoản.'),
              ),
            );
          }
        } finally {
          if (current()) enable.disabled = false;
        }
      })();
    });
    actions.append(enable);
  }
  section.append(actions);
  if (current()) root.append(section);
}

async function renderSessionControls(
  root: HTMLElement,
  user: v1.AdminUserDetail,
  deps: AdminUsersViewDeps,
  current: () => boolean,
): Promise<void> {
  if (!current()) return;
  const section = createElement('section', 'operation-section');
  const heading = createElement('div', 'section-heading');
  heading.append(
    createElement('h3', '', 'Phiên đăng nhập'),
    createElement(
      'span',
      'muted',
      `${user.sessions.activeCount} đang hoạt động / ${user.sessions.totalCount} tổng số`,
    ),
  );
  const revoke = button('Đăng xuất tất cả thiết bị', () => undefined, 'danger');
  revoke.addEventListener('click', () => {
    if (!current()) return;
    if (!window.confirm('Thu hồi tất cả phiên đăng nhập của người dùng này?'))
      return;
    revoke.disabled = true;
    void (async () => {
      try {
        const result = v1.AdminUserRevokeAllResponseSchema.parse(
          await deps.api(
            `/v1/admin/users/${encodeURIComponent(user.id)}/sessions/revoke-all`,
            {
              method: 'POST',
              body: JSON.stringify({}),
            },
          ),
        );
        if (!current()) return;
        heading.append(
          createElement(
            'span',
            'notice',
            `Đã thu hồi ${result.revokedCount} phiên (ADMIN_REVOKED).`,
          ),
        );
        await renderUserDetail(root, user.id, deps);
      } catch (error: unknown) {
        if (current()) {
          section.append(
            createElement(
              'div',
              'error',
              errorMessage(error, 'Không thể thu hồi phiên.'),
            ),
          );
        }
      } finally {
        if (current()) revoke.disabled = false;
      }
    })();
  });
  heading.append(revoke);
  section.append(heading);
  if (!current()) return;
  root.append(section);
  await renderSessions(section, user.id, deps, current);
}

async function renderAuditSection(
  root: HTMLElement,
  user: v1.AdminUserDetail,
  deps: AdminUsersViewDeps,
  current: () => boolean,
): Promise<void> {
  if (!current()) return;
  const section = createElement('section', 'operation-section');
  section.append(
    createElement(
      'div',
      'section-heading',
      'Nhật ký vòng đời đã lưu trên server',
    ),
    createElement(
      'p',
      'muted',
      'Dữ liệu dưới đây là AuditLog persisted; không phải bộ nhớ trình duyệt.',
    ),
  );
  if (!current()) return;
  root.append(section);
  await renderAudit(section, user.id, deps, user.auditSummary.recent, current);
}

async function renderUserDetail(
  root: HTMLElement,
  userId: string,
  deps: AdminUsersViewDeps,
): Promise<void> {
  const current = beginRender(root);
  if (!current()) return;
  root.replaceChildren(
    createElement('div', 'card empty', 'Đang tải hồ sơ người dùng…'),
  );
  try {
    const user = v1.AdminUserDetailSchema.parse(
      await deps.api(`/v1/admin/users/${encodeURIComponent(userId)}`),
    );
    if (!current()) return;
    root.replaceChildren(detailHeader(user, deps, root));
    await renderRoleControls(root, user, deps, current);
    await renderDisableControls(root, user, deps, current);
    await renderSessionControls(root, user, deps, current);
    await renderAuditSection(root, user, deps, current);
  } catch (error: unknown) {
    if (!current()) return;
    root.replaceChildren(
      createElement(
        'div',
        'error',
        errorMessage(error, 'Không thể tải hồ sơ người dùng.'),
      ),
    );
  }
}

export async function renderUsers(
  root: HTMLElement,
  deps: AdminUsersViewDeps,
  initial: {
    page?: number;
    searchValue?: string;
    statusValue?: v1.AdminUserStatusFilter;
    roleValue?: v1.AdminUserRoleFilter;
  } = {},
): Promise<void> {
  const page = initial.page ?? 1;
  const searchValue = initial.searchValue ?? '';
  const statusValue = initial.statusValue ?? 'ALL';
  const roleValue = initial.roleValue ?? 'ALL';
  const current = beginRender(root);
  if (!current()) return;
  root.replaceChildren();
  const heading = createElement('div', 'section-heading');
  heading.append(
    createElement('h2', '', 'Người dùng & vai trò Staff/Kitchen'),
    createElement(
      'p',
      'muted',
      'Quản lý danh tính server, trạng thái tài khoản và hai vai trò vận hành độc lập. Admin không thể được cấp tại đây.',
    ),
  );
  const form = createElement('form', 'toolbar');
  const searchField = createElement('div', 'field');
  const search = createElement('input');
  search.id = 'admin-users-search';
  search.value = searchValue;
  search.placeholder = 'Tên, email hoặc mã nhân viên';
  const searchLabel = createElement('label', '', 'Tìm kiếm');
  searchLabel.htmlFor = search.id;
  searchField.append(searchLabel, search);
  const statusField = createElement('div', 'field');
  const status = createElement('select');
  status.id = 'admin-users-status';
  for (const value of ['ALL', 'ACTIVE', 'DISABLED'] as const) {
    const option = createElement(
      'option',
      '',
      value === 'ALL'
        ? 'Mọi trạng thái tài khoản'
        : value === 'ACTIVE'
          ? 'Tài khoản đang hoạt động'
          : 'Tài khoản đã vô hiệu hóa',
    );
    option.value = value;
    option.selected = value === statusValue;
    status.append(option);
  }
  const statusLabel = createElement('label', '', 'Trạng thái tài khoản');
  statusLabel.htmlFor = status.id;
  statusField.append(statusLabel, status);
  const roleField = createElement('div', 'field');
  const role = createElement('select');
  role.id = 'admin-users-role';
  const roleLabels: Record<v1.AdminUserRoleFilter, string> = {
    ALL: 'Mọi vai trò',
    staff: 'Có Staff',
    kitchen: 'Có Kitchen',
    admin: 'Có Admin',
    unmanaged: 'Chưa có Staff/Kitchen',
  };
  for (const value of [
    'ALL',
    'staff',
    'kitchen',
    'admin',
    'unmanaged',
  ] as const) {
    const option = createElement('option', '', roleLabels[value]);
    option.value = value;
    option.selected = value === roleValue;
    role.append(option);
  }
  const roleLabel = createElement('label', '', 'Vai trò server');
  roleLabel.htmlFor = role.id;
  roleField.append(roleLabel, role);
  const submit = button('Áp dụng bộ lọc', () => undefined);
  submit.type = 'submit';
  form.append(searchField, statusField, roleField, submit);
  form.addEventListener('submit', (event) => {
    event.preventDefault();
    void renderUsers(root, deps, {
      page: 1,
      searchValue: search.value,
      statusValue: status.value as v1.AdminUserStatusFilter,
      roleValue: role.value as v1.AdminUserRoleFilter,
    });
  });
  root.append(heading, form);
  await renderUserList(
    root,
    deps,
    page,
    searchValue,
    statusValue,
    roleValue,
    current,
  );
}
