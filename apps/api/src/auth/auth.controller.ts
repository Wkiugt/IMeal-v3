import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import { v1 } from '@imeal/contracts';
import { CurrentUser } from './current-user.decorator.js';
import type { AuthenticatedUser } from './authenticated-user.js';
import {
  OtpService,
  type OtpRequestContext,
} from './otp.service.js';
import { SessionGuard } from './session.guard.js';
import { SessionService } from './session.service.js';

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
    private readonly otpService: OtpService,
    private readonly sessionService: SessionService,
  ) {}

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
  async verifyOtp(
    @Body() body: unknown,
    @Req() request: AuthRequest,
  ): Promise<v1.VerifyOtpResponse> {
    const parsed = v1.VerifyOtpSchema.safeParse(body);
    if (!parsed.success) {
      throw new BadRequestException({
        code: 'VALIDATION_ERROR',
        message: 'Invalid OTP verification request.',
      });
    }

    const context = otpContext(request);
    const principal = await this.otpService.verify(parsed.data, context);
    const requestId = context.requestId ?? principal.requestId;
    const metadata = {
      ...(request.ip ? { clientIp: request.ip } : {}),
      ...(firstHeader(request.headers, 'x-device-id')
        ? { deviceId: firstHeader(request.headers, 'x-device-id') }
        : {}),
      ...(firstHeader(request.headers, 'user-agent')
        ? { userAgent: firstHeader(request.headers, 'user-agent') }
        : {}),
    };
    const session = await this.sessionService.create({
      userId: principal.userId,
      purpose: parsed.data.purpose,
      requestId,
      metadata,
    });

    return {
      sessionToken: session.token,
      expiresAt: session.expiresAt.toISOString(),
      user: {
        id: principal.user.id,
        email: principal.user.email,
        name: principal.user.name ?? null,
      },
    };
  }

  @UseGuards(SessionGuard)
  @Post('logout')
  async logout(
    @Req() request: AuthRequest,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<v1.LogoutResponse> {
    if (!user.sessionId) {
      throw new BadRequestException({
        code: 'SESSION_REVOKED',
        message: 'Authenticated session is missing.',
      });
    }
    await this.sessionService.revoke(
      user.sessionId,
      'LOGOUT',
      firstHeader(request.headers, 'x-request-id') ?? request.id ?? 'unknown',
    );
    return { revoked: true };
  }

  @UseGuards(SessionGuard)
  @Get('me')
  getProfile(@CurrentUser() user: AuthenticatedUser) {
    return user;
  }
}
