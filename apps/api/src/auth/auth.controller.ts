import {
  BadRequestException,
  Body,
  Controller,
  Get,
  NotFoundException,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import { isLocalAuthEnabled } from '../config/environment.js';
import { v1 } from '@imeal/contracts';
import { JwtAuthGuard } from './jwt-auth.guard.js';
import { CurrentUser } from './current-user.decorator.js';
import type { AuthenticatedUser } from './authenticated-user.js';
import { AuthService } from './auth.service.js';
import {
  OtpService,
  type OtpRequestContext,
} from './otp.service.js';
import { parseLocalCredentials } from './local-auth.js';

interface AuthRequest {
  id?: string;
  ip?: string;
  headers?: Record<string, string | string[] | undefined>;
}

function firstHeader(
  headers: AuthRequest['headers'],
  name: string,
): string | undefined {
  const value = headers?.[name];
  return Array.isArray(value) ? value[0] : value;
}

function otpContext(request: AuthRequest): OtpRequestContext {
  return {
    requestId:
      firstHeader(request.headers, 'x-request-id') ??
      request.id,
    clientIp: request.ip,
    clientFingerprint: firstHeader(request.headers, 'user-agent'),
  };
}
@Controller('auth')
export class AuthController {
  constructor(
    private readonly authService: AuthService,
    private readonly otpService: OtpService,
  ) {}

  @Post('local-login')
  loginLocal(@Body() body: unknown) {
    if (!isLocalAuthEnabled()) {
      throw new NotFoundException('Local authentication is disabled');
    }
    const { username, password } = parseLocalCredentials(body);
    return this.authService.authenticateLocal(username, password);
  }

  @Post('otp/request')
  async requestOtp(@Body() body: unknown, @Req() request: AuthRequest) {
    const parsed = v1.RequestOtpSchema.safeParse(body);
    if (!parsed.success) {
      throw new BadRequestException({
        code: 'VALIDATION_ERROR',
        message: 'Invalid OTP request.',
      });
    }
    return this.otpService.request(parsed.data, otpContext(request));
  }

  @Post('otp/verify')
  async verifyOtp(@Body() body: unknown, @Req() request: AuthRequest) {
    const parsed = v1.VerifyOtpSchema.safeParse(body);
    if (!parsed.success) {
      throw new BadRequestException({
        code: 'VALIDATION_ERROR',
        message: 'Invalid OTP verification request.',
      });
    }
    const principal = await this.otpService.verify(
      parsed.data,
      otpContext(request),
    );
    return {
      verified: true,
      user: {
        id: principal.user.id,
        email: principal.user.email,
        name: principal.user.name ?? null,
      },
    };
  }

  @UseGuards(JwtAuthGuard)
  @Get('me')
  getProfile(@CurrentUser() user: AuthenticatedUser) {
    return user;
  }
}
