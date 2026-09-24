import { z } from 'zod';
import {
  selectEffectiveLocationPolicy,
  toRosterImportRequest,
  toRosterPreviewRows,
  toSafeAuditEntry,
  type AuditEntry,
  type RosterImportRow,
  type RosterPreview,
  type SafeAuditEntry,
} from './admin-operations';
import './styles.css';

const UserProfileSchema = z.object({
  id: z.string().optional(),
  userId: z.string().optional(),
  name: z.string().nullable().optional(),
  email: z.string(),
  roles: z.array(z.string()),
  permissions: z.array(z.string()),
});
type UserProfile = z.infer<typeof UserProfileSchema>;

const DailyMenuSchema = z
  .object({
    date: z.string(),
    isEnabled: z.boolean(),
    isHoliday: z.boolean(),
    revisions: z.array(z.object({ content: z.string() })).optional(),
  })
  .transform(({ revisions, ...day }) => ({
    ...day,
    content: revisions?.[0]?.content,
  }));

const WeeklyMenusSchema = z.array(
  z.object({
    startDate: z.string(),
    endDate: z.string(),
    dailyMenus: z.array(DailyMenuSchema),
  }),
);

const PenaltyItemSchema = z.object({
  id: z.string(),
  userName: z.string().nullable().optional(),
  userEmail: z.string().optional(),
  amount: z.number(),
  reason: z.string(),
  status: z.enum(['PENDING', 'PAID', 'WAIVED']),
  createdAt: z.string(),
});
type PenaltyItem = z.infer<typeof PenaltyItemSchema>;
type PenaltyFilterStatus = 'ALL' | PenaltyItem['status'];

const penaltyFilterOptions: Array<{
  value: PenaltyFilterStatus;
  label: string;
}> = [
  { value: 'ALL', label: 'Tất cả' },
  { value: 'PENDING', label: 'Đang chờ' },
  { value: 'PAID', label: 'Đã thanh toán' },
  { value: 'WAIVED', label: 'Đã miễn' },
];

const penaltyStatusLabels: Record<PenaltyItem['status'], string> = {
  PENDING: 'Đang chờ',
  PAID: 'Đã thanh toán',
  WAIVED: 'Đã miễn',
};

const PenaltyPageSchema = z.object({
  items: z.array(PenaltyItemSchema),
  total: z.number().optional(),
});

const ErrorResponseSchema = z.object({
  code: z.string().optional(),
  message: z.string().optional(),
});
const OtpRequestResponseSchema = z.object({
  accepted: z.literal(true),
  retryAfterSeconds: z.number().optional(),
});
const OtpVerifyResponseSchema = z.object({
  sessionToken: z.string().min(1),
  expiresAt: z.string(),
  user: z.object({
    id: z.string(),
    email: z.string(),
    name: z.string().nullable(),
  }),
});

const LocationPolicySchema = z.object({
  id: z.string().optional(),
  accuracySource: z.string(),
  geofenceRadiusMeters: z.number(),
  maxFixAgeSeconds: z.number(),
  maxAccuracyMeters: z.number(),
  effectiveFrom: z.string(),
  effectiveTo: z.string().nullable().optional(),
  isActive: z.boolean(),
});
const LocationSchema = z.object({
  id: z.string(),
  shortCode: z.string(),
  displayName: z.string(),
  servingPointName: z.string(),
  address: z.string(),
  building: z.string(),
  floor: z.string(),
  roomOrCounter: z.string(),
  localContact: z.string(),
  timeZone: z.string().optional(),
  isActive: z.boolean(),
  effectiveFrom: z.string(),
  effectiveTo: z.string().nullable().optional(),
  capacityNotes: z.string().nullable().optional(),
  accessibilityInstructions: z.string().nullable().optional(),
  emergencyInstructions: z.string().nullable().optional(),
  kitchenTeam: z.string().nullable().optional(),
  approvedScannerDeviceIds: z.array(z.string()).optional(),
  networkNotes: z.string().nullable().optional(),
  policies: z.array(LocationPolicySchema).optional(),
});
type Location = z.infer<typeof LocationSchema>;
type LocationPolicy = z.infer<typeof LocationPolicySchema>;

const AllowlistEntrySchema = z.object({
  id: z.string(),
  normalizedEmail: z.string(),
  userId: z.string().nullable().optional(),
  state: z.enum(['ACTIVE', 'DISABLED']),
  purpose: z.string(),
  effectiveFrom: z.string(),
  effectiveTo: z.string().nullable().optional(),
  reason: z.string().nullable().optional(),
});
type AllowlistEntry = z.infer<typeof AllowlistEntrySchema>;

const RosterInputRowSchema = z
  .object({
    email: z.string(),
    name: z.string(),
    employeeCode: z.string(),
    isActive: z.boolean(),
    role: z.string(),
    serviceLocationCode: z.string(),
    effectiveFrom: z.string(),
    effectiveTo: z.string().nullable(),
  })
  .strict();
