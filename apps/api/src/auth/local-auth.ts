import { BadRequestException } from '@nestjs/common';

export type LocalAuthRole = 'staff' | 'kitchen' | 'admin';

export interface LocalAuthAccount {
  username: string;
  password: string;
  email: string;
  name: string;
  role: LocalAuthRole;
}
const LOCAL_AUTH_ROLES: Record<LocalAuthRole, true> = {
  staff: true,
  kitchen: true,
  admin: true,
};

function parseAccount(value: unknown, index: number): LocalAuthAccount {
  if (!value || typeof value !== 'object') {
    throw new Error(`LOCAL_AUTH_USERS entry ${index + 1} must be an object`);
  }

  const candidate = value as Record<string, unknown>;
  const username =
    typeof candidate.username === 'string' ? candidate.username.trim() : '';
  const password =
    typeof candidate.password === 'string' ? candidate.password : '';
  const email =
    typeof candidate.email === 'string'
      ? candidate.email.trim().toLowerCase()
      : '';
  const name = typeof candidate.name === 'string' ? candidate.name.trim() : '';
  const role =
    typeof candidate.role === 'string'
      ? candidate.role.trim().toLowerCase()
      : '';

  if (
    !username ||
    !password ||
    !email ||
    !name ||
    !LOCAL_AUTH_ROLES[role as LocalAuthRole]
  ) {
    throw new Error(`LOCAL_AUTH_USERS entry ${index + 1} is invalid`);
  }

  return { username, password, email, name, role: role as LocalAuthRole };
}

export function readLocalAuthAccounts(
  env: NodeJS.ProcessEnv = process.env,
): LocalAuthAccount[] {
  const raw = env.LOCAL_AUTH_USERS?.trim();
  if (!raw) return [];

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error('LOCAL_AUTH_USERS must contain valid JSON');
  }

  if (!Array.isArray(parsed) || parsed.length === 0) {
    throw new Error('LOCAL_AUTH_USERS must contain a non-empty JSON array');
  }

  const accounts = parsed.map(parseAccount);
  const usernames = new Set<string>();
  const emails = new Set<string>();
  for (const account of accounts) {
    const username = account.username.toLowerCase();
    if (usernames.has(username))
      throw new Error(`Duplicate local username: ${account.username}`);
    if (emails.has(account.email))
      throw new Error(`Duplicate local email: ${account.email}`);
    usernames.add(username);
    emails.add(account.email);
  }
  return accounts;
}

export function requireLocalAuthAccounts(): LocalAuthAccount[] {
  const accounts = readLocalAuthAccounts();
  if (accounts.length === 0) {
    throw new Error('LOCAL_AUTH_USERS is required when AUTH_MODE=local');
  }
  return accounts;
}

export function parseLocalCredentials(body: unknown): {
  username: string;
  password: string;
} {
  if (!body || typeof body !== 'object') {
    throw new BadRequestException('Username and password are required');
  }
  const candidate = body as Record<string, unknown>;
  const username =
    typeof candidate.username === 'string' ? candidate.username.trim() : '';
  const password =
    typeof candidate.password === 'string' ? candidate.password : '';
  if (!username || !password) {
    throw new BadRequestException('Username and password are required');
  }
  return { username, password };
}
