import { Controller, UseGuards, Get } from '@nestjs/common';
import { JwtAuthGuard } from './jwt-auth.guard.js';
import { CurrentUser } from './current-user.decorator.js';
import type { AuthenticatedUser } from './authenticated-user.js';

@Controller('auth')
export class AuthController {
  @UseGuards(JwtAuthGuard)
  @Get('me')
  getProfile(@CurrentUser() user: AuthenticatedUser) {
    return user;
  }
}