const RosterPreviewSchema = z.object({
  batchId: z.string().optional(),
  source: z.string(),
  rows: z.array(
    z.object({
      email: z.string(),
      name: z.string(),
      employeeCode: z.string(),
      isActive: z.boolean(),
      role: z.string(),
      serviceLocationCode: z.string(),
      effectiveFrom: z.string(),
      effectiveTo: z.string().nullable(),
      rowNumber: z.number(),
      normalizedEmail: z.string(),
      locationId: z.string().optional(),
      reason: z.string().optional(),
    }),
  ),
  valid: z.boolean(),
  acceptedCount: z.number(),
  rejectedCount: z.number(),
});
const RosterImportResultSchema = z.object({
  batchId: z.string(),
  rows: z.array(
    z.object({
      rowNumber: z.number(),
      normalizedEmail: z.string(),
      assignmentId: z.string(),
      outcome: z.literal('ACCEPTED'),
    }),
  ),
  acceptedCount: z.number(),
  idempotent: z.boolean(),
});

class AdminDisplayError extends Error {
  readonly code?: string;

  constructor(message: string, code?: string) {
    super(message);
    this.name = 'AdminDisplayError';
    this.code = code;
  }
}

function userFacingMessage(error: unknown, fallback: string): string {
  if (error instanceof AdminDisplayError) return error.message;
  return fallback;
}

type ViewName = 'menus' | 'penalties' | 'operations';

const API_URL = (
  import.meta.env.VITE_API_URL || window.location.origin
).replace(/\/$/, '');
const SESSION_KEY = 'imeal.session-token';
const appRoot = document.querySelector<HTMLElement>('#app');
if (!appRoot) throw new Error('Admin Web root element is missing');
const app = appRoot;

let localToken: string | null = null;
let profile: UserProfile | null = null;
let currentView: ViewName = 'operations';
let auditEntries: SafeAuditEntry[] = [];

function element<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className?: string,
  text?: string,
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function actionButton(
  text: string,
  action: () => void,
  variant: 'primary' | 'secondary' | 'danger' = 'primary',
): HTMLButtonElement {
  const node = element(
    'button',
    `button ${variant === 'primary' ? '' : variant}`,
    text,
  );
  node.type = 'button';
  node.addEventListener('click', action);
  return node;
}

function showError(error: unknown): void {
  const message = userFacingMessage(error, 'Đã xảy ra lỗi không xác định.');
  document.querySelector('.error')?.remove();
  const target = document.querySelector('.layout') ?? app;
  target.prepend(element('div', 'error', message));
}

async function accessToken(): Promise<string> {
  if (!localToken) throw new AdminDisplayError('Bạn cần đăng nhập.');
  return localToken;
}

async function api(path: string, init?: RequestInit): Promise<unknown> {
  const token = await accessToken();
  const response = await fetch(`${API_URL}${path}`, {
    ...init,
    headers: {
      Accept: 'application/json',
      Authorization: `Bearer ${token}`,
      ...(init?.body ? { 'Content-Type': 'application/json' } : {}),
      ...init?.headers,
    },
  });
  const payload: unknown = await response.json().catch(() => null);
  if (!response.ok) {
    const parsedError = ErrorResponseSchema.safeParse(payload);
    throw new AdminDisplayError(
      parsedError.success && parsedError.data.message
        ? parsedError.data.message
        : `Yêu cầu thất bại với mã trạng thái ${response.status}.`,
      parsedError.success ? parsedError.data.code : undefined,
    );
  }
  return payload;
}

async function publicApi(path: string, init: RequestInit): Promise<unknown> {
  const response = await fetch(`${API_URL}${path}`, {
    ...init,
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/json',
      ...init.headers,
    },
  });
  const payload: unknown = await response.json().catch(() => null);
  if (!response.ok) {
    const parsedError = ErrorResponseSchema.safeParse(payload);
    throw new AdminDisplayError(
      parsedError.success && parsedError.data.message
        ? parsedError.data.message
        : 'Không thể hoàn tất yêu cầu OTP.',
      parsedError.success ? parsedError.data.code : undefined,
    );
  }
  return payload;
}

function formatDate(value: string | Date): string {
  const date = value instanceof Date ? value : new Date(value);
  if (!Number.isFinite(date.getTime())) return '—';
  return new Intl.DateTimeFormat('vi-VN', { dateStyle: 'medium' }).format(date);
}

