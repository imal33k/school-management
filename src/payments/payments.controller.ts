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
import type { RawBodyRequest } from '@nestjs/common';
import type { Request } from 'express';

import { PaymentsService } from './payments.service';

import { CreatePaymentDto } from './dto/create-payment.dto';
import { UpdatePaymentStatusDto } from './dto/update-payment.dto';
import { InitializePaymentDto } from './dto/initialize-payment.dto';
import { Public } from '../auth/decorator/public.decorator';

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
  initialize(@Body() dto: InitializePaymentDto, @CurrentUser() user: RequestUser) {
    return this.paymentsService.initializePaystack(dto, user);
  }

  @Public()
  @Post('webhook')
  async webhook(@Req() req: RawBodyRequest<Request>) {
    return this.paymentsService.handleWebhook(req);
  }

  @Get('verify/:reference')
  verify(@Param('reference') reference: string, @CurrentUser() user: RequestUser) {
    return this.paymentsService.verifyPaystack(reference, user);
  }

  @Post()
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
  findAll(

    @CurrentUser() user: RequestUser,
    @Query() query: PaginationQueryDto,
  ) {
    return this.paymentsService.findAll(
      user, query,
    );
  }

  @Get('student/:studentId')
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