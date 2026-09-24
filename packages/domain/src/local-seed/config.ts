import { URL } from 'node:url';
import type { LocalSeedConfig } from './types.js';

export type LocalSeedConfigErrorCode =
  | 'MISSING_ARGUMENT'
  | 'INVALID_EMAIL'
  | 'INVALID_DATE'
  | 'INVALID_ENVIRONMENT'
  | 'INVALID_DATABASE_URL'
  | 'REMOTE_DATABASE'
  | 'PRODUCTION_MARKER'
  | 'CONFLICTING_INPUT';

export class LocalSeedConfigError extends Error {
  readonly code: LocalSeedConfigErrorCode;

  constructor(code: LocalSeedConfigErrorCode) {
    super(code);
    this.name = 'LocalSeedConfigError';
    this.code = code;
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

const DEFAULT_WEEK_START = '2026-09-28';
const LOCAL_CONFIRMATION = 'I_UNDERSTAND_LOCAL_ONLY';
const APPROVED_HOSTS: Record<string, true> = {
  localhost: true,
  '127.0.0.1': true,
  '::1': true,
  db: true,
};
const DEPLOYMENT_ENVIRONMENT_KEYS = ['APP_ENV', 'RUNTIME_ENV', 'DEPLOYMENT_ENV'] as const;
const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;
const EMAIL = /^[^\s@]+@[^\s@]+$/;
const PRODUCTION_MARKER =
  /production|staging|preview|(?:^|[_.-])(prod|live)(?:$|[_.-])/i;

type ParsedArguments = {
  readonly baseEmail?: string;
  readonly weekStart?: string;
  readonly serveDate?: string;
  readonly dryRun: boolean;
};

export function parseLocalSeedConfig(
  argv: readonly string[],
  env: NodeJS.ProcessEnv,
): LocalSeedConfig {
  const args = parseArguments(argv);
  const nodeEnv = env.NODE_ENV;
  if (nodeEnv !== 'development' && nodeEnv !== 'test') {
    throw new LocalSeedConfigError('INVALID_ENVIRONMENT');
  }
  if (env.IMEAL_LOCAL_SEED !== '1' || env.IMEAL_LOCAL_SEED_CONFIRM !== LOCAL_CONFIRMATION) {
    throw new LocalSeedConfigError('INVALID_ENVIRONMENT');
  }
  if (
    DEPLOYMENT_ENVIRONMENT_KEYS.some(
      (key) => env[key]?.trim().toLowerCase() === 'production',
    )
  ) {
    throw new LocalSeedConfigError('INVALID_ENVIRONMENT');
  }

  const baseEmail = resolveInput(
    args.baseEmail,
    env.IMEAL_LOCAL_SEED_BASE_EMAIL,
    normalizeEmailForComparison,
  );
  if (!baseEmail) {
    throw new LocalSeedConfigError('MISSING_ARGUMENT');
  }
  const normalizedEmail = normalizeEmailForComparison(baseEmail);
  if (!EMAIL.test(normalizedEmail)) {
    throw new LocalSeedConfigError('INVALID_EMAIL');
  }

  const weekStart = resolveInput(
    args.weekStart,
    env.IMEAL_LOCAL_SEED_WEEK_START,
    (value) => value,
  ) ?? DEFAULT_WEEK_START;
  const serveDate = resolveInput(
    args.serveDate,
    env.IMEAL_LOCAL_SEED_SERVE_DATE,
    (value) => value,
  ) ?? weekStart;
  const weekStartTime = parseDateOnly(weekStart);
  const serveDateTime = parseDateOnly(serveDate);
  const weekStartDay = new Date(weekStartTime).getUTCDay();
  if (weekStartDay !== 1 || serveDateTime < weekStartTime || serveDateTime > weekStartTime + 6 * DAY) {
    throw new LocalSeedConfigError('INVALID_DATE');
  }

  const databaseUrl = env.DATABASE_URL;
  if (!databaseUrl) {
    throw new LocalSeedConfigError('MISSING_ARGUMENT');
  }
  const target = parseDatabaseTarget(databaseUrl);
  const dryRun = resolveDryRun(args.dryRun, env.IMEAL_LOCAL_SEED_DRY_RUN);
  return {
    baseEmail: normalizedEmail,
    weekStart,
    serveDate,
    dryRun,
    databaseUrl,
    target: {
      nodeEnv,
      host: target.host,
      database: target.database,
      schema: target.schema,
    },
  };
}

export function localSeedHelp(): string {
  return [
    'Usage: seed:local [--base-email EMAIL] [--week-start YYYY-MM-DD] [--serve-date YYYY-MM-DD] [--dry-run]',
    '',
    'Required environment: NODE_ENV=development|test, IMEAL_LOCAL_SEED=1,',
    `IMEAL_LOCAL_SEED_CONFIRM=${LOCAL_CONFIRMATION}, and DATABASE_URL.`,
    'DATABASE_URL must target localhost, 127.0.0.1, ::1, or the local Compose host db.',
  ].join('\n');
}

export function formatLocalSeedTarget(config: LocalSeedConfig): string {
  return [
    'LOCAL/TEST ONLY',
    `environment=${config.target.nodeEnv}`,
    `host=${config.target.host}`,
    `database=${config.target.database}`,
    `schema=${config.target.schema ?? '(default)'}`,
    `weekStart=${config.weekStart}`,
    `serveDate=${config.serveDate}`,
  ].join(' ');
}

const DAY = 24 * 60 * 60 * 1_000;

function parseArguments(argv: readonly string[]): ParsedArguments {
  const parsed: {
    baseEmail?: string;
    weekStart?: string;
    serveDate?: string;
    dryRun: boolean;
  } = { dryRun: false };

  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === '--dry-run') {
      parsed.dryRun = true;
      continue;
    }

    const equalsIndex = argument.indexOf('=');
    const name = equalsIndex === -1 ? argument : argument.slice(0, equalsIndex);
    const inlineValue = equalsIndex === -1 ? undefined : argument.slice(equalsIndex + 1);
    if (
      name !== '--base-email' &&
      name !== '--week-start' &&
      name !== '--serve-date'
    ) {
      throw new LocalSeedConfigError('MISSING_ARGUMENT');
    }

    const value = inlineValue ?? argv[index + 1];
    if (!value || (inlineValue === undefined && value.startsWith('--'))) {
      throw new LocalSeedConfigError('MISSING_ARGUMENT');
    }
    if (inlineValue === undefined) index += 1;

    if (name === '--base-email') parsed.baseEmail = value;
    if (name === '--week-start') parsed.weekStart = value;
    if (name === '--serve-date') parsed.serveDate = value;
  }

