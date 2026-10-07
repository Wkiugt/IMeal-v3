import { type Mock, afterEach, describe, expect, it, vi } from 'vitest';
import {
  GmailSmtpOtpProvider,
  gmailSmtpConfiguration,
  type OtpSmtpTransport,
  type OtpSmtpTransportFactory,
} from './gmail-smtp-otp-provider.js';

const USERNAME = 'otp-sender@company.invalid';
const PASSWORD = 'app-password-not-a-google-password';
const FROM = 'otp-sender@company.invalid';
const DESTINATION = 'employee@company.invalid';
const CODE = '123456';

function smtpEnv(overrides: NodeJS.ProcessEnv = {}): NodeJS.ProcessEnv {
  return {
    NODE_ENV: 'test',
    OTP_SMTP_USERNAME: USERNAME,
    OTP_SMTP_PASSWORD: PASSWORD,
    OTP_SMTP_FROM: FROM,
    OTP_EXPIRY_SECONDS: '600',
    ...overrides,
  };
}

function productionEnv(overrides: NodeJS.ProcessEnv = {}): NodeJS.ProcessEnv {
  return smtpEnv({ NODE_ENV: 'production', ...overrides });
}

function transportDouble(
  result: { accepted?: string[]; rejected?: string[] } | Error = {
    accepted: [DESTINATION],
    rejected: [],
  },
): {
  factory: Mock<OtpSmtpTransportFactory>;
  sendMail: Mock<OtpSmtpTransport['sendMail']>;
} {
  const sendMail = vi.fn<OtpSmtpTransport['sendMail']>(async () => {
    if (result instanceof Error) throw result;
    return result;
  });
  const factory = vi.fn<OtpSmtpTransportFactory>(() => ({ sendMail }));
  return { factory, sendMail };
}

