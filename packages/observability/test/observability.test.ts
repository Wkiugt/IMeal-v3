import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  JsonStructuredLogger,
  REQUEST_ID_PATTERN,
  readMigrationEvidence,
  resolveRequestId,
  sanitizeLogText,
} from '../src/index.js';

const temporaryDirectories: string[] = [];

function temporaryFile(contents: string): string {
  const directory = mkdtempSync(join(tmpdir(), 'imeal-observability-'));
  temporaryDirectories.push(directory);
  const file = join(directory, 'migration-gate.json');
  writeFileSync(file, contents, 'utf8');
  return file;
}

function temporaryMissingFile(): string {
  const directory = mkdtempSync(join(tmpdir(), 'imeal-observability-missing-'));
  temporaryDirectories.push(directory);
  return join(directory, 'migration-gate.json');
}

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

describe('request IDs', () => {
  it('preserves a valid UUIDv4 request ID', () => {
    expect(resolveRequestId('550e8400-e29b-41d4-a716-446655440000')).toBe(
      '550e8400-e29b-41d4-a716-446655440000',
    );
  });

  it('replaces malformed or missing request IDs with UUIDv4 values', () => {
    expect(resolveRequestId('attacker-value')).toMatch(REQUEST_ID_PATTERN);
    expect(resolveRequestId(undefined)).toMatch(REQUEST_ID_PATTERN);
  });
});

