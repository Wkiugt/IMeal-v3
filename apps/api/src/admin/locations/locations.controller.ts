import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Param,
  Post,
  Put,
  UseGuards,
} from '@nestjs/common';
import { z } from 'zod';
import { LocationsService } from '../../locations/locations.service.js';
import { SessionGuard } from '../../auth/session.guard.js';
import { PermissionsGuard } from '../../auth/permissions.guard.js';
import { RequirePermission } from '../../auth/require-permission.decorator.js';
import { CurrentUser } from '../../auth/current-user.decorator.js';
import type { AuthenticatedUser } from '../../auth/authenticated-user.js';

const LocationConfigurationSchema = z
  .object({
    id: z.string().min(1).optional(),
    shortCode: z.string().min(1),
    displayName: z.string().min(1),
    servingPointName: z.string().min(1),
    address: z.string().min(1),
    building: z.string().min(1),
    floor: z.string().min(1),
    roomOrCounter: z.string().min(1),
    localContact: z.string().min(1),
    timeZone: z.literal('Asia/Ho_Chi_Minh').optional(),
    isActive: z.boolean(),
    effectiveFrom: z.union([z.string(), z.date()]),
    effectiveTo: z.union([z.string(), z.date()]).nullable().optional(),
    operationalMetadata: z.unknown().optional(),
    holidayOverrides: z.unknown().optional(),
    capacityNotes: z.string().nullable().optional(),
    accessibilityInstructions: z.string().nullable().optional(),
    emergencyInstructions: z.string().nullable().optional(),
    kitchenTeam: z.string().nullable().optional(),
    approvedScannerDeviceIds: z.array(z.string().min(1)).optional(),
    networkNotes: z.string().nullable().optional(),
    policy: z
      .object({
        id: z.string().min(1).optional(),
        latitude: z.number().finite().min(-90).max(90),
        longitude: z.number().finite().min(-180).max(180),
        accuracySource: z.string().min(1),
        geofenceRadiusMeters: z.number().finite().int().positive(),
        maxFixAgeSeconds: z.number().finite().int().nonnegative(),
        maxAccuracyMeters: z.number().finite().nonnegative(),
        effectiveFrom: z.union([z.string(), z.date()]),
        effectiveTo: z.union([z.string(), z.date()]).nullable().optional(),
        isActive: z.boolean(),
      })
      .strict(),
  })
  .strict();

@Controller(['v1/admin/locations', 'admin/locations'])
@UseGuards(SessionGuard, PermissionsGuard)
export class LocationsController {
  constructor(private readonly locationsService: LocationsService) {}

  @Get()
  @RequirePermission('location.manage')
  list() {
    return this.locationsService.listConfiguredLocations();
  }

  @Post()
  @RequirePermission('location.manage')
  save(@Body() body: unknown, @CurrentUser() user: AuthenticatedUser) {
    return this.saveConfiguration(body, user.id);
  }

  @Put(':id')
  @RequirePermission('location.manage')
  update(
    @Param('id') id: string,
    @Body() body: unknown,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    if (!body || typeof body !== 'object') {
      throw new BadRequestException({
        code: 'VALIDATION_ERROR',
        message: 'Location configuration is required.',
      });
    }
    return this.saveConfiguration({ ...(body as object), id }, user.id);
  }

  private saveConfiguration(body: unknown, actorId: string) {
    const parsed = LocationConfigurationSchema.safeParse(body);
    if (!parsed.success) {
      throw new BadRequestException({
        code: 'VALIDATION_ERROR',
        message: 'Invalid location configuration.',
      });
    }
    return this.locationsService.saveConfiguration(parsed.data, actorId);
  }
}
