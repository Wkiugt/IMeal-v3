import { Injectable, UnauthorizedException } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { passportJwtSecret } from 'jwks-rsa';

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor() {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      audience: process.env.ENTRA_CLIENT_ID,
      issuer: `https://login.microsoftonline.com/${process.env.ENTRA_TENANT_ID}/v2.0`,
      secretOrKeyProvider: passportJwtSecret({
        cache: true,
        rateLimit: true,
        jwksRequestsPerMinute: 5,
        jwksUri: `https://login.microsoftonline.com/${process.env.ENTRA_TENANT_ID}/discovery/v2.0/keys`,
      }),
    });
  }

  validate(payload: Record<string, unknown>) {
    const tenantId = typeof payload.tid === 'string' ? payload.tid : '';
    const expectedTenantId = process.env.ENTRA_TENANT_ID;
    if (!tenantId || tenantId !== expectedTenantId) {
      throw new UnauthorizedException('Invalid Microsoft Entra tenant');
    }

    const userId =
      typeof payload.oid === 'string'
        ? payload.oid
        : typeof payload.sub === 'string'
          ? payload.sub
          : '';
    const email =
      typeof payload.preferred_username === 'string'
        ? payload.preferred_username
        : typeof payload.upn === 'string'
          ? payload.upn
          : typeof payload.email === 'string'
            ? payload.email
            : '';
    if (!userId || !email) {
      throw new UnauthorizedException(
        'Token is missing required identity claims',
      );
    }

    return {
      userId,
      email,
      name: typeof payload.name === 'string' ? payload.name : undefined,
      tenantId,
    };
  }
}
