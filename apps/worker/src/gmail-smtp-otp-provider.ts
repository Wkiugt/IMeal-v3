import { Injectable } from '@nestjs/common';
import nodemailer from 'nodemailer';
import type {
  OtpProvider,
  OtpProviderInput,
} from './otp-delivery-worker.service.js';

export interface OtpSmtpTransport {
  sendMail(message: {
    from: { name: string; address: string };
    to: string;
    subject: string;
    text: string;
    html: string;
  }): Promise<{
    accepted?: string[];
    rejected?: string[];
    messageId?: string;
  }>;
}

export interface OtpSmtpTransportOptions {
  host: string;
  port: number;
  secure: boolean;
  requireTLS: boolean;
  ignoreTLS?: boolean;
  auth: { user: string; pass: string };
  tls: { minVersion: 'TLSv1.2'; servername: string };
  connectionTimeout: number;
  greetingTimeout: number;
  socketTimeout: number;
  disableFileAccess: boolean;
  disableUrlAccess: boolean;
  logger: false;
}

export type OtpSmtpTransportFactory = (
  options: OtpSmtpTransportOptions,
) => OtpSmtpTransport;

export type GmailSmtpConfiguration = {
  host: string;
  port: number;
  requireTls: true;
  username: string | null;
  password: string | null;
  from: string | null;
  fromName: string;
  expirySeconds: number;
};

const GMAIL_SMTP_HOST = 'smtp.gmail.com';
const SMTP_TIMEOUT_MS = 15_000;
function hasControlCharacter(value: string): boolean {
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code <= 31 || code === 127) return true;
  }
  return false;
}
const SIMPLE_EMAIL = /^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$/;
const PLACEHOLDER_MARKERS = [
  'change_me_local',
  'replace-with-',
  'example.test',
];
const NETWORK_ERROR_CODES: Record<string, true> = {
  ECONNECTION: true,
  ETIMEDOUT: true,
  EDNS: true,
  ENOTFOUND: true,
  EAI_AGAIN: true,
  ESOCKET: true,
};
const SMTP_AUTH_RESPONSE_CODES = new Set([534, 535]);
const SMTP_TRANSIENT_RESPONSE_CODES = new Set([421, 450, 451, 452, 454]);

function isPlaceholder(value: string): boolean {
  const normalized = value.toLowerCase();
  return PLACEHOLDER_MARKERS.some((marker) => normalized.includes(marker));
}

function requireProductionValue(name: string, env: NodeJS.ProcessEnv): string {
  const value = env[name]?.trim();
  if (!value) {
    throw new Error(`Missing required worker environment variable: ${name}`);
  }
  if (isPlaceholder(value)) {
    throw new Error(`${name} must not use a placeholder value`);
  }
  return value;
}

function requireTls(env: NodeJS.ProcessEnv): true {
  const raw = env.OTP_SMTP_REQUIRE_TLS?.trim();
  if (!raw || /^true$/i.test(raw)) return true;
  throw new Error('OTP_SMTP_REQUIRE_TLS must be enabled');
}

function smtpHost(env: NodeJS.ProcessEnv, production: boolean): string {
  const raw = env.OTP_SMTP_HOST?.trim();
  const host = raw || GMAIL_SMTP_HOST;
  if (hasControlCharacter(host)) {
    throw new Error('OTP_SMTP_HOST contains unsupported characters');
  }
  if (production && host.toLowerCase() !== GMAIL_SMTP_HOST) {
    throw new Error('OTP_SMTP_HOST must be smtp.gmail.com in production');
  }
  return host.toLowerCase() === GMAIL_SMTP_HOST ? GMAIL_SMTP_HOST : host;
}

function smtpPort(env: NodeJS.ProcessEnv, production: boolean): number {
  const raw = env.OTP_SMTP_PORT?.trim();
  if (!raw) return 587;
  if (!/^[1-9]\d*$/.test(raw)) {
    throw new Error('OTP_SMTP_PORT must be a positive integer');
  }
  const port = Number(raw);
  if (!Number.isSafeInteger(port) || port > 65535) {
    throw new Error('OTP_SMTP_PORT must be a positive integer');
  }
  if (production && port !== 587) {
    throw new Error('OTP_SMTP_PORT must be 587 in production');
  }
  return port;
}

