import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module.js';
import { EmployeePenaltiesController } from './employee-penalties.controller.js';
import { EmployeePenaltiesService } from './employee-penalties.service.js';

@Module({
  imports: [AuthModule],
  controllers: [EmployeePenaltiesController],
  providers: [EmployeePenaltiesService],
  exports: [EmployeePenaltiesService],
})
export class EmployeePenaltiesModule {}
