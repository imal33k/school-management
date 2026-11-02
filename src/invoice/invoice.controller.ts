import { PaginationQueryDto } from '../common/dto/pagination-query.dto';
import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { UserRole } from '@prisma/client';

import { InvoiceService } from './invoice.service';

import {
  CurrentUser,
  type RequestUser,
} from '../auth/decorator/current-user.decorator';
import { Roles } from '../auth/decorator/roles.decorator';

import { CreateInvoiceDto } from './dto/create-invoice.dto';
import { UpdateInvoiceDto } from './dto/update-invoice.dto';

@Controller('invoices')
export class InvoiceController {
  constructor(
    private readonly invoiceService: InvoiceService,
  ) {}

  @Post()
  @Roles(UserRole.SCHOOL_ADMIN)
  create(
    @CurrentUser() user: RequestUser,
    @Body() dto: CreateInvoiceDto,
  ) {
    return this.invoiceService.create(
      user,
      dto,
    );
  }

  @Get('me')
  @Roles(UserRole.STUDENT, UserRole.PARENT)
  findMine(@CurrentUser() user: RequestUser) { return this.invoiceService.findMine(user); }

  @Get()
  @Roles(UserRole.SCHOOL_ADMIN, UserRole.ACCOUNTANT, UserRole.SUPER_ADMIN)
  findAll(

    @CurrentUser() user: RequestUser,
    @Query() query: PaginationQueryDto,
  ) {
    return this.invoiceService.findAll(user, query);
  }

  @Get(':id')
  @Roles(UserRole.SCHOOL_ADMIN, UserRole.ACCOUNTANT, UserRole.SUPER_ADMIN)
  findOne(
    @CurrentUser() user: RequestUser,
    @Param('id') id: string,
  ) {
    return this.invoiceService.findOne(
      user,
      id,
    );
  }

  @Patch(':id')
  @Roles(UserRole.SCHOOL_ADMIN)
  update(
    @CurrentUser() user: RequestUser,
    @Param('id') id: string,
    @Body() dto: UpdateInvoiceDto,
  ) {
    return this.invoiceService.update(
      user,
      id,
      dto,
    );
  }

  @Post(':id/cancel')
  @Roles(UserRole.SCHOOL_ADMIN)
  cancel(
    @CurrentUser() user: RequestUser,
    @Param('id') id: string,
  ) {
    return this.invoiceService.cancel(user, id);
  }

  @Delete(':id')
  @Roles(UserRole.SCHOOL_ADMIN)
  remove(
    @CurrentUser() user: RequestUser,
    @Param('id') id: string,
  ) {
    return this.invoiceService.remove(
      user,
      id,
    );
  }
}