function singleLineEmail(name: string, value: string): string {
  const trimmed = value.trim();
  if (
    hasControlCharacter(value) ||
    hasControlCharacter(trimmed) ||
    !SIMPLE_EMAIL.test(trimmed)
  ) {
    throw new Error(`${name} must be a single email address`);
  }
  return trimmed;
}

function optionalEmail(name: string, env: NodeJS.ProcessEnv): string | null {
  const raw = env[name];
  if (raw === undefined || raw.trim() === '') return null;
  return singleLineEmail(name, raw);
}

function fromName(env: NodeJS.ProcessEnv): string {
  const raw = env.OTP_SMTP_FROM_NAME;
  if (raw === undefined || raw.trim() === '') return 'IMeal';
  if (hasControlCharacter(raw)) {
    throw new Error('OTP_SMTP_FROM_NAME contains unsupported characters');
  }
  return raw.trim();
}

function expirySeconds(env: NodeJS.ProcessEnv, production: boolean): number {
  const raw = env.OTP_EXPIRY_SECONDS?.trim();
  if (!raw) {
    if (production) {
      throw new Error(
        'Missing required worker environment variable: OTP_EXPIRY_SECONDS',
      );
    }
    return 600;
  }
  if (!/^[1-9]\d*$/.test(raw)) {
    throw new Error('OTP_EXPIRY_SECONDS must be a positive integer');
  }
  const seconds = Number(raw);
  if (!Number.isSafeInteger(seconds)) {
    throw new Error('OTP_EXPIRY_SECONDS must be a positive integer');
  }
  return seconds;
}

export function gmailSmtpConfiguration(
  env: NodeJS.ProcessEnv = process.env,
): GmailSmtpConfiguration {
  const production = env.NODE_ENV?.trim() === 'production';
  requireTls(env);
  const host = smtpHost(env, production);
  const port = smtpPort(env, production);
  const name = fromName(env);
  const seconds = expirySeconds(env, production);
  const username = production
    ? singleLineEmail(
        'OTP_SMTP_USERNAME',
        requireProductionValue('OTP_SMTP_USERNAME', env),
      )
    : optionalEmail('OTP_SMTP_USERNAME', env);
  const password = production
    ? requireProductionValue('OTP_SMTP_PASSWORD', env)
    : env.OTP_SMTP_PASSWORD?.trim() || null;
  const from = production
    ? singleLineEmail(
        'OTP_SMTP_FROM',
        requireProductionValue('OTP_SMTP_FROM', env),
      )
    : optionalEmail('OTP_SMTP_FROM', env);
  if (password && isPlaceholder(password) && production) {
    throw new Error('OTP_SMTP_PASSWORD must not use a placeholder value');
  }
  return {
    host,
    port,
    requireTls: true,
    username,
    password,
    from,
    fromName: name,
    expirySeconds: seconds,
  };
}

function textField(error: unknown, key: string): string {
  if (typeof error !== 'object' || error === null) return '';
  const value = Reflect.get(error, key);
  return typeof value === 'string' ? value : '';
}

function numericResponseCode(error: unknown): number | undefined {
  if (typeof error !== 'object' || error === null) return undefined;
  const value = Reflect.get(error, 'responseCode');
  if (typeof value === 'number' && Number.isInteger(value)) return value;
  if (typeof value === 'string' && /^[1-9]\d{2}$/.test(value)) {
    return Number(value);
  }
  return undefined;
}

