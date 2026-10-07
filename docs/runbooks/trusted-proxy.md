# Trusted proxy and OTP client identity

The API listens behind Caddy on the private Compose `app` network. Fastify is created with `trustProxy: false`. Client identity is resolved only by `resolveTrustedClientIp`.

## Trust rule

- `TRUSTED_PROXY_CIDRS` is a comma-separated list of IP addresses or CIDRs, at most eight entries.
- Production startup requires a non-empty list. Outside production, an empty or unset list trusts nobody.
- A forwarding header is used only when the immediate socket peer is inside that list and `X-Forwarded-For` contains exactly one IP.
- Multi-hop `X-Forwarded-For`, `X-Real-IP`, and `Forwarded` never change identity for an untrusted peer, and a multi-hop chain is not walked even for a trusted peer.
- Prefix `/0` and host bits inside a CIDR are rejected. Do not set `trustProxy: true`.

## Compose networks

Caddy reaches the API only on the internal `app` network. The overlays pin that network and set the API trust list to the same CIDR:

| Overlay | App network CIDR | `TRUSTED_PROXY_CIDRS` |
| --- | --- | --- |
| `docker-compose.production.yml` | `172.31.28.0/24` | `172.31.28.0/24` |
| `docker-compose.staging.yml` | `172.31.29.0/24` | `172.31.29.0/24` |

These are private ranges, not public hostnames. If an existing named `app` network was created with a different subnet, recreate that network before deploying. Changing the subnet requires changing both the Compose `ipam` block and `TRUSTED_PROXY_CIDRS` together.

Admin Web shares the app network. Only the socket peer is trusted, and only for one hop. Do not widen the list to `0.0.0.0/0` or to the data network.

## Edge header

`Caddyfile.production` and `infra/staging/Caddyfile` set `header_up X-Forwarded-For {remote_host}` on API reverse proxies, including `/health/live` and `/health/ready`. That replaces a client-supplied chain with the single address Caddy saw. `/metrics` stays denied and is not proxied to the worker.

OTP rate-limit buckets and session metadata hash this trusted client IP. Raw client IPs are not persisted.
