import { Body, Controller, Delete, Get, Param, Patch, Post, Put, Query, StreamableFile } from '@nestjs/common';
import { UserRole } from '@prisma/client';

import { CurrentUser, type RequestUser } from '../auth/decorator/current-user.decorator';
import { Roles } from '../auth/decorator/roles.decorator';

import { BulkInvoicingService } from './bulk-invoicing.service';
import { DiscountsService } from './discounts.service';
import {
  BatchInvoiceDto,
  CreateDiscountDto,
  CreateRefundDto,
  InstallmentPlanDto,
  SetFeeScopeDto,
  UpdateDiscountDto,
  UpdateRefundStatusDto,
} from './dto/billing.dto';
import { FeeScopeService } from './fee-scope.service';
import { InstallmentsService } from './installments.service';
import { OverdueInvoicesService } from './overdue-invoices.service';
import { ReceiptsService } from './receipts.service';
import { RefundsService } from './refunds.service';

const FINANCE = [UserRole.SCHOOL_ADMIN, UserRole.ACCOUNTANT] as const;

@Controller('student-discounts')
export class DiscountsController {
  constructor(private readonly service: DiscountsService) {}

  @Get()
  @Roles(...FINANCE)
  findAll(@CurrentUser() user: RequestUser, @Query('studentId') studentId?: string) {
    return this.service.findAll(user, studentId);
  }

  @Post()
  @Roles(UserRole.SCHOOL_ADMIN)
  create(@Body() dto: CreateDiscountDto, @CurrentUser() user: RequestUser) {
    return this.service.create(dto, user);
  }

  @Patch(':id')
  @Roles(UserRole.SCHOOL_ADMIN)
  update(@Param('id') id: string, @Body() dto: UpdateDiscountDto, @CurrentUser() user: RequestUser) {
    return this.service.update(id, dto, user);
  }

  @Delete(':id')
  @Roles(UserRole.SCHOOL_ADMIN)
  remove(@Param('id') id: string, @CurrentUser() user: RequestUser) {
    return this.service.remove(id, user);
  }
}

@Controller('invoice-batches')
export class InvoiceBatchesController {
  constructor(
    private readonly service: BulkInvoicingService,
    private readonly overdue: OverdueInvoicesService,
  ) {}

  // Marks every unpaid invoice whose due date has passed as OVERDUE
  @Post('mark-overdue')
  @Roles(...FINANCE)
  markOverdue(@CurrentUser() user: RequestUser) {
    return this.overdue.markForMySchool(user);
  }

  // See what would be billed, without creating anything
  @Post('preview')
  @Roles(...FINANCE)
  preview(@Body() dto: BatchInvoiceDto, @CurrentUser() user: RequestUser) {
    return this.service.preview(dto, user);
  }

  // Bill a whole class, level or school for a term
  @Post()
  @Roles(...FINANCE)
  create(@Body() dto: BatchInvoiceDto, @CurrentUser() user: RequestUser) {
    return this.service.create(dto, user);
  }
}

@Controller('fee-scopes')
export class FeeScopeController {
  constructor(private readonly service: FeeScopeService) {}

  @Get()
  @Roles(...FINANCE)
  findAll(@CurrentUser() user: RequestUser, @Query('termId') termId?: string) {
    return this.service.findAll(user, termId);
  }

  @Put(':feeStructureId')
  @Roles(UserRole.SCHOOL_ADMIN)
  setScope(@Param('feeStructureId') id: string, @Body() dto: SetFeeScopeDto, @CurrentUser() user: RequestUser) {
    return this.service.setScope(id, dto, user);
  }
}

@Controller('invoice-installments')
export class InstallmentsController {
  constructor(private readonly service: InstallmentsService) {}

  @Get(':invoiceId')
  @Roles(UserRole.SCHOOL_ADMIN, UserRole.ACCOUNTANT, UserRole.STUDENT, UserRole.PARENT)
  getPlan(@Param('invoiceId') invoiceId: string, @CurrentUser() user: RequestUser) {
    return this.service.getPlan(invoiceId, user);
  }

  @Put(':invoiceId')
  @Roles(...FINANCE)
  setPlan(@Param('invoiceId') invoiceId: string, @Body() dto: InstallmentPlanDto, @CurrentUser() user: RequestUser) {
    return this.service.setPlan(invoiceId, dto, user);
  }

  @Delete(':invoiceId')
  @Roles(...FINANCE)
  removePlan(@Param('invoiceId') invoiceId: string, @CurrentUser() user: RequestUser) {
    return this.service.removePlan(invoiceId, user);
  }
}

@Controller('receipts')
export class ReceiptsController {
  constructor(private readonly service: ReceiptsService) {}

  @Get(':paymentId')
  @Roles(UserRole.SCHOOL_ADMIN, UserRole.ACCOUNTANT, UserRole.STUDENT, UserRole.PARENT)
  async receipt(@Param('paymentId') paymentId: string, @CurrentUser() user: RequestUser) {
    const file = await this.service.getReceiptPdf(paymentId, user);

    return new StreamableFile(file.buffer, {
      type: 'application/pdf',
      disposition: `inline; filename="${file.filename}"`,
    });
  }
}

@Controller('refunds')
export class RefundsController {
  constructor(private readonly service: RefundsService) {}

  @Get()
  @Roles(...FINANCE)
  findAll(@CurrentUser() user: RequestUser) {
    return this.service.findAll(user);
  }

  @Post()
  @Roles(...FINANCE)
  create(@Body() dto: CreateRefundDto, @CurrentUser() user: RequestUser) {
    return this.service.create(dto, user);
  }

  @Patch(':id/status')
  @Roles(...FINANCE)
  updateStatus(@Param('id') id: string, @Body() dto: UpdateRefundStatusDto, @CurrentUser() user: RequestUser) {
    return this.service.updateStatus(id, dto, user);
  }
}
