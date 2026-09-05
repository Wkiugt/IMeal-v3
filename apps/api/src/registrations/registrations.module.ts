import { Module } from '@nestjs/common';
import { RegistrationsController } from './registrations.controller.js';
import { RegistrationsService } from './registrations.service.js';
import { AuthModule } from '../auth/auth.module.js';

@Module({
  imports: [AuthModule],
  controllers: [RegistrationsController],
  providers: [RegistrationsService],
  exports: [RegistrationsService],
})
export class RegistrationsModule {}