describe('JSON structured logging', () => {
  it('serializes required fields and redacts sensitive values', () => {
    const lines: string[] = [];
    const logger = new JsonStructuredLogger('api', 'r1', (line) =>
      lines.push(line),
    );
    logger.info('http.request', {
      service: 'api',
      release: 'r1',
      requestId: '550e8400-e29b-41d4-a716-446655440000',
      method: 'GET',
      path: '/api/health',
      route: '/api/health',
      statusCode: 200,
      durationMs: 4,
      bearer: 'Bearer opaque-token',
      otp: '123456',
      payload: 'ExpoPushToken[secret]',
      coordinates: '10.7769,106.7009',
      databaseUrl: 'postgresql://user:password@db.internal/imeal',
      body: 'raw-body-secret',
      query: 'raw-query-secret',
    });

    expect(lines).toHaveLength(1);
    const output = JSON.parse(lines[0]);
    expect(output).toMatchObject({
      level: 'info',
      service: 'api',
      method: 'GET',
      path: '/api/health',
      route: '/api/health',
      statusCode: 200,
      durationMs: 4,
    });
    expect(output.timestamp).toEqual(expect.any(String));
    expect(lines[0]).not.toContain('opaque-token');
    expect(lines[0]).not.toContain('123456');
    expect(lines[0]).not.toContain('ExpoPushToken[secret]');
    expect(lines[0]).not.toContain('10.7769,106.7009');
    expect(lines[0]).not.toContain(
      'postgresql://user:password@db.internal/imeal',
    );
    expect(lines[0]).not.toContain('raw-body-secret');
    expect(lines[0]).not.toContain('raw-query-secret');
  });
  it('exports bounded redaction for arbitrary log text', () => {
    expect(sanitizeLogText('authorization=Bearer opaque-token')).not.toContain(
      'opaque-token',
    );
    expect(sanitizeLogText('a'.repeat(20), 8)).toBe('aaaaaaaa');
  });

  it('redacts dotted authorization properties', () => {
    const lines: string[] = [];
    const logger = new JsonStructuredLogger('api', 'r1', (line) =>
      lines.push(line),
    );

    logger.info('security.headers', {
      service: 'api',
      release: 'r1',
      message:
        'safe text headers.authorization=Bearer dotted-secret req.headers.authorization: "Bearer quoted-secret"',
    });

    const output = JSON.parse(lines[0]);
    expect(output.message).toContain('safe text');
    expect(output.message).toContain('[REDACTED]');
    expect(output.message).not.toContain('dotted-secret');
    expect(output.message).not.toContain('quoted-secret');
  });

  it('redacts Set-Cookie header values', () => {
    const lines: string[] = [];
    const logger = new JsonStructuredLogger('api', 'r1', (line) =>
      lines.push(line),
    );

    logger.info('security.headers', {
      service: 'api',
      release: 'r1',
      message:
        'safe text Set-Cookie: session=secret-cookie; Path=/; HttpOnly set-cookie: refresh_token=secret-refresh; Secure',
    });

    const output = JSON.parse(lines[0]);
    expect(output.message).toContain('safe text');
    expect(output.message).toContain('Set-Cookie: [REDACTED]');
    expect(output.message).toContain('set-cookie: [REDACTED]');
    expect(output.message).not.toContain('secret-cookie');
    expect(output.message).not.toContain('secret-refresh');
  });
  it('redacts Set-Cookie values without consuming following headers', () => {
    const lines: string[] = [];
    const logger = new JsonStructuredLogger('api', 'r1', (line) =>
      lines.push(line),
    );

    logger.info('security.headers', {
      service: 'api',
      release: 'r1',
      message: 'Set-Cookie: session=line-secret; Path=/\nX-Safe: ok',
    });

    const output = JSON.parse(lines[0]);
    expect(output.message).toContain('Set-Cookie: [REDACTED]');
    expect(output.message).toContain('\nX-Safe: ok');
    expect(output.message).not.toContain('line-secret');
  });
  it('redacts structured payloads in stack diagnostics', () => {
    const lines: string[] = [];
    const logger = new JsonStructuredLogger('api', 'r1', (line) =>
      lines.push(line),
    );

    logger.error('http.exception', {
      service: 'api',
      release: 'r1',
      stack: `Error: response={"response-secret":"response-secret"}
headers={"header-secret":"header-secret"}
body={"body-secret":"body-secret"}
response=[{"array-secret":"array-secret"}]
at usefulHandler (diagnostics.ts:10:2)`,
    });

    const output = JSON.parse(lines[0]);
    expect(output.stack).toContain('usefulHandler');
    expect(lines[0]).not.toContain('response-secret');
    expect(lines[0]).not.toContain('header-secret');
    expect(lines[0]).not.toContain('body-secret');
    expect(lines[0]).not.toContain('array-secret');
  });



  it('serializes error fields and sanitizes server diagnostics', () => {
    const lines: string[] = [];
    const logger = new JsonStructuredLogger('api', 'r1', (line) =>
      lines.push(line),
    );

    logger.error('http.exception', {
      service: 'api',
      release: 'r1',
      event: 'http.exception',
      errorClass: 'SERVER_ERROR',
      method: 'GET',
      path: '/health/ready?token=opaque-token',
      route: '/health/ready?otp=123456',
      statusCode: 500,
      errorCode: 'INTERNAL_SERVER_ERROR',
      requestId: '550e8400-e29b-41d4-a716-446655440000',
      message:
        'databaseUrl=postgresql://user:secret@db/internal authorization=Bearer opaque-token cookie=session=opaque-cookie otp=123456 sessionToken=session-secret accessToken=access-secret refreshToken=refresh-secret smtpPassword=smtp-secret providerSecret=provider-secret qrToken=qr-secret body=opaque-body',
      stack:
        'Error: databaseUrl=postgresql://user:secret@db/internal\\n    at usefulHandler (health.ts:10:2)',
    });

    const output = JSON.parse(lines[0] ?? '{}') as Record<string, unknown>;
    expect(output).toMatchObject({
      errorClass: 'SERVER_ERROR',
      method: 'GET',
      path: '/health/ready',
      route: '/health/ready',
      statusCode: 500,
      errorCode: 'INTERNAL_SERVER_ERROR',
    });
    expect(output.message).toContain('databaseUrl=[REDACTED]');
    expect(output.stack).toContain('usefulHandler');
    expect(lines[0]).not.toContain('secret@db');
    expect(lines[0]).not.toContain('session-secret');
    expect(lines[0]).not.toContain('access-secret');
    expect(lines[0]).not.toContain('refresh-secret');
    expect(lines[0]).not.toContain('smtp-secret');
    expect(lines[0]).not.toContain('provider-secret');
    expect(lines[0]).not.toContain('qr-secret');
    expect(lines[0]).not.toContain('opaque-token');
    expect(lines[0]).not.toContain('opaque-cookie');
    expect(lines[0]).not.toContain('123456');
    expect(lines[0]).not.toContain('opaque-body');
  });
  it('redacts nonnumeric credential labels and serialized response fields', () => {
    const lines: string[] = [];
    const logger = new JsonStructuredLogger('api', 'r1', (line) =>
      lines.push(line),
    );

    logger.error('http.exception', {
      service: 'api',
      release: 'r1',
      event: 'http.exception',
      errorClass: 'SERVER_ERROR',
      errorCode: 'OTP_123456',
      providerCode: 'HTTP_654321',
      message:
        'otp=otp-sentinel session token=session-sentinel session  token=session-double-space access token=access-sentinel access   token=access-double-space refresh token=refresh-sentinel refresh  token=refresh-double-space smtp user=smtp-user-sentinel smtp   user=smtp-double-space request body={"field":"request-sentinel"} response={"headers":{"x-internal":"response-sentinel"}} headers={"x-custom":"header-sentinel"}',
      stack: `Error: useful stack
response={
  "headers": {
    "x-internal": "multiline-response-sentinel"
  }
}
headers={
  "x-custom": "multiline-header-sentinel"
}
body={
  "field": "multiline-body-sentinel"
}
    at usefulHandler (diagnostics.ts:10:2)
response=[
  {
    "nested": [
      {
        "x-internal": "multiline-array-response-sentinel",
        "escaped": "escaped \\"multiline-array-escaped-sentinel\\""
      }
    ]
  }
]
headers=[
  {
    "x-custom": "multiline-array-header-sentinel"
  }
]`,
    });
    expect(lines[0]).not.toContain('multiline-response-sentinel');
    expect(lines[0]).not.toContain('multiline-header-sentinel');
    expect(lines[0]).not.toContain('multiline-body-sentinel');
    expect(lines[0]).toContain('usefulHandler');
    expect(lines[0]).not.toContain('multiline-array-response-sentinel');
    expect(lines[0]).not.toContain('multiline-array-header-sentinel');
    expect(lines[0]).not.toContain('multiline-array-escaped-sentinel');

    expect(lines[0]).not.toContain('otp-sentinel');
    expect(lines[0]).not.toContain('session-sentinel');
    expect(lines[0]).not.toContain('access-sentinel');
    expect(lines[0]).not.toContain('refresh-sentinel');
    expect(lines[0]).not.toContain('session-double-space');
    expect(lines[0]).not.toContain('access-double-space');
    expect(lines[0]).not.toContain('refresh-double-space');
    expect(lines[0]).not.toContain('smtp-double-space');
    expect(lines[0]).not.toContain('smtp-user-sentinel');
    expect(lines[0]).not.toContain('request-sentinel');
    expect(lines[0]).not.toContain('response-sentinel');
    expect(lines[0]).not.toContain('header-sentinel');
    expect(JSON.parse(lines[0] ?? '{}')).toMatchObject({
      errorCode: 'OTP_123456',
      providerCode: 'HTTP_654321',
    });
  });
  it('redacts credential query values in error fields', () => {
    const lines: string[] = [];
    const logger = new JsonStructuredLogger('api', 'r1', (line) =>
      lines.push(line),
    );

    logger.error('http.exception', {
      service: 'api',
      release: 'r1',
      event: 'http.exception',
      errorClass: 'SERVER_ERROR',
      errorCode:
        'https://service.test/path?refresh_token=raw-code-token&trace=stable-code',
      providerCode: 'HTTP_654321',
      message:
        'request failed https://service.test/path?token=raw-message-token&trace=stable-message',
      stack:
        'Error: https://service.test/path?access_token=raw-stack-token&trace=stable-stack',
    });

    const output = JSON.parse(lines[0] ?? '{}') as Record<string, unknown>;
    expect(output.errorCode).toBe(
      'https://service.test/path?refresh_token=[REDACTED]&trace=stable-code',
    );
    expect(output.providerCode).toBe('HTTP_654321');
    expect(output.message).toContain(
      '?token=[REDACTED]&trace=stable-message',
    );
    expect(output.stack).toContain(
      '?access_token=[REDACTED]&trace=stable-stack',
    );
    expect(lines[0]).not.toContain('raw-code-token');
    expect(lines[0]).not.toContain('raw-message-token');
    expect(lines[0]).not.toContain('raw-stack-token');
  });

  it('redacts provider and QR secrets embedded in safe string fields', () => {
    const lines: string[] = [];
    const logger = new JsonStructuredLogger('api', 'r1', (line) =>
      lines.push(line),
    );

    logger.error('qr://pickup?signature=qr-secret', {
      service: 'api',
      release: 'r1',
      providerCode: 'apiKey=provider-secret',
    });

    const output = JSON.parse(lines[0]);
    expect(output.event).toBe('qr://pickup?signature=[REDACTED]');
    expect(output.providerCode).toBe('apiKey=[REDACTED]');
    expect(lines[0]).not.toContain('qr-secret');
    expect(lines[0]).not.toContain('provider-secret');
  });

  it('keeps a constrained provider name and redacts anything else', () => {
    const lines: string[] = [];
    const logger = new JsonStructuredLogger('worker', 'r1', (line) =>
      lines.push(line),
    );

    logger.info('worker.otp.sent', {
      service: 'worker',
      release: 'r1',
      provider: 'gmail-smtp',
    });
    logger.info('worker.otp.sent', {
      service: 'worker',
      release: 'r1',
      provider: 'app-password-not-a-google-password',
    });

    expect(JSON.parse(lines[0]).provider).toBe('gmail-smtp');
    expect(JSON.parse(lines[1]).provider).toBe('[REDACTED]');
    expect(lines[1]).not.toContain('app-password-not-a-google-password');
  });

  it('omits unknown and sensitive field names from structured output', () => {
    const lines: string[] = [];
    const logger = new JsonStructuredLogger('api', 'r1', (line) =>
      lines.push(line),
    );

    logger.info('security.test', {
      service: 'api',
      release: 'r1',
      tokenId: 'opaque-token-id',
      secretId: 'opaque-secret-id',
      passwordId: 'opaque-password-id',
      attackerControlled: 'attacker-value',
      'Bearer opaque-key-name': 'attacker-value',
      'sessionToken=opaque-key-name': 'attacker-value',
      count: 4,
    });

    const output = JSON.parse(lines[0]);
    expect(output).toMatchObject({ count: 4 });
    expect(output).not.toHaveProperty('tokenId');
    expect(output).not.toHaveProperty('secretId');
    expect(output).not.toHaveProperty('passwordId');
    expect(output).not.toHaveProperty('attackerControlled');
    expect(output).not.toHaveProperty('Bearer opaque-key-name');
    expect(output).not.toHaveProperty('sessionToken=opaque-key-name');
    expect(lines[0]).not.toContain('opaque-token-id');
    expect(lines[0]).not.toContain('opaque-key-name');
  });

  it.each([
    ['sessionToken=opaque-session-token', 'opaque-session-token'],
    ['session_id=opaque-session-id', 'opaque-session-id'],
    ['clientSecret=provider-secret', 'provider-secret'],
    ['provider_secret=provider-secret', 'provider-secret'],
    ['api-key=provider-api-key', 'provider-api-key'],
    ['imeal:v2:presenter:user-1:opaque-signed-qr', 'opaque-signed-qr'],
    ['sig=opaque-signature', 'opaque-signature'],
    ['qr=opaque-qr-payload', 'opaque-qr-payload'],
    [
      'provider payload {"body":"opaque-provider-payload"}',
      'opaque-provider-payload',
    ],
    ['lat=10.7769; lon=106.7009', '10.7769'],
    ['latitude: 10.7769 longitude: 106.7009', '106.7009'],
  ])('redacts sensitive format %s', (event, secret) => {
    const lines: string[] = [];
    const logger = new JsonStructuredLogger('api', 'r1', (line) =>
      lines.push(line),
    );

    logger.error(event, {
      service: 'api',
      release: 'r1',
      providerCode: event,
    });

    expect(lines[0]).not.toContain(secret);
  });

  it('preserves six-digit operational identifiers in approved fields', () => {
    const lines: string[] = [];
    const logger = new JsonStructuredLogger('worker', 'r1', (line) =>
      lines.push(line),
    );

    logger.info('/v1/items/123456', {
      service: 'worker',
      release: 'r1',
      route: '/v1/items/123456',
      jobName: 'run-123456',
      jobRunId: 'job-123456',
      errorCode: 'PROVIDER_123456',
      providerCode: 'HTTP_123456',
    });

    const output = JSON.parse(lines[0]);
    expect(output.event).toBe('/v1/items/123456');
    expect(output.route).toBe('/v1/items/123456');
    expect(output.jobName).toBe('run-123456');
    expect(output.jobRunId).toBe('job-123456');
    expect(output.errorCode).toBe('PROVIDER_123456');
    expect(output.providerCode).toBe('HTTP_123456');
  });

  it('redacts labeled OTP values without scrubbing operational digits', () => {
    const lines: string[] = [];
    const logger = new JsonStructuredLogger('api', 'r1', (line) =>
      lines.push(line),
    );

    logger.warn('otp=123456 verification code: 654321', {
      service: 'api',
      release: 'r1',
      errorCode: 'OTP_123456',
      providerCode: 'HTTP_654321',
    });

    const output = JSON.parse(lines[0]);
    expect(output.event).toBe('otp=[REDACTED] verification code: [REDACTED]');
    expect(output.errorCode).toBe('OTP_123456');
    expect(output.providerCode).toBe('HTTP_654321');
  });

  it('writes one line for each log level', () => {
    const lines: string[] = [];
    const logger = new JsonStructuredLogger('worker', 'r1', (line) =>
      lines.push(line),
    );
    const fields = {
      service: 'worker' as const,
      release: 'r1',
      event: 'job.loop',
    };

    logger.debug(fields.event, fields);
    logger.info(fields.event, fields);
    logger.warn(fields.event, fields);
    logger.error(fields.event, fields);

    expect(lines.map((line) => JSON.parse(line).level)).toEqual([
      'debug',
      'info',
      'warn',
      'error',
    ]);
  });

  it('includes safe message, context, host, and port', () => {
    const lines: string[] = [];
    const logger = new JsonStructuredLogger('api', 'r1', (line) =>
      lines.push(line),
    );

    logger.info('api.started', {
      service: 'api',
      release: 'r1',
      message: 'API listening on 0.0.0.0:3000',
      context: 'NestApplication',
      host: '0.0.0.0',
      port: 3000,
    });
    logger.info('api.started', {
      service: 'api',
      release: 'r1',
      host: '0.0.0.0',
      port: 0,
    });
    logger.info('api.started', {
      service: 'api',
      release: 'r1',
      host: '0.0.0.0',
      port: 65535,
    });

    expect(JSON.parse(lines[0])).toMatchObject({
      service: 'api',
      release: 'r1',
      event: 'api.started',
      message: 'API listening on 0.0.0.0:3000',
      context: 'NestApplication',
      host: '0.0.0.0',
      port: 3000,
    });
    expect(JSON.parse(lines[1]).port).toBe(0);
    expect(JSON.parse(lines[2]).port).toBe(65535);
  });

  it('redacts passwords, bearer tokens, OTP codes, and payload labels in messages', () => {
    const lines: string[] = [];
    const logger = new JsonStructuredLogger('api', 'r1', (line) =>
      lines.push(line),
    );
    const password = 'super-secret-password';
    const bearer = 'opaque-bearer-token';
    const otp = '654321';
    const body = 'opaque-body-value';

    logger.info('nestjs.log', {
      service: 'api',
      release: 'r1',
      message: `startup password=${password} Bearer ${bearer} otp=${otp} body=${body}`,
    });

    const output = JSON.parse(lines[0]);
    expect(output.message).toContain('startup');
    expect(output.message).toContain('[REDACTED]');
    expect(output.message).not.toContain(password);
    expect(output.message).not.toContain(bearer);
    expect(output.message).not.toContain(otp);
    expect(output.message).not.toContain(body);
    expect(lines[0]).not.toContain(password);
    expect(lines[0]).not.toContain(bearer);
    expect(lines[0]).not.toContain(otp);
    expect(lines[0]).not.toContain(body);
  });

  it('does not echo invalid host, context, or port values', () => {
    const lines: string[] = [];
    const logger = new JsonStructuredLogger('api', 'r1', (line) =>
      lines.push(line),
    );

    logger.info('nestjs.log', {
      service: 'api',
      release: 'r1',
      host: 'user:secretpass@0.0.0.0',
      context: 'Error: boom\n    at Foo.bar (file.js:1:2)',
      port: 70000,
    });
    logger.info('nestjs.log', {
      service: 'api',
      release: 'r1',
      host: 'http://0.0.0.0/hidden-path',
      context: 'not a context',
      port: -1,
    });
    logger.info('nestjs.log', {
      service: 'api',
      release: 'r1',
      host: '0.0.0.0:3000',
      context: '123BadContext',
      port: 1.5,
    });
    logger.info('nestjs.log', {
      service: 'api',
      release: 'r1',
      host: '0.0.0.0 evil-host',
      context: 'A'.repeat(65),
      port: 'secret-port' as never,
    });
    logger.info('nestjs.log', {
      service: 'api',
      release: 'r1',
      host: 'localhost',
      port: '3000' as never,
    });
    logger.info('nestjs.log', {
      service: 'api',
      release: 'r1',
      host: 'secret0.0.0.0',
      port: 70000,
    });
    logger.info('nestjs.log', {
      service: 'api',
      release: 'r1',
      host: 'password.0.0.0.0',
      port: -1,
    });

    const serialized = lines.join('\n');
    expect(serialized).not.toContain('secret0.0.0.0');
    expect(serialized).not.toContain('password.0.0.0.0');
    expect(serialized).not.toContain('secretpass');
    expect(serialized).not.toContain('file.js');
    expect(serialized).not.toContain('70000');
    expect(serialized).not.toContain('hidden-path');
    expect(serialized).not.toContain('not a context');
    expect(serialized).not.toContain('123BadContext');
    expect(serialized).not.toContain('evil-host');
    expect(serialized).not.toContain('secret-port');
    expect(serialized).not.toContain('A'.repeat(65));
    expect(serialized).not.toContain('localhost');
    expect(serialized).not.toContain('0.0.0.0:3000');

    for (const line of lines) {
      const output = JSON.parse(line);
      expect(output.host).toBe('[REDACTED]');
      expect(output.port).toBe('[REDACTED]');
    }
    expect(JSON.parse(lines[0]).context).toBe('[REDACTED]');
    expect(JSON.parse(lines[1]).context).toBe('[REDACTED]');
    expect(JSON.parse(lines[2]).context).toBe('[REDACTED]');
    expect(JSON.parse(lines[3]).context).toBe('[REDACTED]');
  });

  it('truncates free-form messages and does not dump non-string messages', () => {
    const lines: string[] = [];
    const logger = new JsonStructuredLogger('api', 'r1', (line) =>
      lines.push(line),
    );
    const secret = 'object-secret-value';

    logger.info('nestjs.log', {
      service: 'api',
      release: 'r1',
      message: 'm'.repeat(1100),
    });
    logger.info('nestjs.log', {
      service: 'api',
      release: 'r1',
      message: { password: secret } as never,
    });

    expect(JSON.parse(lines[0]).message).toBe('m'.repeat(1024));
    expect(JSON.parse(lines[1]).message).toBe('[REDACTED]');
    expect(lines[1]).not.toContain(secret);
  });
});

