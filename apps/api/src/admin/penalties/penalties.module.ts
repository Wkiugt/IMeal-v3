import { Module } from '@nestjs/common';
import { PenaltiesController } from './penalties.controller.js';
import { PenaltiesService } from './penalties.service.js';
import { AuthModule } from '../../auth/auth.module.js';

@Module({
  imports: [AuthModule],
  controllers: [PenaltiesController],
  providers: [PenaltiesService],
  exports: [PenaltiesService],
})
export class PenaltiesModule {}
