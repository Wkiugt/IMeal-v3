import { isIP } from 'node:net';

export const TRUSTED_PROXY_CIDRS_ENV = 'TRUSTED_PROXY_CIDRS';

const MAX_TRUSTED_PROXIES = 8;
const SAFE_TOKEN = /^[A-Za-z0-9._:+-]{1,80}$/;

export type TrustedClientRequest = {
  ip?: string;
  socket?: { remoteAddress?: string | null };
  raw?: { socket?: { remoteAddress?: string | null } };
  headers?: Record<string, string | string[] | undefined>;
};

type ParsedAddress = {
  version: 4 | 6;
  bytes: Uint8Array;
};

type TrustedProxyRule = {
  version: 4 | 6;
  bytes: Uint8Array;
  prefix: number;
};

export class TrustedProxyConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'TrustedProxyConfigError';
  }
}

function parseIpv4(value: string): Uint8Array | undefined {
  const parts = value.split('.');
  if (parts.length !== 4) return undefined;
  const bytes = new Uint8Array(4);
  for (let index = 0; index < 4; index += 1) {
    const part = parts[index] ?? '';
    if (!/^(0|[1-9]\d{0,2})$/.test(part)) return undefined;
    const octet = Number(part);
    if (octet > 255) return undefined;
    bytes[index] = octet;
  }
  return bytes;
}

function groupsToBytes(groups: readonly number[]): Uint8Array {
  const bytes = new Uint8Array(16);
  groups.forEach((group, index) => {
    bytes[index * 2] = (group >> 8) & 0xff;
    bytes[index * 2 + 1] = group & 0xff;
  });
  return bytes;
}

function expandGroups(parts: readonly string[]): number[] | undefined {
  const groups: number[] = [];
  for (let index = 0; index < parts.length; index += 1) {
    const part = parts[index] ?? '';
    if (part.includes('.')) {
      if (index !== parts.length - 1) return undefined;
      const ipv4 = parseIpv4(part);
      if (!ipv4) return undefined;
      groups.push((ipv4[0]! << 8) | ipv4[1]!, (ipv4[2]! << 8) | ipv4[3]!);
      continue;
    }
    if (!/^[0-9a-f]{1,4}$/.test(part)) return undefined;
    groups.push(Number.parseInt(part, 16));
  }
  return groups;
}

function parseIpv6(value: string): Uint8Array | undefined {
  const input = value.toLowerCase();
  if (input.includes(':::')) return undefined;
  const halves = input.split('::');
  if (halves.length > 2) return undefined;
  const head = halves[0] ? halves[0].split(':') : [];
  const tail = halves.length === 2 && halves[1] ? halves[1].split(':') : [];
  const left = expandGroups(head);
  const right = halves.length === 2 ? expandGroups(tail) : [];
  if (!left || !right) return undefined;
  if (halves.length === 1) {
    return left.length === 8 ? groupsToBytes(left) : undefined;
  }
  const missing = 8 - left.length - right.length;
  if (missing < 1) return undefined;
  return groupsToBytes([
    ...left,
    ...Array.from({ length: missing }, () => 0),
    ...right,
  ]);
}

function parseAddress(value: string): ParsedAddress | undefined {
  const trimmed = value.trim().replace(/^\[|\]$/g, '');
  const zoneIndex = trimmed.indexOf('%');
  const withoutZone = zoneIndex === -1 ? trimmed : trimmed.slice(0, zoneIndex);
  if (!withoutZone || withoutZone.includes('%') || withoutZone.includes('/')) {
    return undefined;
  }
  if (!withoutZone.includes(':')) {
    const ipv4 = parseIpv4(withoutZone);
    return ipv4 ? { version: 4, bytes: ipv4 } : undefined;
  }
  const ipv6 = parseIpv6(withoutZone);
  return ipv6 ? { version: 6, bytes: ipv6 } : undefined;
}

function isIpv4Mapped(bytes: Uint8Array): boolean {
  if (bytes.length !== 16) return false;
  for (let index = 0; index < 10; index += 1) {
    if (bytes[index] !== 0) return false;
  }
  return bytes[10] === 0xff && bytes[11] === 0xff;
}

export function canonicalizeIp(value: string | null | undefined): string | undefined {
  if (!value?.trim()) return undefined;
  const parsed = parseAddress(value);
  if (!parsed) return undefined;
  if (parsed.version === 6 && isIpv4Mapped(parsed.bytes)) {
    return Array.from(parsed.bytes.subarray(12)).join('.');
  }
  if (parsed.version === 4) return Array.from(parsed.bytes).join('.');
  const groups: string[] = [];
  for (let index = 0; index < 16; index += 2) {
    const group = ((parsed.bytes[index]! << 8) | parsed.bytes[index + 1]!).toString(16);
    groups.push(group.padStart(4, '0'));
  }
  return groups.join(':');
}

function addressBytes(value: string): ParsedAddress | undefined {
  const canonical = canonicalizeIp(value);
  if (!canonical) return undefined;
  return parseAddress(canonical);
}

function prefixMatches(
  address: Uint8Array,
  network: Uint8Array,
  prefix: number,
): boolean {
  const fullBytes = Math.floor(prefix / 8);
  const remainder = prefix % 8;
  for (let index = 0; index < fullBytes; index += 1) {
    if (address[index] !== network[index]) return false;
  }
  if (remainder === 0) return true;
  const mask = (0xff << (8 - remainder)) & 0xff;
  return (address[fullBytes]! & mask) === (network[fullBytes]! & mask);
}

