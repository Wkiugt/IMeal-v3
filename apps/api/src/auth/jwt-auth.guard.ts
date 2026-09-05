import { Injectable, ExecutionContext } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { isTestAuthBypassEnabled } from '../config/environment.js';
import { AuthService } from './auth.service.js';

@Injectable()
export class JwtAuthGuard extends AuthGuard('jwt') {
  constructor(private readonly authService: AuthService) {
    super();
  }

  async canActivate(context: ExecutionContext): Promise<boolean> {
    if (isTestAuthBypassEnabled()) {
      const request = context.switchToHttp().getRequest();
      // Provide a mock user so req.user.id and req.user.userId don't throw TypeError
      request.user = {
        id: 'test-user-id',
        userId: 'test-user-id',
        roles: [],
        permissions: [],
      };
      return true;
    }
    const authenticated = await super.canActivate(context);
    if (!authenticated) {
      return false;
    }

    const request = context.switchToHttp().getRequest();
    request.user = await this.authService.provisionUser(request.user);
    return true;
  }
}
