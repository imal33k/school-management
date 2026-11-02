import { PaginationQueryDto } from '../common/dto/pagination-query.dto';
import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  Query,
  Req,
} from '@nestjs/common';
import { UserRole } from '@prisma/client';
import type { RawBodyRequest } from '@nestjs/common';
import type { Request } from 'express';

import { PaymentsService } from './payments.service';

import { CreatePaymentDto } from './dto/create-payment.dto';
import { UpdatePaymentStatusDto } from './dto/update-payment.dto';
import { InitializePaymentDto } from './dto/initialize-payment.dto';
import { Public } from '../auth/decorator/public.decorator';
import { Roles } from '../auth/decorator/roles.decorator';

import {
  CurrentUser,
 type RequestUser,
} from '../auth/decorator/current-user.decorator';

@Controller('payments')
export class PaymentsController {
  constructor(
    private readonly paymentsService: PaymentsService,
  ) {}

  @Post('initialize')
  @Roles(
    UserRole.STUDENT,
    UserRole.PARENT,
    UserRole.SCHOOL_ADMIN,
    UserRole.ACCOUNTANT,
    UserRole.SUPER_ADMIN,
  )
  initialize(@Body() dto: InitializePaymentDto, @CurrentUser() user: RequestUser) {
    return this.paymentsService.initializePaystack(dto, user);
  }

  @Public()
  @Post('webhook')
  async webhook(@Req() req: RawBodyRequest<Request>) {
    return this.paymentsService.handleWebhook(req);
  }

  @Get('verify/:reference')
  @Roles(
    UserRole.STUDENT,
    UserRole.PARENT,
    UserRole.SCHOOL_ADMIN,
    UserRole.ACCOUNTANT,
    UserRole.SUPER_ADMIN,
  )
  verify(@Param('reference') reference: string, @CurrentUser() user: RequestUser) {
    return this.paymentsService.verifyPaystack(reference, user);
  }

  @Post()
  @Roles(UserRole.SCHOOL_ADMIN, UserRole.ACCOUNTANT, UserRole.SUPER_ADMIN)
  create(
    @Body() dto: CreatePaymentDto,
    @CurrentUser() user: RequestUser,
  ) {
    return this.paymentsService.create(
      dto,
      user,
    );
  }

  @Get()
  @Roles(UserRole.SCHOOL_ADMIN, UserRole.ACCOUNTANT, UserRole.SUPER_ADMIN)
  findAll(

    @CurrentUser() user: RequestUser,
    @Query() query: PaginationQueryDto,
  ) {
    return this.paymentsService.findAll(
      user, query,
    );
  }

  @Get('student/:studentId')
  @Roles(UserRole.SCHOOL_ADMIN, UserRole.ACCOUNTANT, UserRole.SUPER_ADMIN)
  findByStudent(
    @Param('studentId') studentId: string,
    @CurrentUser() user: RequestUser,
  ) {
    return this.paymentsService.findByStudent(
      studentId,
      user,
    );
  }

  @Get('invoice/:invoiceId')
  @Roles(UserRole.SCHOOL_ADMIN, UserRole.ACCOUNTANT, UserRole.SUPER_ADMIN)
  findByInvoice(
    @Param('invoiceId') invoiceId: string,
    @CurrentUser() user: RequestUser,
  ) {
    return this.paymentsService.findByInvoice(
      invoiceId,
      user,
    );
  }

  @Get(':id')
  @Roles(UserRole.SCHOOL_ADMIN, UserRole.ACCOUNTANT, UserRole.SUPER_ADMIN)
  findOne(
    @Param('id') id: string,
    @CurrentUser() user: RequestUser,
  ) {
    return this.paymentsService.findOne(
      id,
      user,
    );
  }

  @Patch(':id/status')
  @Roles(UserRole.SCHOOL_ADMIN, UserRole.ACCOUNTANT, UserRole.SUPER_ADMIN)
  updateStatus(
    @Param('id') id: string,
    @Body() dto: UpdatePaymentStatusDto,
    @CurrentUser() user: RequestUser,
  ) {
    return this.paymentsService.updateStatus(
      id,
      dto,
      user,
    );
  }
}