function provider(
  env: NodeJS.ProcessEnv,
  factory: OtpSmtpTransportFactory,
): GmailSmtpOtpProvider {
  return new GmailSmtpOtpProvider(env, factory);
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('GmailSmtpOtpProvider', () => {
  it('does not connect or throw when SMTP settings are absent', () => {
    const factory = vi.fn();

    expect(
      () => new GmailSmtpOtpProvider({ NODE_ENV: 'test' }, factory),
    ).not.toThrow();
    expect(
      () => new GmailSmtpOtpProvider({ NODE_ENV: 'development' }, factory),
    ).not.toThrow();
    expect(factory).not.toHaveBeenCalled();
  });

  it('sends one STARTTLS message and escapes HTML interpolations', async () => {
    const { factory, sendMail } = transportDouble();
    const hostileCode = `1<2>&"'`;
    await provider(smtpEnv(), factory).send({
      destination: DESTINATION,
      code: CODE,
      purpose: 'SESSION_LOGIN',
    });
    await provider(smtpEnv(), factory).send({
      destination: DESTINATION,
      code: hostileCode,
      purpose: 'SESSION_LOGIN',
    });

    expect(factory).toHaveBeenCalledTimes(2);
    const options = factory.mock.calls[0]?.[0];
    expect(options).toMatchObject({
      host: 'smtp.gmail.com',
      port: 587,
      secure: false,
      requireTLS: true,
      auth: { user: USERNAME, pass: PASSWORD },
      tls: { minVersion: 'TLSv1.2', servername: 'smtp.gmail.com' },
    });
    expect(options?.ignoreTLS).not.toBe(true);
    expect(options?.connectionTimeout).toBeGreaterThanOrEqual(10_000);
    expect(options?.connectionTimeout).toBeLessThanOrEqual(20_000);
    expect(options?.greetingTimeout).toBeGreaterThanOrEqual(10_000);
    expect(options?.greetingTimeout).toBeLessThanOrEqual(20_000);
    expect(options?.socketTimeout).toBeGreaterThanOrEqual(10_000);
    expect(options?.socketTimeout).toBeLessThanOrEqual(20_000);
    expect(options?.disableFileAccess).toBe(true);
    expect(options?.disableUrlAccess).toBe(true);
    expect(sendMail).toHaveBeenCalledTimes(2);
    const safeMessage = sendMail.mock.calls[0]?.[0];
    expect(safeMessage?.to).toBe(DESTINATION);
    expect(safeMessage?.from).toEqual({ name: 'IMeal', address: FROM });
    expect(safeMessage?.subject).toBe('Your IMeal verification code');
    expect(safeMessage?.text).toContain('IMeal');
    expect(safeMessage?.text).toContain(`Your verification code is ${CODE}.`);
    expect(safeMessage?.text).toContain('This code expires in 10 minutes.');
    expect(safeMessage?.text).toContain(
      'If you did not request this email, you can ignore it.',
    );
    expect(safeMessage?.text).not.toContain(DESTINATION);
    expect(safeMessage?.html).toContain(CODE);
    expect(safeMessage?.html).toContain('This code expires in 10 minutes.');
    expect(safeMessage?.html).not.toContain(DESTINATION);
    const hostileHtml = sendMail.mock.calls[1]?.[0]?.html ?? '';
    expect(hostileHtml).not.toContain(hostileCode);
    expect(hostileHtml).toContain('1&lt;2&gt;&amp;&quot;&#39;');
  });

  it('uses singular and second-based expiry copy from configuration', async () => {
    const minute = transportDouble();
    await provider(smtpEnv({ OTP_EXPIRY_SECONDS: '60' }), minute.factory).send({
      destination: DESTINATION,
      code: CODE,
      purpose: 'SESSION_LOGIN',
    });
    expect(minute.sendMail.mock.calls[0]?.[0].text).toContain(
      'This code expires in 1 minute.',
    );

    const second = transportDouble();
    await provider(smtpEnv({ OTP_EXPIRY_SECONDS: '1' }), second.factory).send({
      destination: DESTINATION,
      code: CODE,
      purpose: 'SESSION_LOGIN',
    });
    expect(second.sendMail.mock.calls[0]?.[0].text).toContain(
      'This code expires in 1 second.',
    );

    const seconds = transportDouble();
    await provider(smtpEnv({ OTP_EXPIRY_SECONDS: '90' }), seconds.factory).send(
      {
        destination: DESTINATION,
        code: CODE,
        purpose: 'SESSION_LOGIN',
      },
    );
    expect(seconds.sendMail.mock.calls[0]?.[0].text).toContain(
      'This code expires in 90 seconds.',
    );
  });

  it('treats a non-empty rejected list as failure and does not retry', async () => {
    const { factory, sendMail } = transportDouble({
      accepted: [],
      rejected: [DESTINATION],
    });

    await expect(
      provider(smtpEnv(), factory).send({
        destination: DESTINATION,
        code: CODE,
        purpose: 'SESSION_LOGIN',
      }),
    ).rejects.toMatchObject({ providerCode: 'SMTP_PERMANENT' });
    expect(sendMail).toHaveBeenCalledTimes(1);
  });

  it('classifies authentication failures without echoing secrets', async () => {
    const thrown = Object.assign(
      new Error(
        `535 auth failed for ${USERNAME} password ${PASSWORD} code ${CODE}`,
      ),
      { code: 'EAUTH', responseCode: 535 },
    );
    const { factory, sendMail } = transportDouble(thrown);

    const error = await provider(smtpEnv(), factory)
      .send({
        destination: DESTINATION,
        code: CODE,
        purpose: 'SESSION_LOGIN',
      })
      .catch((caught: unknown) => caught);

    expect(error).toMatchObject({ providerCode: 'AUTHENTICATION' });
    expect(String(error)).toBe('Error: SMTP delivery failed: AUTHENTICATION');
    expect(String(error)).not.toContain(PASSWORD);
    expect(String(error)).not.toContain(CODE);
    expect(String(error)).not.toContain(USERNAME);
    expect(sendMail).toHaveBeenCalledTimes(1);
  });

  it.each([
    ['ECONNECTION', 'NETWORK'],
    ['ETIMEDOUT', 'NETWORK'],
    ['ETLS', 'TLS'],
  ] as const)('classifies %s as %s', async (code, category) => {
    const { factory } = transportDouble(
      Object.assign(new Error(`${code} ${PASSWORD} ${CODE}`), { code }),
    );

    await expect(
      provider(smtpEnv(), factory).send({
        destination: DESTINATION,
        code: CODE,
        purpose: 'SESSION_LOGIN',
      }),
    ).rejects.toMatchObject({ providerCode: category });
  });

  it('classifies SMTP 4xx as transient rate limit and other 5xx as permanent', async () => {
    const transient = transportDouble(
      Object.assign(new Error(`450 slow down ${PASSWORD}`), {
        responseCode: 450,
      }),
    );
    await expect(
      provider(smtpEnv(), transient.factory).send({
        destination: DESTINATION,
        code: CODE,
        purpose: 'SESSION_LOGIN',
      }),
    ).rejects.toMatchObject({ providerCode: 'SMTP_RATE_LIMIT' });

    const permanent = transportDouble(
      Object.assign(new Error(`550 mailbox unavailable ${CODE}`), {
        responseCode: 550,
      }),
    );
    await expect(
      provider(smtpEnv(), permanent.factory).send({
        destination: DESTINATION,
        code: CODE,
        purpose: 'SESSION_LOGIN',
      }),
    ).rejects.toMatchObject({ providerCode: 'SMTP_PERMANENT' });
  });

  it('throws configuration without connecting when credentials are missing', async () => {
    const factory = vi.fn();
    const error = await provider({ NODE_ENV: 'development' }, factory)
      .send({
        destination: DESTINATION,
        code: CODE,
        purpose: 'SESSION_LOGIN',
      })
      .catch((caught: unknown) => caught);

    expect(error).toMatchObject({ providerCode: 'CONFIGURATION' });
    expect(String(error)).toBe('Error: SMTP delivery failed: CONFIGURATION');
    expect(factory).not.toHaveBeenCalled();
  });
});

describe('gmailSmtpConfiguration', () => {
  it('defaults host, port, TLS, from-name, and non-production expiry', () => {
    expect(gmailSmtpConfiguration({ NODE_ENV: 'test' })).toMatchObject({
      host: 'smtp.gmail.com',
      port: 587,
      requireTls: true,
      username: null,
      password: null,
      from: null,
      fromName: 'IMeal',
      expirySeconds: 600,
    });
  });

  it('accepts a complete production configuration with default or explicit Gmail endpoint', () => {
    expect(() => gmailSmtpConfiguration(productionEnv())).not.toThrow();
    expect(() =>
      gmailSmtpConfiguration(
        productionEnv({
          OTP_SMTP_HOST: 'SMTP.GMAIL.COM',
          OTP_SMTP_PORT: '587',
        }),
      ),
    ).not.toThrow();
  });

  it.each(['OTP_SMTP_USERNAME', 'OTP_SMTP_PASSWORD', 'OTP_SMTP_FROM'])(
    'names %s when production omits it',
    (name) => {
      const env = productionEnv();
      delete env[name];

      expect(() => gmailSmtpConfiguration(env)).toThrow(name);
    },
  );

  it('rejects an invalid production port, disabled TLS, and a non-Gmail host', () => {
    expect(() =>
      gmailSmtpConfiguration(productionEnv({ OTP_SMTP_PORT: '465' })),
    ).toThrow('OTP_SMTP_PORT');
    expect(() =>
      gmailSmtpConfiguration(productionEnv({ OTP_SMTP_PORT: 'nope' })),
    ).toThrow('OTP_SMTP_PORT');
    expect(() =>
      gmailSmtpConfiguration({
        NODE_ENV: 'development',
        OTP_SMTP_REQUIRE_TLS: 'false',
      }),
    ).toThrow('OTP_SMTP_REQUIRE_TLS');
    expect(() =>
      gmailSmtpConfiguration(
        productionEnv({ OTP_SMTP_HOST: 'smtp-relay.gmail.com' }),
      ),
    ).toThrow('OTP_SMTP_HOST');
  });

  it('rejects a placeholder password without revealing the placeholder', () => {
    let error: unknown;
    try {
      gmailSmtpConfiguration(
        productionEnv({ OTP_SMTP_PASSWORD: 'CHANGE_ME_LOCAL' }),
      );
    } catch (caught) {
      error = caught;
    }

    expect(String(error)).toContain('OTP_SMTP_PASSWORD');
    expect(String(error)).not.toContain('CHANGE_ME_LOCAL');
  });

  it('requires a positive OTP expiry in production and rejects header injection', () => {
    const env = productionEnv();
    delete env.OTP_EXPIRY_SECONDS;
    expect(() => gmailSmtpConfiguration(env)).toThrow('OTP_EXPIRY_SECONDS');
    expect(() =>
      gmailSmtpConfiguration(
        productionEnv({ OTP_SMTP_FROM_NAME: 'IMeal\r\nBcc: attacker' }),
      ),
    ).toThrow('OTP_SMTP_FROM_NAME');
    expect(() =>
      gmailSmtpConfiguration(
        productionEnv({ OTP_SMTP_FROM: 'IMeal <otp@company.invalid>' }),
      ),
    ).toThrow('OTP_SMTP_FROM');
  });
});