function formatDateTime(value: string | Date): string {
  const date = value instanceof Date ? value : new Date(value);
  if (!Number.isFinite(date.getTime())) return '—';
  return new Intl.DateTimeFormat('vi-VN', {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(date);
}

function dateTimeInputValue(value: string | Date | null | undefined): string {
  if (!value) return '';
  const date = value instanceof Date ? value : new Date(value);
  if (!Number.isFinite(date.getTime())) return '';
  const iso = date.toISOString();
  return `${iso.slice(0, 16)}`;
}

function isoOrFallback(value: string, fallback: string): string {
  if (!value.trim()) return fallback;
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? date.toISOString() : fallback;
}

function inputField(
  labelText: string,
  value: string,
  type = 'text',
  required = false,
): { wrapper: HTMLDivElement; input: HTMLInputElement } {
  const wrapper = element('div', 'field');
  const label = element('label', '', labelText);
  const input = element('input');
  input.type = type;
  input.value = value;
  input.required = required;
  wrapper.append(label, input);
  return { wrapper, input };
}

function renderShell(): HTMLElement {
  const shell = element('div', 'shell');
  const header = element('header', 'header');
  header.append(element('h1', 'brand', 'Quản trị IMeal'));
  const identity = element('div', 'profile');
  identity.append(
    element('span', '', profile?.name || profile?.email || ''),
    actionButton('Đăng xuất', () => void signOut(), 'secondary'),
  );
  header.append(identity);

  const layout = element('div', 'layout');
  const nav = element('nav', 'nav');
  if (profile?.permissions.includes('menu.manage')) {
    const menuButton = actionButton('Thực đơn tuần', () => void renderMenus());
    menuButton.setAttribute('aria-pressed', String(currentView === 'menus'));
    nav.append(menuButton);
  }
  if (profile?.permissions.includes('penalty.read')) {
    const penaltyButton = actionButton('Khoản phạt', () => void renderPenalties());
    penaltyButton.setAttribute('aria-pressed', String(currentView === 'penalties'));
    nav.append(penaltyButton);
  }
  if (
    profile?.permissions.some((permission) =>
      ['location.manage', 'allowlist.manage', 'roster.manage'].includes(permission),
    )
  ) {
    const operationsButton = actionButton('Vận hành & kiểm toán', () => void renderOperations());
    operationsButton.setAttribute('aria-pressed', String(currentView === 'operations'));
    nav.append(operationsButton);
  }
  layout.append(nav, element('section', 'content'));
  shell.append(header, layout);
  return shell;
}

function contentRoot(): HTMLElement {
  const root = document.querySelector<HTMLElement>('.content');
  if (!root) throw new Error('Content root is missing');
  return root;
}

function operationHeading(title: string, description: string): HTMLElement {
  const heading = element('div', 'section-heading');
  heading.append(element('h2', '', title), element('p', 'muted', description));
  return heading;
}

function recordAudit(action: string, details: unknown): void {
  const safe = toSafeAuditEntry({
    action,
    createdAt: new Date(),
    details,
  });
  auditEntries = [safe, ...auditEntries].slice(0, 25);
}

async function updateDailyMenu(
  date: string,
  update: Record<string, boolean | string>,
): Promise<void> {
  await api(`/admin/weekly-menus/${date.slice(0, 10)}`, {
    method: 'PUT',
    body: JSON.stringify(update),
  });
  await renderMenus();
}

async function renderMenus(): Promise<void> {
  currentView = 'menus';
  app.replaceChildren(renderShell());
  const root = contentRoot();
  const toolbar = element('form', 'toolbar');
  const field = element('div', 'field');
  const label = element('label', '', 'Tuần bắt đầu từ thứ Hai');
  const input = element('input');
  input.type = 'date';
  input.required = true;
  label.htmlFor = 'week-start';
  input.id = 'week-start';
  field.append(label, input);
  const create = actionButton('Tạo bản nháp', () => undefined);
  create.type = 'submit';
  toolbar.append(field, create);
  toolbar.addEventListener('submit', (event) => {
    event.preventDefault();
    void (async () => {
      try {
        await api('/admin/weekly-menus/draft', {
          method: 'POST',
          body: JSON.stringify({ startDate: input.value }),
        });
        await renderMenus();
      } catch (error: unknown) {
        showError(error);
      }
    })();
  });
  root.append(toolbar);

  try {
    const weeks = WeeklyMenusSchema.parse(await api('/admin/weekly-menus'));
    if (weeks.length === 0) {
      root.append(element('div', 'card empty', 'Chưa có thực đơn tuần nào.'));
      return;
    }
    for (const week of weeks) {
      const card = element('article', 'card');
      const heading = element('div', 'week-header');
      heading.append(
        element('h2', '', `${formatDate(week.startDate)} – ${formatDate(week.endDate)}`),
        actionButton('Đăng thực đơn tuần', () => {
          void api(`/admin/weekly-menus/${week.startDate.slice(0, 10)}/publish`, { method: 'POST' })
            .then(() => renderMenus())
            .catch(showError);
        }),
      );
      const days = element('div', 'days');
      for (const day of week.dailyMenus) {
        const row = element('div', 'row');
        row.append(
          element(
            'div',
            'row-main',
            `${formatDate(day.date)} · ${day.isHoliday ? 'Ngày nghỉ' : day.isEnabled ? 'Đang phục vụ' : 'Đã tắt'}`,
          ),
        );
        const contentInput = element('textarea', 'meal-description');
        contentInput.rows = 3;
        contentInput.value = day.content || '';
        contentInput.placeholder = 'Mô tả món ăn';
        contentInput.setAttribute('aria-label', `Mô tả món ăn ngày ${formatDate(day.date)}`);
        const actions = element('div', 'row-actions menu-actions');
        actions.append(
          contentInput,
          actionButton('Lưu món', () => {
            void updateDailyMenu(day.date, { content: contentInput.value }).catch(showError);
          }, 'secondary'),
          actionButton(day.isEnabled ? 'Tắt' : 'Bật', () => {
            void updateDailyMenu(day.date, {
              isEnabled: !day.isEnabled,
              ...(!day.isEnabled ? { isHoliday: false } : {}),
            }).catch(showError);
          }, 'secondary'),
          actionButton(day.isHoliday ? 'Ngày làm việc' : 'Ngày nghỉ', () => {
            void updateDailyMenu(day.date, {
              isHoliday: !day.isHoliday,
              ...(!day.isHoliday ? { isEnabled: false } : {}),
            }).catch(showError);
          }, 'secondary'),
        );
        row.append(actions);
        days.append(row);
      }
      card.append(heading, days);
      root.append(card);
    }
  } catch (error: unknown) {
    showError(error);
  }
}

async function renderPenalties(): Promise<void> {
  currentView = 'penalties';
  app.replaceChildren(renderShell());
  const root = contentRoot();
  const toolbar = element('form', 'toolbar');
  const searchField = element('div', 'field');
  const search = element('input');
  search.placeholder = 'Tên hoặc email';
  searchField.append(element('label', '', 'Tìm kiếm'), search);
  const statusField = element('div', 'field');
  const status = element('select');
  for (const filterOption of penaltyFilterOptions) {
    const option = element('option', '', filterOption.label);
    option.value = filterOption.value;
    status.append(option);
  }
  statusField.append(element('label', '', 'Trạng thái'), status);
  const filter = actionButton('Áp dụng bộ lọc', () => undefined);
  filter.type = 'submit';
  toolbar.append(searchField, statusField, filter);
  root.append(toolbar);

  const load = async () => {
    root.querySelectorAll('.penalty-card, .empty').forEach((node) => node.remove());
    const query = new URLSearchParams({ status: status.value, search: search.value });
    const page = PenaltyPageSchema.parse(await api(`/admin/penalties?${query}`));
    if (page.items.length === 0) {
      root.append(element('div', 'card empty', 'Không có khoản phạt phù hợp với bộ lọc.'));
      return;
    }
    for (const penalty of page.items) {
      const card = element('article', 'card penalty-card row');
      const details = element('div', 'row-main');
      details.append(
        element('strong', '', penalty.userName || penalty.userEmail || 'Người dùng không xác định'),
        element('div', 'muted', `${penalty.reason} · ${formatDate(penalty.createdAt)}`),
        element('div', 'amount', `${penalty.amount.toLocaleString('vi-VN')} ₫`),
      );
      const actions = element('div', 'row-actions');
      actions.append(element('span', `status ${penalty.status.toLowerCase()}`, penaltyStatusLabels[penalty.status]));
      if (penalty.status === 'PENDING' && profile?.permissions.includes('penalty.resolve')) {
        actions.append(
          actionButton('Đánh dấu đã thanh toán', () => {
            void api(`/admin/penalties/${penalty.id}/paid`, { method: 'POST' }).then(load).catch(showError);
          }),
          actionButton('Miễn phạt', () => {
            const reason = window.prompt('Lý do miễn phạt (ít nhất 5 ký tự)');
            if (!reason || reason.trim().length < 5) return;
            void api(`/admin/penalties/${penalty.id}/waive`, {
              method: 'POST',
              body: JSON.stringify({ reason }),
            }).then(load).catch(showError);
          }, 'danger'),
        );
      }
      card.append(details, actions);
      root.append(card);
    }
  };
  toolbar.addEventListener('submit', (event) => {
    event.preventDefault();
    void load().catch(showError);
  });
  await load().catch(showError);
}

function renderLocationCard(location: Location): HTMLElement {
  const card = element('article', 'card operation-card');
  const policy = selectEffectiveLocationPolicy(location.policies ?? []);
  const title = element('div', 'section-heading');
  title.append(
    element('h3', '', `${location.shortCode} · ${location.displayName}`),
    element('span', `status ${location.isActive ? 'paid' : 'waived'}`, location.isActive ? 'Đang bật' : 'Đã tắt'),
  );
  const summary = element(
    'p',
    'muted',
    `${location.servingPointName} · ${location.address} · hiệu lực từ ${formatDate(location.effectiveFrom)}`,
  );
  const form = element('form', 'operation-form');
  const grid = element('div', 'form-grid');
  const displayName = inputField('Tên hiển thị', location.displayName, 'text', true);
  const servingPoint = inputField('Điểm phục vụ', location.servingPointName, 'text', true);
  const address = inputField('Địa chỉ đã phê duyệt', location.address, 'text', true);
  const building = inputField('Tòa nhà', location.building, 'text', true);
  const floor = inputField('Tầng', location.floor, 'text', true);
  const room = inputField('Phòng/quầy', location.roomOrCounter, 'text', true);
  const localContact = inputField('Liên hệ tại điểm', location.localContact, 'text', true);
  const effectiveFrom = inputField('Hiệu lực từ', dateTimeInputValue(location.effectiveFrom), 'datetime-local', true);
  const effectiveTo = inputField('Hiệu lực đến', dateTimeInputValue(location.effectiveTo), 'datetime-local');
  const scannerIds = inputField(
    'Thiết bị scanner được phép (phân cách bằng dấu phẩy)',
    (location.approvedScannerDeviceIds ?? []).join(', '),
  );
  const radius = inputField('Bán kính geofence (m)', String(policy?.geofenceRadiusMeters ?? ''), 'number', true);
  const maxAge = inputField('Tuổi fix tối đa (giây)', String(policy?.maxFixAgeSeconds ?? ''), 'number', true);
  const maxAccuracy = inputField('Độ chính xác tối đa (m)', String(policy?.maxAccuracyMeters ?? ''), 'number', true);
  const accuracySource = inputField('Nguồn chính sách độ chính xác', policy?.accuracySource ?? '', 'text', true);
  for (const field of [
    displayName,
    servingPoint,
    address,
    building,
    floor,
    room,
    localContact,
    effectiveFrom,
    effectiveTo,
    scannerIds,
    radius,
    maxAge,
    maxAccuracy,
    accuracySource,
  ]) grid.append(field.wrapper);
  const active = element('label', 'check-field');
  const activeInput = element('input');
  activeInput.type = 'checkbox';
  activeInput.checked = location.isActive;
  active.append(activeInput, element('span', '', 'Cho phép phục vụ ở điểm này'));
  const policyActive = element('label', 'check-field');
  const policyActiveInput = element('input');
  policyActiveInput.type = 'checkbox';
  policyActiveInput.checked = policy?.isActive ?? false;
  policyActive.append(policyActiveInput, element('span', '', 'Chính sách GPS đang hoạt động'));
  const policyNote = element(
    'p',
    'notice',
    policy
      ? `Chính sách hiện tại: bán kính ${policy.geofenceRadiusMeters} m · fix tối đa ${policy.maxFixAgeSeconds} giây · sai số tối đa ${policy.maxAccuracyMeters} m. Tọa độ không hiển thị trong Admin Web.`
      : 'Điểm này chưa có chính sách GPS hiệu lực.',
  );
  const save = actionButton('Lưu cấu hình điểm và scanner', () => undefined);
  save.type = 'submit';
  const feedback = element('div', 'form-feedback');
  form.append(grid, active, policyActive, policyNote, save, feedback);
  form.addEventListener('submit', (event) => {
    event.preventDefault();
    if (!policy) {
      feedback.textContent = 'Không thể lưu khi điểm chưa có chính sách GPS.';
      return;
    }
    save.disabled = true;
    const payload = {
      id: location.id,
      shortCode: location.shortCode,
      displayName: displayName.input.value.trim(),
      servingPointName: servingPoint.input.value.trim(),
      address: address.input.value.trim(),
      building: building.input.value.trim(),
      floor: floor.input.value.trim(),
      roomOrCounter: room.input.value.trim(),
      localContact: localContact.input.value.trim(),
      timeZone: 'Asia/Ho_Chi_Minh',
      isActive: activeInput.checked,
      effectiveFrom: isoOrFallback(effectiveFrom.input.value, location.effectiveFrom),
      effectiveTo: effectiveTo.input.value
        ? isoOrFallback(effectiveTo.input.value, location.effectiveTo ?? location.effectiveFrom)
        : null,
      approvedScannerDeviceIds: scannerIds.input.value
        .split(',')
        .map((value) => value.trim())
        .filter(Boolean),
      capacityNotes: location.capacityNotes ?? null,
      accessibilityInstructions: location.accessibilityInstructions ?? null,
      emergencyInstructions: location.emergencyInstructions ?? null,
      kitchenTeam: location.kitchenTeam ?? null,
      networkNotes: location.networkNotes ?? null,
      policy: {
        id: policy.id,
        accuracySource: accuracySource.input.value.trim(),
        geofenceRadiusMeters: Number(radius.input.value),
        maxFixAgeSeconds: Number(maxAge.input.value),
        maxAccuracyMeters: Number(maxAccuracy.input.value),
        effectiveFrom: policy.effectiveFrom,
        effectiveTo: policy.effectiveTo ?? null,
        isActive: policyActiveInput.checked,
      },
    };
    void api(`/admin/locations/${location.id}`, {
      method: 'PUT',
      body: JSON.stringify(payload),
    })
      .then((result) => {
        recordAudit('LOCATION_CONFIGURATION_UPDATED', {
          result: 'ACCEPTED',
          locationId: location.id,
          scannerCount: payload.approvedScannerDeviceIds.length,
        });
        feedback.textContent = 'Đã lưu cấu hình điểm và danh sách scanner.';
        return result;
      })
      .then(() => renderOperations())
      .catch((error: unknown) => {
        feedback.textContent = userFacingMessage(error, 'Không thể lưu cấu hình điểm.');
      })
      .finally(() => {
        save.disabled = false;
      });
  });
  card.append(title, summary, form);
  return card;
}

async function renderLocations(root: HTMLElement): Promise<void> {
  const section = element('section', 'operation-section');
  section.append(
    operationHeading(
      'Điểm phục vụ và chính sách',
      'Chỉ hiển thị các bản ghi đã được tổ chức phê duyệt. Không có thao tác tạo seed hoặc nhập tọa độ tùy ý.',
    ),
  );
  try {
    const locations = z.array(LocationSchema).parse(await api('/admin/locations'));
    if (locations.length === 0) {
      section.append(element('div', 'card empty', 'Chưa có điểm phục vụ được phê duyệt.'));
    } else {
      for (const location of locations) section.append(renderLocationCard(location));
    }
  } catch (error: unknown) {
    section.append(element('div', 'error', userFacingMessage(error, 'Không thể tải cấu hình điểm phục vụ.')));
  }
  root.append(section);
}

function renderAllowlistEntry(entry: AllowlistEntry): HTMLElement {
  const card = element('article', 'row operation-row');
  const details = element('div', 'row-main');
  details.append(
    element('strong', '', entry.normalizedEmail),
    element('div', 'muted', `${entry.purpose} · ${formatDate(entry.effectiveFrom)} – ${entry.effectiveTo ? formatDate(entry.effectiveTo) : 'không hết hạn'}`),
    entry.reason ? element('div', 'muted', `Lý do: ${entry.reason}`) : element('div', 'muted', 'Không có ghi chú'),
  );
  const actions = element('div', 'row-actions');
  const toggle = actionButton(entry.state === 'ACTIVE' ? 'Tắt allowlist' : 'Bật allowlist', () => {
    void api(`/admin/allowlist/${entry.id}`, {
      method: 'PUT',
      body: JSON.stringify({
        email: entry.normalizedEmail,
        userId: entry.userId ?? null,
        state: entry.state === 'ACTIVE' ? 'DISABLED' : 'ACTIVE',
        effectiveFrom: entry.effectiveFrom,
        effectiveTo: entry.effectiveTo ?? null,
        reason: entry.reason ?? null,
      }),
    })
      .then(() => {
        recordAudit('ALLOWLIST_UPDATED', {
          result: 'ACCEPTED',
          state: entry.state === 'ACTIVE' ? 'DISABLED' : 'ACTIVE',
        });
        return renderOperations();
      })
      .catch(showError);
  });
  actions.append(
    element('span', `status ${entry.state === 'ACTIVE' ? 'paid' : 'waived'}`, entry.state === 'ACTIVE' ? 'Đang cho phép' : 'Đã tắt'),
    toggle,
  );
  return card;
}

async function renderAllowlist(root: HTMLElement): Promise<void> {
  const section = element('section', 'operation-section');
  section.append(
    operationHeading(
      'Allowlist A',
      'Chỉ tài khoản được allowlist mới nhận OTP. Thao tác này không cấp, thu hồi hoặc thay đổi vai trò quản trị.',
    ),
  );
  const form = element('form', 'card operation-form');
  const grid = element('div', 'form-grid');
  const email = inputField('Email', '', 'email', true);
  const userId = inputField('User ID (nếu đã liên kết)', '');
  const stateField = element('div', 'field');
  const stateLabel = element('label', '', 'Trạng thái');
  const state = element('select');
  for (const value of ['ACTIVE', 'DISABLED'] as const) {
    const option = element('option', '', value === 'ACTIVE' ? 'Đang cho phép' : 'Đã tắt');
    option.value = value;
    state.append(option);
  }
  stateField.append(stateLabel, state);
  const effectiveFrom = inputField('Hiệu lực từ', dateTimeInputValue(new Date()), 'datetime-local', true);
  const effectiveTo = inputField('Hiệu lực đến', '','datetime-local');
  const reason = inputField('Lý do (tùy chọn)', '');
  for (const field of [email, userId, stateField, effectiveFrom, effectiveTo, reason]) {
    grid.append('wrapper' in field ? field.wrapper : field);
  }
  const submit = actionButton('Lưu allowlist', () => undefined);
  submit.type = 'submit';
  const feedback = element('div', 'form-feedback');
  form.append(grid, submit, feedback);
  form.addEventListener('submit', (event) => {
    event.preventDefault();
    submit.disabled = true;
    void api('/admin/allowlist', {
      method: 'POST',
      body: JSON.stringify({
        email: email.input.value,
        userId: userId.input.value.trim() || null,
        state: state.value,
        effectiveFrom: isoOrFallback(effectiveFrom.input.value, new Date().toISOString()),
        effectiveTo: effectiveTo.input.value ? isoOrFallback(effectiveTo.input.value, new Date().toISOString()) : null,
        reason: reason.input.value.trim() || null,
      }),
    })
      .then((result) => {
        recordAudit('ALLOWLIST_UPSERTED', { result: 'ACCEPTED', state: state.value });
        feedback.textContent = 'Đã lưu allowlist. OTP vẫn không được hiển thị trong Admin Web.';
        return result;
      })
      .then(() => renderOperations())
      .catch((error: unknown) => {
        feedback.textContent = userFacingMessage(error, 'Không thể lưu allowlist.');
      })
      .finally(() => {
        submit.disabled = false;
      });
  });
  section.append(form);

  const list = element('div', 'stack');
  try {
    const entries = z.array(AllowlistEntrySchema).parse(await api('/admin/allowlist'));
    if (entries.length === 0) list.append(element('div', 'card empty', 'Chưa có allowlist record.'));
    else for (const entry of entries) list.append(renderAllowlistEntry(entry));
  } catch (error: unknown) {
    list.append(element('div', 'error', userFacingMessage(error, 'Không thể tải allowlist.')));
  }
  section.append(list);
  root.append(section);
}

function renderRosterPreview(
  preview: RosterPreview,
  onCommit: () => void,
): HTMLElement {
  const card = element('article', 'card preview-card');
  const summary = element('div', 'section-heading');
  summary.append(
    element('h3', '', 'Kết quả xem trước'),
    element('span', `status ${preview.valid ? 'paid' : 'waived'}`, preview.valid ? 'Có thể commit' : 'Cần sửa dữ liệu'),
  );
  summary.append(element('p', 'muted', `${preview.acceptedCount} dòng hợp lệ · ${preview.rejectedCount} dòng bị từ chối`));
  const table = element('div', 'table-wrap');
  const header = element('div', 'table-row table-header');
  for (const label of ['Dòng', 'Email', 'Nhân viên', 'Điểm', 'Kết quả']) header.append(element('span', '', label));
  table.append(header);
  for (const row of toRosterPreviewRows(preview)) {
    const line = element('div', 'table-row');
    line.append(
      element('span', '', String(row.rowNumber)),
      element('span', '', row.normalizedEmail),
      element('span', '', `${row.name} · ${row.employeeCode}`),
      element('span', '', row.serviceLocationCode),
      element('span', `status ${row.outcome === 'ACCEPTED' ? 'paid' : 'waived'}`, row.outcome === 'ACCEPTED' ? 'Hợp lệ' : row.reason || 'Từ chối'),
    );
    table.append(line);
  }
  card.append(summary, table);
  if (preview.valid && preview.batchId) {
    const commit = actionButton('Commit toàn bộ dòng hợp lệ', onCommit);
    commit.classList.add('commit-button');
    card.append(commit, element('p', 'notice', 'Commit là thao tác all-or-nothing; không có commit một phần hoặc thay thế dòng lỗi.'));
  } else {
    card.append(element('p', 'notice', 'Chưa thể commit. Sửa tất cả dòng bị từ chối rồi xem trước lại.'));
  }
  return card;
}

async function renderRoster(root: HTMLElement): Promise<void> {
  const section = element('section', 'operation-section');
  section.append(
    operationHeading(
      'Import roster',
      'Dán JSON của roster đã được phê duyệt để xem trước. Chỉ commit sau khi mọi dòng hợp lệ; kết quả từng dòng sẽ được hiển thị.',
    ),
  );
  const form = element('form', 'card operation-form');
  const rows = element('textarea', 'json-input');
  rows.rows = 10;
  rows.placeholder = '[{"email":"employee@example.test","name":"...","employeeCode":"...","isActive":true,"role":"PRESENTER","serviceLocationCode":"LOC-A","effectiveFrom":"2026-09-24T00:00:00.000Z","effectiveTo":null}]';
  rows.required = true;
  const label = element('label', '', 'Roster JSON');
  label.append(rows);
  const previewButton = actionButton('Xem trước import', () => undefined);
  previewButton.type = 'submit';
  const feedback = element('div', 'form-feedback');
  const previewTarget = element('div', 'preview-target');
  let latestPreview: RosterPreview | null = null;
  form.append(label, previewButton, feedback);
  form.addEventListener('submit', (event) => {
    event.preventDefault();
    previewButton.disabled = true;
    void (async () => {
      try {
        const parsed = JSON.parse(rows.value) as unknown;
        const inputRows = z.array(RosterInputRowSchema).min(1).parse(parsed) as ReadonlyArray<RosterImportRow>;
        const request = toRosterImportRequest(inputRows);
        const preview = RosterPreviewSchema.parse(await api('/admin/roster/preview', {
          method: 'POST',
          body: JSON.stringify(request),
        }));
        latestPreview = preview;
        previewTarget.replaceChildren(
          renderRosterPreview(preview, () => {
            if (!latestPreview?.valid || !latestPreview.batchId) return;
            const batchId = latestPreview.batchId;
            void api(`/admin/roster/${batchId}/commit`, { method: 'POST' })
              .then((result) => {
                const committed = RosterImportResultSchema.parse(result);
                recordAudit('ROSTER_IMPORT_COMMITTED', {
                  result: 'ACCEPTED',
                  batchId: committed.batchId,
                  acceptedCount: committed.acceptedCount,
                  idempotent: committed.idempotent,
                });
                feedback.textContent = `Đã commit ${committed.acceptedCount} dòng trong một giao dịch.`;
                return renderOperations();
              })
              .catch((error: unknown) => {
                feedback.textContent = userFacingMessage(error, 'Import bị từ chối; không có dòng nào được commit.');
              });
          }),
        );
        feedback.textContent = preview.valid ? 'Xem trước hoàn tất; hãy kiểm tra trước khi commit.' : 'Có dòng lỗi; chưa cho phép commit.';
      } catch (error: unknown) {
        feedback.textContent = error instanceof SyntaxError ? 'JSON không hợp lệ.' : userFacingMessage(error, 'Không thể xem trước roster.');
      } finally {
        previewButton.disabled = false;
      }
    })();
  });
  section.append(form, previewTarget);
  root.append(section);
}

function renderAudit(): HTMLElement {
  const section = element('section', 'operation-section');
  section.append(
    operationHeading(
      'Kết quả kiểm toán an toàn',
      'Hiển thị các thao tác trong phiên này sau khi loại bỏ OTP, session token, QR và dữ liệu GPS thô. Không có xuất dữ liệu tùy ý.',
    ),
  );
  if (auditEntries.length === 0) {
    section.append(element('div', 'card empty', 'Chưa có thao tác vận hành trong phiên hiện tại.'));
    return section;
  }
  const list = element('div', 'stack');
  for (const entry of auditEntries) {
    const card = element('article', 'card audit-card');
    const heading = element('div', 'section-heading');
    heading.append(element('h3', '', entry.action), element('span', 'muted', formatDateTime(entry.occurredAt ?? '')));
    const details = element('div', 'audit-details');
    if (entry.result) details.append(element('span', 'status paid', entry.result));
    if (entry.actorId) details.append(element('span', 'muted', `Actor: ${entry.actorId}`));
    for (const [key, value] of Object.entries(entry.details)) {
      details.append(element('span', 'muted', `${key}: ${String(value)}`));
    }
    if (entry.redactedFields.length > 0) {
      details.append(element('span', 'notice', `${entry.redactedFields.length} trường nhạy cảm đã được ẩn.`));
    }
    card.append(heading, details);
    list.append(card);
  }
  section.append(list);
  return section;
}

async function renderOperations(): Promise<void> {
  currentView = 'operations';
  app.replaceChildren(renderShell());
  const root = contentRoot();
  const permissions = profile?.permissions ?? [];
  if (!permissions.some((permission) => ['location.manage', 'allowlist.manage', 'roster.manage'].includes(permission))) {
    root.append(element('div', 'card empty', 'Tài khoản không có quyền vận hành được cấp.'));
    return;
  }
  if (permissions.includes('location.manage')) await renderLocations(root);
  if (permissions.includes('allowlist.manage')) await renderAllowlist(root);
  if (permissions.includes('roster.manage')) await renderRoster(root);
  root.append(renderAudit());
}

async function verifyOtp(email: string, code: string): Promise<void> {
  const result = OtpVerifyResponseSchema.parse(await publicApi('/auth/otp/verify', {
    method: 'POST',
    body: JSON.stringify({ email, purpose: 'SESSION_LOGIN', code }),
  }));
  localToken = result.sessionToken;
  sessionStorage.setItem(SESSION_KEY, localToken);
  profile = UserProfileSchema.parse(await api('/auth/me'));
  await renderDefaultView();
}

async function requestOtp(email: string): Promise<void> {
  OtpRequestResponseSchema.parse(await publicApi('/auth/otp/request', {
    method: 'POST',
    body: JSON.stringify({ email, purpose: 'SESSION_LOGIN' }),
  }));
}

async function signOut(error?: unknown): Promise<void> {
  const token = localToken;
  localToken = null;
  profile = null;
  auditEntries = [];
  sessionStorage.removeItem(SESSION_KEY);
  if (token) {
    await fetch(`${API_URL}/auth/logout`, {
      method: 'POST',
      headers: { Accept: 'application/json', Authorization: `Bearer ${token}` },
    }).catch(() => undefined);
  }
  renderLogin(error);
}

function renderLogin(error?: unknown, requestedEmail = '', codeRequested = false): void {
  const login = element('div', 'login');
  const card = element('section', 'card');
  const form = element('form', 'otp-form');
  const email = inputField('Email công việc', requestedEmail, 'email', true);
  email.input.autocomplete = 'email';
  const code = inputField('Mã OTP', '', 'text', codeRequested);
  code.input.inputMode = 'numeric';
  code.input.autocomplete = 'one-time-code';
  code.input.maxLength = 6;
  if (!codeRequested) code.wrapper.hidden = true;
  const submit = actionButton(codeRequested ? 'Xác nhận OTP' : 'Nhận mã OTP', () => undefined);
  submit.type = 'submit';
  const feedback = element('div', 'form-feedback');
  form.append(email.wrapper, code.wrapper, submit, feedback);
  form.addEventListener('submit', (event) => {
    event.preventDefault();
    submit.disabled = true;
    const normalizedEmail = email.input.value.trim().toLowerCase();
    void (async () => {
      if (!codeRequested) {
        await requestOtp(normalizedEmail);
        renderLogin(undefined, normalizedEmail, true);
        return;
      }
      await verifyOtp(normalizedEmail, code.input.value.trim());
    })()
      .catch((loginError: unknown) => {
        feedback.textContent = userFacingMessage(loginError, 'Không thể hoàn tất đăng nhập.');
      })
      .finally(() => {
        submit.disabled = false;
      });
  });
  card.append(
    element('h1', '', 'Quản trị IMeal'),
    element('p', 'muted', 'Nhập email công việc trong allowlist A để nhận mã OTP. Trạng thái allowlist không được tiết lộ.'),
    form,
  );
  if (error) card.append(element('div', 'error', userFacingMessage(error, 'Phiên đăng nhập không còn hợp lệ.')));
  login.append(card);
  app.replaceChildren(login);
}

async function renderDefaultView(): Promise<void> {
  if (!profile) {
    renderLogin();
    return;
  }
  if (profile.permissions.some((permission) => ['location.manage', 'allowlist.manage', 'roster.manage'].includes(permission))) {
    await renderOperations();
  } else if (profile.permissions.includes('menu.manage')) {
    await renderMenus();
  } else if (profile.permissions.includes('penalty.read')) {
    await renderPenalties();
  } else {
    throw new AdminDisplayError('Tài khoản không có quyền quản trị.');
  }
}

async function bootstrap(): Promise<void> {
  const savedToken = sessionStorage.getItem(SESSION_KEY);
  if (!savedToken) {
    renderLogin();
    return;
  }
  localToken = savedToken;
  try {
    profile = UserProfileSchema.parse(await api('/auth/me'));
    await renderDefaultView();
  } catch (error: unknown) {
    await signOut(error);
  }
}

void bootstrap().catch(renderLogin);
