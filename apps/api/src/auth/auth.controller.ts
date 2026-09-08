import {
  Body,
  Controller,
  Get,
  NotFoundException,
  Post,
  UseGuards,
} from '@nestjs/common';
import { isLocalAuthEnabled } from '../config/environment.js';
import { JwtAuthGuard } from './jwt-auth.guard.js';
import { CurrentUser } from './current-user.decorator.js';
import type { AuthenticatedUser } from './authenticated-user.js';
import { AuthService } from './auth.service.js';
import { parseLocalCredentials } from './local-auth.js';

@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Post('local-login')
  loginLocal(@Body() body: unknown) {
    if (!isLocalAuthEnabled()) {
      throw new NotFoundException('Local authentication is disabled');
    }
    const { username, password } = parseLocalCredentials(body);
    return this.authService.authenticateLocal(username, password);
  }

  @UseGuards(JwtAuthGuard)
  @Get('me')
  getProfile(@CurrentUser() user: AuthenticatedUser) {
    return user;
  }
}