describe('migration evidence', () => {
  it('accepts only a matching migration evidence marker', () => {
    const file = temporaryFile(
      JSON.stringify({
        release: 'release-1',
        migration: '20260928000000_phase0_domain_correctness',
        targetSchema: 'staging-schema',
        approvalId: 'approval-1',
        completedAt: '2026-09-28T12:00:00.000Z',
      }),
    );

    const result = readMigrationEvidence(file, 'release-1', 'staging-schema');

    expect(result).toEqual({
      ok: true,
      evidence: {
        release: 'release-1',
        migration: '20260928000000_phase0_domain_correctness',
        targetSchema: 'staging-schema',
        approvalId: 'approval-1',
        completedAt: '2026-09-28T12:00:00.000Z',
      },
    });
    expect(JSON.parse(readFileSync(file, 'utf8'))).toHaveProperty(
      'approvalId',
      'approval-1',
    );
  });
  it('rejects an oversized migration marker before parsing', () => {
    const file = temporaryFile('x'.repeat(70_000));

    expect(readMigrationEvidence(file, 'release-1', 'staging-schema')).toEqual({
      ok: false,
      reason: 'marker_too_large',
    });
  });

  it.each([
    ['missing marker', undefined, 'marker_unavailable'],
    ['malformed JSON', '{not-json', 'marker_invalid'],
    [
      'stale release',
      JSON.stringify({
        release: 'release-0',
        migration: 'migration-1',
        targetSchema: 'staging-schema',
        approvalId: 'approval-1',
        completedAt: '2026-09-28T12:00:00.000Z',
      }),
      'release_mismatch',
    ],
    [
      'wrong target',
      JSON.stringify({
        release: 'release-1',
        migration: 'migration-1',
        targetSchema: 'production-schema',
        approvalId: 'approval-1',
        completedAt: '2026-09-28T12:00:00.000Z',
      }),
      'target_mismatch',
    ],
    [
      'missing required field',
      JSON.stringify({
        release: 'release-1',
        migration: 'migration-1',
        targetSchema: 'staging-schema',
        completedAt: '2026-09-28T12:00:00.000Z',
      }),
      'marker_invalid',
    ],
    [
      'non-canonical timestamp',
      JSON.stringify({
        release: 'release-1',
        migration: 'migration-1',
        targetSchema: 'staging-schema',
        approvalId: 'approval-1',
        completedAt: '2026-09-28T12:00:00Z',
      }),
      'marker_invalid',
    ],
    [
      'unexpected marker field',
      JSON.stringify({
        release: 'release-1',
        migration: 'migration-1',
        targetSchema: 'staging-schema',
        approvalId: 'approval-1',
        completedAt: '2026-09-28T12:00:00.000Z',
        secret: 'must-not-be-accepted',
      }),
      'marker_invalid',
    ],
  ])('rejects %s markers safely', (_reason, contents, expectedReason) => {
    const file =
      contents === undefined ? temporaryMissingFile() : temporaryFile(contents);

    const result = readMigrationEvidence(file, 'release-1', 'staging-schema');

    expect(result).toEqual({ ok: false, reason: expectedReason });
    expect(JSON.stringify(result)).not.toContain('release-0');
    expect(JSON.stringify(result)).not.toContain('production-schema');
    expect(JSON.stringify(result)).not.toContain('must-not-be-accepted');
  });

  it('rejects missing expected identities safely', () => {
    const file = temporaryFile(
      JSON.stringify({
        release: 'release-1',
        migration: 'migration-1',
        targetSchema: 'staging-schema',
        approvalId: 'approval-1',
        completedAt: '2026-09-28T12:00:00.000Z',
      }),
    );

    expect(readMigrationEvidence(file, '', 'staging-schema')).toEqual({
      ok: false,
      reason: 'expected_identity_missing',
    });
    expect(readMigrationEvidence(file, 'release-1', '')).toEqual({
      ok: false,
      reason: 'expected_identity_missing',
    });
  });
});