function hostBitsClear(bytes: Uint8Array, prefix: number): boolean {
  const fullBytes = Math.floor(prefix / 8);
  const remainder = prefix % 8;
  if (remainder !== 0) {
    const mask = (0xff << (8 - remainder)) & 0xff;
    if ((bytes[fullBytes]! & ~mask) !== 0) return false;
  }
  for (let index = fullBytes + (remainder === 0 ? 0 : 1); index < bytes.length; index += 1) {
    if (bytes[index] !== 0) return false;
  }
  return true;
}

function parseRule(token: string): TrustedProxyRule {
  const slash = token.lastIndexOf('/');
  const addressText = slash === -1 ? token : token.slice(0, slash);
  const prefixText = slash === -1 ? undefined : token.slice(slash + 1);
  const parsed = parseAddress(addressText);
  if (!parsed || isIP(addressText.replace(/^\[|\]$/g, '').split('%')[0] ?? '') === 0) {
    throw new TrustedProxyConfigError(
      'TRUSTED_PROXY_CIDRS must contain only IP addresses or CIDRs',
    );
  }
  const maxPrefix = parsed.version === 4 ? 32 : 128;
  const prefix = prefixText === undefined ? maxPrefix : Number(prefixText);
  if (
    !/^\d+$/.test(prefixText ?? String(maxPrefix)) ||
    !Number.isInteger(prefix) ||
    prefix < 1 ||
    prefix > maxPrefix
  ) {
    throw new TrustedProxyConfigError(
      'TRUSTED_PROXY_CIDRS must not use an unrestricted or invalid prefix',
    );
  }
  if (!hostBitsClear(parsed.bytes, prefix)) {
    throw new TrustedProxyConfigError(
      'TRUSTED_PROXY_CIDRS entries must not set host bits',
    );
  }
  return { version: parsed.version, bytes: parsed.bytes, prefix };
}

export function parseTrustedProxyList(value: string | undefined): TrustedProxyRule[] {
  const trimmed = value?.trim() ?? '';
  if (!trimmed) return [];
  const tokens = trimmed.split(',').map((token) => token.trim());
  if (tokens.some((token) => token.length === 0) || tokens.length > MAX_TRUSTED_PROXIES) {
    throw new TrustedProxyConfigError(
      'TRUSTED_PROXY_CIDRS must be a comma-separated list of at most 8 IP addresses or CIDRs',
    );
  }
  const rules = tokens.map(parseRule);
  const seen = new Set<string>();
  return rules.filter((rule) => {
    const key = `${rule.version}:${Array.from(rule.bytes).join('.')}/${rule.prefix}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export function trustedProxyCidrsFromEnv(
  env: NodeJS.ProcessEnv = process.env,
): readonly TrustedProxyRule[] {
  return parseTrustedProxyList(env[TRUSTED_PROXY_CIDRS_ENV]);
}

export function validateTrustedProxyConfiguration(
  env: NodeJS.ProcessEnv,
  production: boolean,
): void {
  const raw = env[TRUSTED_PROXY_CIDRS_ENV];
  if (!raw?.trim()) {
    if (production) {
      throw new TrustedProxyConfigError(
        'Missing required API environment variables: TRUSTED_PROXY_CIDRS',
      );
    }
    return;
  }
  const rules = parseTrustedProxyList(raw);
  if (rules.length === 0) {
    throw new TrustedProxyConfigError(
      'TRUSTED_PROXY_CIDRS must list at least one IP or CIDR',
    );
  }
}

function socketPeer(request: TrustedClientRequest): string | undefined {
  return canonicalizeIp(
    request.socket?.remoteAddress ??
      request.raw?.socket?.remoteAddress ??
      request.ip,
  );
}

function headerValues(
  headers: TrustedClientRequest['headers'],
  name: string,
): string[] {
  if (!headers) return [];
  const target = name.toLowerCase();
  for (const [key, value] of Object.entries(headers)) {
    if (key.toLowerCase() !== target || value === undefined) continue;
    return Array.isArray(value) ? value : [value];
  }
  return [];
}

function singleForwardedClient(
  headers: TrustedClientRequest['headers'],
): string | undefined {
  const values = headerValues(headers, 'x-forwarded-for');
  if (values.length !== 1) return undefined;
  const hops = values[0]?.split(',').map((hop) => hop.trim()).filter(Boolean) ?? [];
  if (hops.length !== 1) return undefined;
  const client = canonicalizeIp(hops[0]);
  if (!client || client === '0.0.0.0' || client === '0000:0000:0000:0000:0000:0000:0000:0000') {
    return undefined;
  }
  return client;
}

function matchesRule(address: string, rule: TrustedProxyRule): boolean {
  const parsed = addressBytes(address);
  if (!parsed || parsed.version !== rule.version) return false;
  return prefixMatches(parsed.bytes, rule.bytes, rule.prefix);
}

export function isTrustedProxyPeer(
  peer: string | undefined,
  rules: readonly TrustedProxyRule[],
): boolean {
  if (!peer || rules.length === 0) return false;
  return rules.some((rule) => matchesRule(peer, rule));
}

/**
 * Identity is the socket peer unless that peer is in the configured trust list
 * and X-Forwarded-For contains exactly one IP. Multi-hop chains, X-Real-IP, and
 * Forwarded are never walked. An empty trust list trusts nobody.
 */
export function resolveTrustedClientIp(
  request: TrustedClientRequest,
  rules: readonly TrustedProxyRule[] = trustedProxyCidrsFromEnv(),
): string | undefined {
  const peer = socketPeer(request);
  if (!peer) return undefined;
  if (!isTrustedProxyPeer(peer, rules)) return peer;
  return singleForwardedClient(request.headers) ?? peer;
}

export function isSafeReleaseVersion(value: string | null | undefined): value is string {
  return Boolean(value && SAFE_TOKEN.test(value));
}
