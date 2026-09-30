export interface AuthoritativeSourceWorkloadIdentityConfig {
  /** Deployment-owned identity provider name; credential values stay outside the repository. */
  readonly provider: string;
  readonly credentialName: string;
}

export interface AuthoritativeSourceMutualTlsConfig {
  /** Deployment-owned certificate/key names consumed by the injected fetch implementation. */
  readonly clientCertificateName: string;
  readonly clientKeyName: string;
  readonly caCertificateName?: string;
}

export interface AuthoritativeSourceEndpointConfig {
  /** Protected endpoint value resolved out of band; never embedded in a source reference. */
  readonly endpoint: string | null;
  /** Protected access value resolved out of band; it is never included in an error. */
  readonly accessToken?: string;
  /** Resolver attestation that the source is on the approved private network. */
  readonly privateSource: true;
  /** Optional deployment-owned workload identity passed to the injected request decorator. */
  readonly workloadIdentity?: AuthoritativeSourceWorkloadIdentityConfig;
  /** Optional deployment-owned mTLS names passed to the injected request decorator. */
  readonly mutualTls?: AuthoritativeSourceMutualTlsConfig;
}

export interface AuthoritativeSourceRegistryConfig
  extends Omit<AuthoritativeSourceEndpointConfig, 'endpoint'> {
  /** Protected source registry/feed URL; source references are sent only in the JSON body. */
  readonly registryUrl: string | null;
}

export interface AuthoritativeSourceResolver {
  resolve(reference: string):
    | AuthoritativeSourceEndpointConfig
    | undefined
    | Promise<AuthoritativeSourceEndpointConfig | undefined>;
}

export interface AuthoritativeSourceRequest {
  readonly observedAt: string;
}

export type AuthoritativeSourceSchema<T> = (value: unknown) => value is T;

export interface AuthoritativeSourceTransport {
  requestJson<T>(
    reference: string,
    request: AuthoritativeSourceRequest,
    schema: AuthoritativeSourceSchema<T>,
  ): Promise<T | undefined>;
}

export interface AuthoritativeSourceTransportOptions {
  readonly fetchImpl?: AuthoritativeFetch;
  readonly timeoutMs?: number;
  /** Decorates requests for injected workload identity/mTLS without exposing credentials here. */
  readonly decorateRequest?: AuthoritativeSourceRequestDecorator;
}

export type AuthoritativeFetch = (
  input: string,
  init?: RequestInit,
) => Promise<Response>;

export type AuthoritativeSourceRequestDecorator = (
  endpoint: AuthoritativeSourceEndpointConfig,
  init: RequestInit,
) => RequestInit;

const DEFAULT_TIMEOUT_MS = 5_000;
const MAX_TIMEOUT_MS = 120_000;
const SOURCE_REFERENCE_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;

type AuthoritativeSourceResolverInput =
  | Readonly<Record<string, AuthoritativeSourceEndpointConfig>>
  | AuthoritativeSourceRegistryConfig;

/**
 * Creates a resolver backed by protected deployment configuration. The map keys
 * are opaque source references; endpoint and access values remain separate.
 * A registry config uses one protected feed URL for every source reference.
 */
export function createAuthoritativeSourceResolver(
  input: AuthoritativeSourceResolverInput,
): AuthoritativeSourceResolver {
  if (isRegistryConfig(input)) {
    const registryConfig = input;
    return {
      resolve(reference: string): AuthoritativeSourceEndpointConfig | undefined {
        if (!SOURCE_REFERENCE_PATTERN.test(reference)) return undefined;
        return {
          endpoint: registryConfig.registryUrl,
          accessToken: registryConfig.accessToken,
          privateSource: registryConfig.privateSource,
          workloadIdentity: registryConfig.workloadIdentity,
          mutualTls: registryConfig.mutualTls,
        };
      },
    };
  }
  const entries = input;
  return {
    resolve(reference: string): AuthoritativeSourceEndpointConfig | undefined {
      if (!SOURCE_REFERENCE_PATTERN.test(reference)) return undefined;
      return entries[reference];
    },
  };
}

