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

import { InvoiceService } from './invoice.service';

import {
  CurrentUser,
  type RequestUser,
} from '../auth/decorator/current-user.decorator';

import { CreateInvoiceDto } from './dto/create-invoice.dto';
import { UpdateInvoiceDto } from './dto/update-invoice.dto';

@Controller('invoices')
export class InvoiceController {
  constructor(
    private readonly invoiceService: InvoiceService,
  ) {}

  @Post()
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
  findMine(@CurrentUser() user: RequestUser) { return this.invoiceService.findMine(user); }

  @Get()
  findAll(

    @CurrentUser() user: RequestUser,
    @Query() query: PaginationQueryDto,
  ) {
    return this.invoiceService.findAll(user, query);
  }

  @Get(':id')
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

  @Delete(':id')
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