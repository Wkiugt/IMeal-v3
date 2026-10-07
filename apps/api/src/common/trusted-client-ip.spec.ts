import { describe, expect, it } from 'vitest';
import {
  TrustedProxyConfigError,
  parseTrustedProxyList,
  resolveTrustedClientIp,
  validateTrustedProxyConfiguration,
} from './trusted-client-ip.js';

const APP_NETWORK = ['172.31.28.0/24'];
const trusted = parseTrustedProxyList(APP_NETWORK[0]);

describe('trusted client IP', () => {
  it('uses the socket peer when a direct request has no proxy headers', () => {
    expect(
      resolveTrustedClientIp(
        {
          ip: '203.0.113.8',
          socket: { remoteAddress: '203.0.113.8' },
          headers: {},
        },
        trusted,
      ),
    ).toBe('203.0.113.8');
  });

  it('accepts one Caddy-style forwarded hop from a trusted peer', () => {
    expect(
      resolveTrustedClientIp(
        {
          ip: '::ffff:172.31.28.2',
          socket: { remoteAddress: '::ffff:172.31.28.2' },
          headers: {
            'x-forwarded-for': '203.0.113.10',
            'x-real-ip': '198.51.100.99',
            forwarded: 'for=198.51.100.77',
          },
        },
        trusted,
      ),
    ).toBe('203.0.113.10');
  });

  it('ignores spoofed and multi-hop headers from an untrusted peer', () => {
    expect(
      resolveTrustedClientIp(
        {
          ip: '198.51.100.8',
          socket: { remoteAddress: '198.51.100.8' },
          headers: {
            'x-forwarded-for': '203.0.113.10, 198.51.100.9',
            'x-real-ip': '203.0.113.10',
            forwarded: 'for=203.0.113.10',
          },
        },
        trusted,
      ),
    ).toBe('198.51.100.8');
  });

  it('does not walk a multi-hop chain even when the socket peer is trusted', () => {
    expect(
      resolveTrustedClientIp(
        {
          socket: { remoteAddress: '172.31.28.2' },
          headers: { 'x-forwarded-for': '203.0.113.10, 198.51.100.9' },
        },
        trusted,
      ),
    ).toBe('172.31.28.2');
  });

  it('trusts nobody when the trust list is empty', () => {
    expect(
      resolveTrustedClientIp(
        {
          socket: { remoteAddress: '172.31.28.2' },
          headers: { 'x-forwarded-for': '203.0.113.10' },
        },
        [],
      ),
    ).toBe('172.31.28.2');
  });

  it('keeps two forwarded clients distinct', () => {
    const first = resolveTrustedClientIp(
      {
        socket: { remoteAddress: '172.31.28.2' },
        headers: { 'x-forwarded-for': '203.0.113.10' },
      },
      trusted,
    );
    const second = resolveTrustedClientIp(
      {
        socket: { remoteAddress: '172.31.28.3' },
        headers: { 'x-forwarded-for': '203.0.113.11' },
      },
      trusted,
    );
    expect(first).toBe('203.0.113.10');
    expect(second).toBe('203.0.113.11');
    expect(first).not.toBe(second);
  });

  it('rejects unrestricted and malformed trust lists', () => {
    expect(() => parseTrustedProxyList('0.0.0.0/0')).toThrow(TrustedProxyConfigError);
    expect(() => parseTrustedProxyList('::/0')).toThrow(TrustedProxyConfigError);
    expect(() => parseTrustedProxyList('caddy')).toThrow(TrustedProxyConfigError);
    expect(() => parseTrustedProxyList('172.31.28.5/24')).toThrow(
      TrustedProxyConfigError,
    );
    expect(() =>
      validateTrustedProxyConfiguration({ TRUSTED_PROXY_CIDRS: '' }, true),
    ).toThrow(/TRUSTED_PROXY_CIDRS/);
    expect(() =>
      validateTrustedProxyConfiguration({}, false),
    ).not.toThrow();
  });
});