export function createAuthoritativeSourceTransport(
  resolver: AuthoritativeSourceResolver | undefined,
  options: AuthoritativeSourceTransportOptions = {},
): AuthoritativeSourceTransport {
  const fetchImpl =
    options.fetchImpl ??
    (typeof globalThis.fetch === 'function'
      ? globalThis.fetch.bind(globalThis)
      : undefined);
  const timeoutMs = boundedTimeout(options.timeoutMs);

  return {
    async requestJson<T>(
      reference: string,
      request: AuthoritativeSourceRequest,
      schema: AuthoritativeSourceSchema<T>,
    ): Promise<T | undefined> {
      if (!resolver || !fetchImpl || !SOURCE_REFERENCE_PATTERN.test(reference)) return undefined;
      if (!isCanonicalObservedAt(request.observedAt)) return undefined;

      let endpoint: AuthoritativeSourceEndpointConfig | undefined;
      try {
        endpoint = await resolver.resolve(reference);
      } catch {
        return undefined;
      }
      if (!endpoint || !isApprovedEndpoint(endpoint)) return undefined;

      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);
      try {
        const requestInit: RequestInit = {
          method: 'POST',
          headers: {
            Accept: 'application/json',
            'Content-Type': 'application/json',
            ...(endpoint.accessToken
              ? { Authorization: `Bearer ${endpoint.accessToken}` }
              : {}),
          },
          body: JSON.stringify({ reference, observedAt: request.observedAt }),
          signal: controller.signal,
        };
        const response = await fetchImpl(
          endpoint.endpoint as string,
          options.decorateRequest?.(endpoint, requestInit) ?? requestInit,
        );
        if (
          !response.ok ||
          !Number.isInteger(response.status) ||
          response.status < 200 ||
          response.status >= 300
        ) {
          return undefined;
        }
        const contentType = response.headers?.get?.('content-type');
        if (contentType && !/\bapplication\/json\b/i.test(contentType)) return undefined;
        const payload: unknown = await response.json();
        return schema(payload) ? payload : undefined;
      } catch {
        // Deliberately redacted and fail-closed: callers receive no source data.
        return undefined;
      } finally {
        clearTimeout(timer);
      }
    },
  };
}

function boundedTimeout(value: number | undefined): number {
  if (!Number.isFinite(value)) return DEFAULT_TIMEOUT_MS;
  return Math.min(MAX_TIMEOUT_MS, Math.max(1, Math.floor(value as number)));
}

function isCanonicalObservedAt(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    Number.isFinite(Date.parse(value)) &&
    new Date(value).toISOString() === value
  );
}

function isApprovedEndpoint(
  config: AuthoritativeSourceEndpointConfig,
): boolean {
  if (config.privateSource !== true || typeof config.endpoint !== 'string') return false;
  let parsed: URL;
  try {
    parsed = new URL(config.endpoint);
  } catch {
    return false;
  }
  if (
    parsed.protocol !== 'https:' ||
    parsed.username.length > 0 ||
    parsed.password.length > 0 ||
    parsed.search.length > 0 ||
    parsed.hash.length > 0 ||
    parsed.hostname.length === 0
  ) {
    return false;
  }
  if (config.accessToken !== undefined && typeof config.accessToken !== 'string') {
    return false;
  }
  return !isPublicIpLiteral(parsed.hostname);
}

function isPublicIpLiteral(hostname: string): boolean {
  const ipv4 = hostname.match(/^(\d+)\.(\d+)\.(\d+)\.(\d+)$/);
  if (ipv4) {
    const octets = ipv4.slice(1).map(Number);
    if (octets.some((octet) => octet > 255)) return true;
    const [first, second] = octets;
    return !(
      first === 10 ||
      first === 127 ||
      (first === 172 && second >= 16 && second <= 31) ||
      (first === 192 && second === 168) ||
      (first === 169 && second === 254)
    );
  }
  if (hostname.includes(':')) {
    const normalized = hostname.toLowerCase();
    return !(
      normalized === '::1' ||
      normalized.startsWith('fc') ||
      normalized.startsWith('fd') ||
      normalized.startsWith('fe8') ||
      normalized.startsWith('fe9') ||
      normalized.startsWith('fea') ||
      normalized.startsWith('feb')
    );
  }
  return false;
}

function isRegistryConfig(
  input: AuthoritativeSourceResolverInput,
): input is AuthoritativeSourceRegistryConfig {
  return 'registryUrl' in input && 'privateSource' in input;
}
