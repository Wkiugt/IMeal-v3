import { z } from 'zod';
import './styles.css';

const UserProfileSchema = z.object({
  name: z.string().optional(),
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

const PenaltyPageSchema = z.object({
  items: z.array(PenaltyItemSchema),
  total: z.number().optional(),
});

const ErrorResponseSchema = z.object({ message: z.string() });

type ViewName = 'menus' | 'penalties';

const API_URL = (
  import.meta.env.VITE_API_URL || window.location.origin
).replace(/\/$/, '');
const SESSION_KEY = 'imeal.local.access-token';
const LocalLoginSchema = z.object({
  accessToken: z.string(),
  user: UserProfileSchema,
});
const appRoot = document.querySelector<HTMLElement>('#app');
if (!appRoot) {
  throw new Error('Admin Web root element is missing');
}
const app = appRoot;

let localToken: string | null = null;
let profile: UserProfile | null = null;
let currentView: ViewName = 'menus';

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
  const message = error instanceof Error ? error.message : 'Unexpected error';
  const existing = document.querySelector('.error');
  existing?.remove();
  const target = document.querySelector('.layout') ?? app;
  target.prepend(element('div', 'error', message));
}

async function accessToken(): Promise<string> {
  if (!localToken) throw new Error('Sign in is required');
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
    const message = parsedError.success
      ? parsedError.data.message
      : `Request failed with status ${response.status}`;
    throw new Error(message);
  }
  return payload;
}

function formatDate(value: string): string {
  return new Intl.DateTimeFormat('en-GB', { dateStyle: 'medium' }).format(
    new Date(value),
  );
}