  return parsed;
}

function resolveInput(
  flagValue: string | undefined,
  environmentValue: string | undefined,
  normalize: (value: string) => string,
): string | undefined {
  if (
    flagValue !== undefined &&
    environmentValue !== undefined &&
    normalize(flagValue) !== normalize(environmentValue)
  ) {
    throw new LocalSeedConfigError('CONFLICTING_INPUT');
  }
  return flagValue ?? environmentValue;
}

function normalizeEmailForComparison(value: string): string {
  return value.normalize('NFKC').trim().toLowerCase();
}

function parseDateOnly(value: string): number {
  if (!DATE_ONLY.test(value)) {
    throw new LocalSeedConfigError('INVALID_DATE');
  }
  const [year, month, day] = value.split('-').map(Number);
  const timestamp = Date.UTC(year, month - 1, day);
  const date = new Date(timestamp);
  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month - 1 ||
    date.getUTCDate() !== day
  ) {
    throw new LocalSeedConfigError('INVALID_DATE');
  }
  return timestamp;
}

function parseDatabaseTarget(databaseUrl: string): {
  readonly host: string;
  readonly database: string;
  readonly schema: string | null;
} {
  let parsed: URL;
  try {
    parsed = new URL(databaseUrl);
  } catch {
    throw new LocalSeedConfigError('INVALID_DATABASE_URL');
  }

  if (parsed.protocol !== 'postgresql:' && parsed.protocol !== 'postgres:') {
    throw new LocalSeedConfigError('INVALID_DATABASE_URL');
  }
  const host = parsed.hostname.toLowerCase().replace(/^\[|\]$/g, '');
  if (!Object.hasOwn(APPROVED_HOSTS, host)) {
    throw new LocalSeedConfigError('REMOTE_DATABASE');
  }

  let database: string;
  try {
    database = decodeURIComponent(parsed.pathname.replace(/^\//, ''));
  } catch {
    throw new LocalSeedConfigError('INVALID_DATABASE_URL');
  }
  if (!database || database.includes('/')) {
    throw new LocalSeedConfigError('INVALID_DATABASE_URL');
  }
  const schemas = parsed.searchParams.getAll('schema');
  if (schemas.some((schema) => !schema)) {
    throw new LocalSeedConfigError('INVALID_DATABASE_URL');
  }
  if (
    [database, ...schemas].some((component) => PRODUCTION_MARKER.test(component))
  ) {
    throw new LocalSeedConfigError('PRODUCTION_MARKER');
  }
  const schema = schemas[0] ?? null;

  return { host, database, schema };
}

function resolveDryRun(flagValue: boolean, environmentValue: string | undefined): boolean {
  if (environmentValue !== undefined && environmentValue !== '0' && environmentValue !== '1') {
    throw new LocalSeedConfigError('INVALID_ENVIRONMENT');
  }
  const environmentDryRun = environmentValue === '1';
  if (flagValue && environmentValue === '0') {
    throw new LocalSeedConfigError('CONFLICTING_INPUT');
  }
  return flagValue || environmentDryRun;
}
