import { v1 } from '@imeal/contracts';

type AdminApi = (path: string, init?: RequestInit) => Promise<unknown>;

export interface AdminOversightDeps {
  api: AdminApi;
}

const PAGE_LIMIT = 20;

function createElement<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className?: string,
  text?: string,
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function button(text: string, action: () => void, variant: 'primary' | 'secondary' = 'primary') {
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

function errorMessage(error: unknown, fallback: string): string {
  return error instanceof Error && error.message ? error.message : fallback;
}

function field(labelText: string, value = '', type = 'text') {
  const wrapper = createElement('div', 'field');
  const label = createElement('label', '', labelText);
  const input = createElement('input');
  input.type = type;
  input.value = value;
  wrapper.append(label, input);
  return { wrapper, input };
}

function pager(
  page: number,
  pagination: { hasNextPage: boolean; total: number },
  load: (nextPage: number) => void,
) {
  const row = createElement('div', 'row-actions');
  row.append(
    button('Trước', () => load(page - 1), 'secondary'),
    createElement('span', 'muted', `Trang ${page} · ${pagination.total} bản ghi`),
    button('Sau', () => load(page + 1), 'secondary'),
  );
  const buttons = row.querySelectorAll('button');
  if (buttons[0]) buttons[0].disabled = page <= 1;
  if (buttons[1]) buttons[1].disabled = !pagination.hasNextPage;
  return row;
}

function detail(label: string, value: string | null | undefined) {
  return createElement('span', 'muted', `${label}: ${value && value.length > 0 ? value : '—'}`);
}

export async function renderPersistedAudit(
  root: HTMLElement,
  deps: AdminOversightDeps,
): Promise<void> {
  const section = createElement('section', 'operation-section');
  section.append(
    createElement('h2', '', 'Kiểm toán đã lưu'),
    createElement(
      'p',
      'muted',
      'AuditLog persisted trên máy chủ. Đây không phải nhật ký tạm trong trình duyệt. OTP, session token, GPS và QR thô được loại trước khi hiển thị.',
    ),
  );
  const action = field('Hành động');
  const actor = field('Actor user id');
  const target = field('Target user id');
  const result = field('Kết quả');
  const from = field('Từ', '', 'datetime-local');
  const to = field('Đến', '', 'datetime-local');
  const form = createElement('form', 'toolbar');
  const feedback = createElement('p', 'form-feedback');
  const list = createElement('div', 'stack');
  form.append(action.wrapper, actor.wrapper, target.wrapper, result.wrapper, from.wrapper, to.wrapper, button('Lọc', () => undefined));
  section.append(form, feedback, list);
  root.append(section);

  const load = async (page = 1) => {
    const params = new URLSearchParams({ page: String(page), limit: String(PAGE_LIMIT) });
    if (action.input.value.trim()) params.set('action', action.input.value.trim());
    if (actor.input.value.trim()) params.set('actorUserId', actor.input.value.trim());
    if (target.input.value.trim()) params.set('targetUserId', target.input.value.trim());
    if (result.input.value.trim()) params.set('result', result.input.value.trim());
    if (from.input.value) params.set('from', new Date(from.input.value).toISOString());
    if (to.input.value) params.set('to', new Date(to.input.value).toISOString());
    const parsed = v1.AdminAuditListResponseSchema.parse(
      await deps.api(`/v1/admin/audit?${params.toString()}`),
    );
    list.replaceChildren();
    if (parsed.items.length === 0) {
      list.append(createElement('div', 'card empty', 'Không có bản ghi kiểm toán phù hợp.'));
    }
    for (const entry of parsed.items) {
      const card = createElement('article', 'card audit-card');
      const heading = createElement('div', 'section-heading');
      heading.append(
        createElement('h3', '', entry.action),
        createElement('span', 'muted', dateTime(entry.createdAt)),
      );
      const details = createElement('div', 'audit-details');
      details.append(
        detail('Actor', entry.actorUserId),
        detail('Target', entry.targetUserId),
        detail('Kết quả', entry.result),
        detail('Tài nguyên', entry.resourceType),
      );
      if (entry.details) {
        for (const [key, value] of Object.entries(entry.details)) {
          details.append(detail(key, value === null ? null : String(value)));
        }
      }
      if (entry.redacted) {
        details.append(createElement('span', 'notice', 'Đã ẩn trường nhạy cảm.'));
      }
      card.append(heading, details);
      list.append(card);
    }
    list.append(pager(page, parsed.pagination, (nextPage) => void load(nextPage).catch(show)));
  };
  const show = (error: unknown) => {
    feedback.textContent = errorMessage(error, 'Không thể tải kiểm toán đã lưu.');
  };
  form.addEventListener('submit', (event) => {
    event.preventDefault();
    void load(1).catch(show);
  });
  await load(1);
}

export async function renderServingAudit(
  root: HTMLElement,
  deps: AdminOversightDeps,
): Promise<void> {
  const section = createElement('section', 'operation-section');
  section.append(
    createElement('h2', '', 'Kiểm toán phục vụ'),
    createElement(
      'p',
      'muted',
      'Chỉ đọc MealServing và các dòng đăng ký/check-in liên quan. Trường ủy quyền hoặc nhận hộ là bằng chứng lịch sử, không phải luồng đang hoạt động. Không hiển thị QR, GPS, OTP hay session token.',
    ),
  );
  const mealDate = field('Ngày suất ăn', '', 'date');
  const employee = field('Mã nhân viên');
  const status = createElement('div', 'field');
  const statusLabel = createElement('label', '', 'Trạng thái đăng ký');
  const statusInput = createElement('select');
  for (const option of ['', 'ACTIVE', 'CANCELLED', 'SERVED', 'NO_SHOW']) {
    statusInput.append(createElement('option', '', option || 'Tất cả'));
    statusInput.options[statusInput.options.length - 1]!.value = option;
  }
  status.append(statusLabel, statusInput);
  const form = createElement('form', 'toolbar');
  const feedback = createElement('p', 'form-feedback');
  const list = createElement('div', 'stack');
  form.append(mealDate.wrapper, employee.wrapper, status, button('Lọc', () => undefined));
  section.append(form, feedback, list);
  root.append(section);

  const load = async (page = 1) => {
    const params = new URLSearchParams({ page: String(page), limit: String(PAGE_LIMIT) });
    if (mealDate.input.value) params.set('mealDate', mealDate.input.value);
    if (employee.input.value.trim()) params.set('employeeCode', employee.input.value.trim());
    if (statusInput.value) params.set('registrationStatus', statusInput.value);
    const parsed = v1.AdminServingAuditResponseSchema.parse(
      await deps.api(`/v1/admin/servings?${params.toString()}`),
    );
    list.replaceChildren();
    if (parsed.items.length === 0) {
      list.append(createElement('div', 'card empty', 'Không có suất phục vụ phù hợp.'));
    }
    for (const item of parsed.items) {
      const card = createElement('article', 'card audit-card');
      const heading = createElement('div', 'section-heading');
      heading.append(
        createElement('h3', '', item.ownerName ?? item.employeeCode ?? item.servingId),
        createElement('span', 'muted', dateTime(item.servedAt)),
      );
      const details = createElement('div', 'audit-details');
      details.append(
        detail('Ngày', item.mealDate),
        detail('Chủ đăng ký', item.ownerUserId),
        detail('Mã nhân viên', item.employeeCode),
        detail('Địa điểm', item.locationName ?? item.locationShortCode),
        detail('Thực đơn', item.menuName),
        detail('Revision', item.menuRevisionId),
        detail('Trạng thái đăng ký', item.registrationStatus),
        detail('Check-in session', item.checkInSessionId),
        detail('Serving', item.servingId),
        detail('Actor check-in', item.authenticatedActorUserId),
        detail('Presenter', item.presenterUserId),
        detail('Receiver', item.receiverType),
      );
      if (item.historicalProxy) {
        details.append(
          createElement(
            'span',
            'notice',
            'Bằng chứng lịch sử presenter/receiver. Không có API ủy quyền đang hoạt động.',
          ),
        );
        details.append(detail('Delegation', item.delegationId), detail('Pickup session', item.pickupSessionId));
      }
      card.append(heading, details);
      list.append(card);
    }
    list.append(pager(page, parsed.pagination, (nextPage) => void load(nextPage).catch(show)));
  };
  const show = (error: unknown) => {
    feedback.textContent = errorMessage(error, 'Không thể tải kiểm toán phục vụ.');
  };
  form.addEventListener('submit', (event) => {
    event.preventDefault();
    void load(1).catch(show);
  });
  await load(1);
}

export async function renderJobsHealth(
  root: HTMLElement,
  deps: AdminOversightDeps,
): Promise<void> {
  const section = createElement('section', 'operation-section');
  section.append(
    createElement('h2', '', 'Tác vụ và sức khỏe'),
    createElement(
      'p',
      'muted',
      'Tóm tắt sức khỏe API/worker và các JobRun đã lưu. Không có nút chạy lại vì chưa có thao tác idempotent an toàn. Metrics riêng của worker không được công khai.',
    ),
  );
  const feedback = createElement('p', 'form-feedback');
  const summary = createElement('div', 'stack');
  const list = createElement('div', 'stack');
  section.append(feedback, summary, list);
  root.append(section);
  const load = async (page = 1) => {
    const parsed = v1.AdminJobsResponseSchema.parse(
      await deps.api(`/v1/admin/jobs?page=${page}&limit=${PAGE_LIMIT}`),
    );
    summary.replaceChildren();
    const health = createElement('article', 'card');
    const healthDetails = createElement('div', 'audit-details');
    healthDetails.append(
      detail('API', `${parsed.api.status} · ${parsed.api.release ?? 'không có release'}`),
      detail('API database', parsed.api.checks.database),
      detail('API migration', parsed.api.checks.migration),
      detail('Worker', `${parsed.worker.status} · ${parsed.worker.release ?? 'không có release'}`),
      detail('Worker database', parsed.worker.checks?.database),
      detail('Retry', parsed.retryAvailable ? 'có' : 'không có'),
    );
    health.append(createElement('h3', '', 'Sức khỏe'), healthDetails);
    const families = createElement('article', 'card');
    families.append(
      createElement('h3', '', 'Nhóm tác vụ'),
      createElement(
        'p',
        'muted',
        parsed.knownFamilies
          .map((item) => `${item.family}: ${item.persisted ? 'có JobRun' : 'không lưu JobRun'}`)
          .join(' · '),
      ),
    );
    summary.append(health, families);
    list.replaceChildren();
    if (parsed.items.length === 0) {
      list.append(createElement('div', 'card empty', 'Chưa có JobRun phù hợp.'));
    }
    for (const job of parsed.items) {
      const card = createElement('article', 'card audit-card');
      const heading = createElement('div', 'section-heading');
      heading.append(
        createElement('h3', '', job.jobName),
        createElement('span', 'muted', dateTime(job.startedAt)),
      );
      const details = createElement('div', 'audit-details');
      details.append(
        detail('Nhóm', job.family),
        detail('Trạng thái', job.status),
        detail('Hoàn tất', job.completedAt),
        detail('Mã lỗi', job.failureCode),
        detail('Thông báo', job.failureMessage),
        detail('Thành công', job.successCount === null ? null : String(job.successCount)),
        detail('Thất bại', job.failureCount === null ? null : String(job.failureCount)),
        detail('Release', job.releaseVersion),
      );
      card.append(heading, details);
      list.append(card);
    }
    list.append(pager(page, parsed.pagination, (nextPage) => void load(nextPage).catch(show)));
  };
  const show = (error: unknown) => {
    feedback.textContent = errorMessage(error, 'Không thể tải sức khỏe tác vụ.');
  };
  await load(1);
}
