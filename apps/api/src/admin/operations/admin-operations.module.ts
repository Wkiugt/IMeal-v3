import { Module } from '@nestjs/common';
import { AuthModule } from '../../auth/auth.module.js';
import { AdminAuditController } from './admin-audit.controller.js';
import { AdminAuditService } from './admin-audit.service.js';
import { AdminJobsController } from './admin-jobs.controller.js';
import { AdminJobsService } from './admin-jobs.service.js';
import { AdminServingAuditController } from './admin-serving.controller.js';
import { AdminServingAuditService } from './admin-serving.service.js';

@Module({
  imports: [AuthModule],
  controllers: [AdminAuditController, AdminServingAuditController, AdminJobsController],
  providers: [AdminAuditService, AdminServingAuditService, AdminJobsService],
})
export class AdminOperationsModule {}