export function smtpFailureCategory(error: unknown): string | undefined {
  const code = textField(error, 'code').trim().toUpperCase();
  const responseCode = numericResponseCode(error);
  if (
    code === 'EAUTH' ||
    (responseCode !== undefined && SMTP_AUTH_RESPONSE_CODES.has(responseCode))
  ) {
    return 'AUTHENTICATION';
  }
  const hint = `${code} ${textField(error, 'response')} ${textField(error, 'command')}`;
  const message = error instanceof Error ? error.message : '';
  if (code === 'ETLS' || /certificate|handshake/i.test(`${hint} ${message}`)) {
    return 'TLS';
  }
  if (
    NETWORK_ERROR_CODES[code] === true ||
    /timeout|timed out/i.test(code) ||
    /timeout|timed out|econn|enotfound|eai_again/i.test(message)
  ) {
    return 'NETWORK';
  }
  if (responseCode === undefined) return undefined;
  if (
    SMTP_TRANSIENT_RESPONSE_CODES.has(responseCode) ||
    (responseCode >= 400 && responseCode <= 499)
  ) {
    return 'SMTP_RATE_LIMIT';
  }
  if (responseCode >= 500 && responseCode <= 599) return 'SMTP_PERMANENT';
  return undefined;
}

function deliveryError(category: string): Error & { providerCode: string } {
  const error = new Error(`SMTP delivery failed: ${category}`) as Error & {
    providerCode: string;
  };
  error.providerCode = category;
  return error;
}

function expirySentence(seconds: number): string {
  if (seconds % 60 === 0) {
    const minutes = seconds / 60;
    return minutes === 1
      ? 'This code expires in 1 minute.'
      : `This code expires in ${minutes} minutes.`;
  }
  return seconds === 1
    ? 'This code expires in 1 second.'
    : `This code expires in ${seconds} seconds.`;
}

function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}
function defaultNodemailerFactory(
  options: OtpSmtpTransportOptions,
): OtpSmtpTransport {
  const transport = nodemailer.createTransport(options);
  return {
    sendMail: (message) => transport.sendMail(message),
  };
}

function transportOptions(
  config: GmailSmtpConfiguration & { username: string; password: string },
): OtpSmtpTransportOptions {
  return {
    host: config.host,
    port: config.port,
    secure: false,
    requireTLS: true,
    ignoreTLS: false,
    auth: { user: config.username, pass: config.password },
    tls: { minVersion: 'TLSv1.2', servername: config.host },
    connectionTimeout: SMTP_TIMEOUT_MS,
    greetingTimeout: SMTP_TIMEOUT_MS,
    socketTimeout: SMTP_TIMEOUT_MS,
    disableFileAccess: true,
    disableUrlAccess: true,
    logger: false,
  };
}

@Injectable()
export class GmailSmtpOtpProvider implements OtpProvider {
  private transport: OtpSmtpTransport | undefined;

  constructor(
    private readonly env: NodeJS.ProcessEnv = process.env,
    private readonly transportFactory: OtpSmtpTransportFactory = defaultNodemailerFactory,
  ) {}

  async send(input: OtpProviderInput): Promise<void> {
    const config = gmailSmtpConfiguration(this.env);
    if (!config.username || !config.password || !config.from) {
      throw deliveryError('CONFIGURATION');
    }
    const transport =
      this.transport ??
      this.transportFactory(
        transportOptions({
          ...config,
          username: config.username,
          password: config.password,
        }),
      );
    this.transport = transport;
    const sentence = expirySentence(config.expirySeconds);
    const text = [
      'IMeal',
      `Your verification code is ${input.code}.`,
      sentence,
      'If you did not request this email, you can ignore it.',
    ].join('\n');
    const html = [
      '<p>IMeal</p>',
      `<p>Your verification code is ${escapeHtml(input.code)}.</p>`,
      `<p>${escapeHtml(sentence)}</p>`,
      '<p>If you did not request this email, you can ignore it.</p>',
    ].join('');
    let result: { rejected?: string[] };
    try {
      result = await transport.sendMail({
        from: { name: config.fromName, address: config.from },
        to: input.destination,
        subject: 'Your IMeal verification code',
        text,
        html,
      });
    } catch (error) {
      throw deliveryError(smtpFailureCategory(error) ?? 'SMTP_PERMANENT');
    }
    if (result.rejected && result.rejected.length > 0) {
      throw deliveryError('SMTP_PERMANENT');
    }
  }
}