function renderShell(): HTMLElement {
  const shell = element('div', 'shell');
  const header = element('header', 'header');
  header.append(element('h1', 'brand', 'IMeal Administration'));
  const identity = element('div', 'profile');
  identity.append(
    element('span', '', profile?.name || profile?.email || ''),
    actionButton('Sign out', () => void signOut(), 'secondary'),
  );
  header.append(identity);

  const layout = element('div', 'layout');
  const nav = element('nav', 'nav');
  if (profile?.permissions.includes('menu.manage')) {
    const menuButton = actionButton('Weekly menus', () => void renderMenus());
    menuButton.setAttribute('aria-pressed', String(currentView === 'menus'));
    nav.append(menuButton);
  }
  if (profile?.permissions.includes('penalty.read')) {
    const penaltyButton = actionButton(
      'Penalties',
      () => void renderPenalties(),
    );
    penaltyButton.setAttribute(
      'aria-pressed',
      String(currentView === 'penalties'),
    );
    nav.append(penaltyButton);
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
  const label = element('label', '', 'Week starts Monday');
  const input = element('input');
  input.type = 'date';
  input.required = true;
  label.htmlFor = 'week-start';
  input.id = 'week-start';
  field.append(label, input);
  const create = actionButton('Create draft', () => undefined);
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
      root.append(element('div', 'card empty', 'No weekly menus yet.'));
      return;
    }
    for (const week of weeks) {
      const card = element('article', 'card');
      const heading = element('div', 'week-header');
      heading.append(
        element(
          'h2',
          '',
          `${formatDate(week.startDate)} – ${formatDate(week.endDate)}`,
        ),
        actionButton('Publish week', () => {
          void api(
            `/admin/weekly-menus/${week.startDate.slice(0, 10)}/publish`,
            {
              method: 'POST',
            },
          )
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
            `${formatDate(day.date)} · ${day.isHoliday ? 'Holiday' : day.isEnabled ? 'Enabled' : 'Disabled'}`,
          ),
        );
        const contentInput = element('input');
        contentInput.value = day.content || '';
        contentInput.placeholder = 'Meal description';
        const actions = element('div', 'row-actions');
        actions.append(
          contentInput,
          actionButton(
            'Save meal',
            () => {
              void updateDailyMenu(day.date, {
                content: contentInput.value,
              }).catch(showError);
            },
            'secondary',
          ),
          actionButton(
            day.isEnabled ? 'Disable' : 'Enable',
            () => {
              void updateDailyMenu(day.date, {
                isEnabled: !day.isEnabled,
                ...(!day.isEnabled ? { isHoliday: false } : {}),
              }).catch(showError);
            },
            'secondary',
          ),
          actionButton(
            day.isHoliday ? 'Working day' : 'Holiday',
            () => {
              void updateDailyMenu(day.date, {
                isHoliday: !day.isHoliday,
                ...(!day.isHoliday ? { isEnabled: false } : {}),
              }).catch(showError);
            },
            'secondary',
          ),
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
  search.placeholder = 'Name or email';
  searchField.append(element('label', '', 'Search'), search);
  const statusField = element('div', 'field');
  const status = element('select');
  for (const value of ['ALL', 'PENDING', 'PAID', 'WAIVED']) {
    const option = element('option', '', value);
    option.value = value;
    status.append(option);
  }
  statusField.append(element('label', '', 'Status'), status);
  const filter = actionButton('Apply filters', () => undefined);
  filter.type = 'submit';
  toolbar.append(searchField, statusField, filter);
  root.append(toolbar);

  const load = async () => {
    root
      .querySelectorAll('.penalty-card, .empty')
      .forEach((node) => node.remove());
    const query = new URLSearchParams({
      status: status.value,
      search: search.value,
    });
    const page = PenaltyPageSchema.parse(
      await api(`/admin/penalties?${query}`),
    );
    if (page.items.length === 0) {
      root.append(
        element('div', 'card empty', 'No penalties match these filters.'),
      );
      return;
    }
    for (const penalty of page.items) {
      const card = element('article', 'card penalty-card row');
      const details = element('div', 'row-main');
      details.append(
        element(
          'strong',
          '',
          penalty.userName || penalty.userEmail || 'Unknown user',
        ),
        element(
          'div',
          'muted',
          `${penalty.reason} · ${formatDate(penalty.createdAt)}`,
        ),
        element('div', 'amount', `${penalty.amount.toLocaleString('vi-VN')} ₫`),
      );
      const actions = element('div', 'row-actions');
      actions.append(
        element(
          'span',
          `status ${penalty.status.toLowerCase()}`,
          penalty.status,
        ),
      );
      if (
        penalty.status === 'PENDING' &&
        profile?.permissions.includes('penalty.resolve')
      ) {
        actions.append(
          actionButton('Mark paid', () => {
            void api(`/admin/penalties/${penalty.id}/paid`, { method: 'POST' })
              .then(load)
              .catch(showError);
          }),
          actionButton(
            'Waive',
            () => {
              const reason = window.prompt(
                'Waiver reason (at least 5 characters)',
              );
              if (!reason || reason.trim().length < 5) return;
              void api(`/admin/penalties/${penalty.id}/waive`, {
                method: 'POST',
                body: JSON.stringify({ reason }),
              })
                .then(load)
                .catch(showError);
            },
            'danger',
          ),
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

async function signIn(username: string, password: string): Promise<void> {
  const response = await fetch(`${API_URL}/auth/local-login`, {
    method: 'POST',
    headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
    body: JSON.stringify({ username, password }),
  });
  const payload: unknown = await response.json().catch(() => null);
  if (!response.ok) {
    const parsedError = ErrorResponseSchema.safeParse(payload);
    throw new Error(
      parsedError.success
        ? parsedError.data.message
        : `Sign-in failed with status ${response.status}`,
    );
  }
  const login = LocalLoginSchema.parse(payload);
  localToken = login.accessToken;
  profile = login.user;
  sessionStorage.setItem(SESSION_KEY, localToken);
  const defaultView = profile.permissions.includes('menu.manage')
    ? 'menus'
    : 'penalties';
  if (defaultView === 'menus') await renderMenus();
  else await renderPenalties();
}

function signOut(error?: unknown): void {
  localToken = null;
  profile = null;
  sessionStorage.removeItem(SESSION_KEY);
  renderLogin(error);
}

function renderLogin(error?: unknown): void {
  const login = element('div', 'login');
  const card = element('section', 'card');
  const form = element('form');
  const username = element('input');
  username.type = 'text';
  username.name = 'username';
  username.placeholder = 'Username';
  username.autocomplete = 'username';
  username.required = true;
  const password = element('input');
  password.type = 'password';
  password.name = 'password';
  password.placeholder = 'Password';
  password.autocomplete = 'current-password';
  password.required = true;
  const submit = actionButton('Sign in', () => undefined);
  submit.type = 'submit';
  form.append(username, password, submit);
  form.addEventListener('submit', (event) => {
    event.preventDefault();
    submit.disabled = true;
    void signIn(username.value, password.value)
      .catch((signInError) => renderLogin(signInError))
      .finally(() => {
        submit.disabled = false;
      });
  });
  card.append(
    element('h1', '', 'IMeal Administration'),
    element(
      'p',
      'muted',
      'Use the local admin credentials configured in .env.',
    ),
    form,
  );
  if (error) {
    card.append(
      element(
        'div',
        'error',
        error instanceof Error ? error.message : 'Sign-in failed',
      ),
    );
  }
  login.append(card);
  app.replaceChildren(login);
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
    if (profile.permissions.includes('menu.manage')) await renderMenus();
    else if (profile.permissions.includes('penalty.read')) {
      await renderPenalties();
    } else {
      throw new Error('Your account has no administration permissions');
    }
  } catch (error: unknown) {
    signOut(error);
  }
}

void bootstrap().catch(renderLogin);
