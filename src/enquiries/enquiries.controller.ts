import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  ParseEnumPipe,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  Req,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { EnquiryStatus, UserRole } from '@prisma/client';
import type { Request } from 'express';

import { Public } from '../auth/decorator/public.decorator';
import { Roles } from '../auth/decorator/roles.decorator';
import { CreateEnquiryDto } from './dto/create-enquiry.dto';
import { EnquiriesService } from './enquiries.service';

@Controller('enquiries')
export class EnquiriesController {
  constructor(private readonly enquiries: EnquiriesService) {}

  /** Public: used by the marketing site's Contact and Book-a-demo forms. */
  @Public()
  @Post()
  @HttpCode(201)
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  create(@Body() dto: CreateEnquiryDto, @Req() req: Request) {
    return this.enquiries.create(dto, {
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
    });
  }

  @Roles(UserRole.SUPER_ADMIN)
  @Get()
  findAll(
    @Query('status', new ParseEnumPipe(EnquiryStatus, { optional: true }))
    status?: EnquiryStatus,
  ) {
    return this.enquiries.findAll(status);
  }

  @Roles(UserRole.SUPER_ADMIN)
  @Patch(':id/status')
  updateStatus(
    @Param('id', ParseUUIDPipe) id: string,
    @Body('status', new ParseEnumPipe(EnquiryStatus)) status: EnquiryStatus,
  ) {
    return this.enquiries.updateStatus(id, status);
  }
}
