import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { isTestAuthBypassEnabled } from '../config/environment.js';
import type { AuthenticatedUser } from './authenticated-user.js';
import { SessionService } from './session.service.js';

const SESSION_INVALID_ERROR = {
  code: 'SESSION_INVALID' as const,
  message: 'Invalid or expired session.',
};

interface SessionRequest {
  headers?: Record<string, string | string[] | undefined>;
  user?: AuthenticatedUser;
}

function firstHeader(
  headers: SessionRequest['headers'],
  name: string,
): string | undefined {
  const value = headers?.[name];
  return Array.isArray(value) ? value[0] : value;
}

function extractSessionToken(request: SessionRequest): string | undefined {
  const authorization = firstHeader(request.headers, 'authorization');
  if (!authorization?.startsWith('Bearer ')) return undefined;

  const token = authorization.slice('Bearer '.length).trim();
  return token || undefined;
}

@Injectable()
export class SessionGuard implements CanActivate {
  constructor(private readonly sessionService: SessionService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<SessionRequest>();

    if (isTestAuthBypassEnabled()) {
      request.user = {
        id: 'test-user-id',
        userId: 'test-user-id',
        email: 'test-user@example.test',
        name: 'Test User',
        roles: [],
        permissions: [],
        sessionId: 'test-session-id',
        isActive: true,
      };
      return true;
    }

    const token = extractSessionToken(request);
    if (!token) {
      throw new UnauthorizedException(SESSION_INVALID_ERROR);
    }

    const user = await this.sessionService.resolve(token);
    if (!user) {
      throw new UnauthorizedException(SESSION_INVALID_ERROR);
    }

    request.user = user;
    return true;
  }
}
