import {
  Controller,
  Get,
  Post,
  Put,
  Body,
  Query,
  Param,
  UseGuards,
  BadRequestException,
} from '@nestjs/common';
import { DelegationsService } from './delegations.service.js';
import { JwtAuthGuard } from '../auth/jwt-auth.guard.js';
import { v1 } from '@imeal/contracts';
const { CreateDelegationRequestSchema } = v1;
import { ZodValidationPipe } from '../common/pipes/zod-validation.pipe.js';
import { CurrentUser } from '../auth/current-user.decorator.js';
import type { AuthenticatedUser } from '../auth/authenticated-user.js';

@UseGuards(JwtAuthGuard)
@Controller('api/delegations')
export class DelegationsController {
  constructor(private readonly delegationsService: DelegationsService) {}
  @Get()
  async getDelegations(
    @CurrentUser() user: AuthenticatedUser,
    @Query('type') type: string,
  ) {
    if (type !== 'incoming' && type !== 'outgoing') {
      throw new BadRequestException('Type must be incoming or outgoing');
    }
    return this.delegationsService.getDelegations(user.id, type);
  }

  @Post()
  async createDelegation(
    @CurrentUser() user: AuthenticatedUser,
    @Body(new ZodValidationPipe(CreateDelegationRequestSchema))
    body: v1.CreateDelegationRequest,
  ) {
    return this.delegationsService.createDelegation(user.id, body);
  }

  @Put(':id/accept')
  async acceptDelegation(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
  ) {
    return this.delegationsService.acceptDelegation(user.id, id);
  }

  @Put(':id/decline')
  async declineDelegation(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
  ) {
    return this.delegationsService.declineDelegation(user.id, id);
  }

  @Put(':id/revoke')
  async revokeDelegation(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
  ) {
    return this.delegationsService.revokeDelegation(user.id, id);
  }
}
