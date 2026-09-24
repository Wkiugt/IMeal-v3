import { Module } from '@nestjs/common';
import { AllowlistService } from './allowlist.service.js';
import { OtpService } from './otp.service.js';
import { AuthController } from './auth.controller.js';
import { SessionGuard } from './session.guard.js';
import { SessionService } from './session.service.js';
import { RolesGuard } from './roles.guard.js';
import { PermissionsGuard } from './permissions.guard.js';

@Module({
  controllers: [AuthController],
  providers: [
    AllowlistService,
    OtpService,
    SessionService,
    SessionGuard,
    RolesGuard,
    PermissionsGuard,
  ],
  exports: [
    AllowlistService,
    OtpService,
    SessionService,
    SessionGuard,
    RolesGuard,
    PermissionsGuard,
  ],
})
export class AuthModule {}
