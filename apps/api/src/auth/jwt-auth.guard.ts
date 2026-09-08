import {
  Injectable,
  ExecutionContext,
  UnauthorizedException,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { JwtService } from '@nestjs/jwt';
import {
  isLocalAuthEnabled,
  isTestAuthBypassEnabled,
} from '../config/environment.js';
import { AuthService } from './auth.service.js';

@Injectable()
export class JwtAuthGuard extends AuthGuard('jwt') {
  private readonly jwtService = new JwtService();

  constructor(private readonly authService: AuthService) {
    super();
  }

  async canActivate(context: ExecutionContext): Promise<boolean> {
    if (isTestAuthBypassEnabled()) {
      const request = context.switchToHttp().getRequest();
      request.user = {
        id: 'test-user-id',
        userId: 'test-user-id',
        roles: [],
        permissions: [],
      };
      return true;
    }

    if (isLocalAuthEnabled()) {
      const request = context.switchToHttp().getRequest();
      const authorization = request.headers?.authorization;
      const token =
        typeof authorization === 'string' && authorization.startsWith('Bearer ')
          ? authorization.slice('Bearer '.length).trim()
          : '';
      if (!token) throw new UnauthorizedException('Bearer token is required');

      try {
        const payload = this.jwtService.verify<{
          sub?: string;
          authType?: string;
        }>(token, { secret: process.env.LOCAL_AUTH_JWT_SECRET });
        if (payload.authType !== 'local' || !payload.sub) {
          throw new UnauthorizedException('Invalid local access token');
        }
        request.user = await this.authService.getPrincipal(payload.sub);
        return true;
      } catch (error) {
        if (error instanceof UnauthorizedException) throw error;
        throw new UnauthorizedException('Invalid local access token');
      }
    }

    const authenticated = await super.canActivate(context);
    if (!authenticated) return false;

    const request = context.switchToHttp().getRequest();
    request.user = await this.authService.provisionUser(request.user);
    return true;
  }
}
