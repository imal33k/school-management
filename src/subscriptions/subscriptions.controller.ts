import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  Query,
} from '@nestjs/common';

import { SubscriptionsService } from './subscriptions.service';

import { CreateSubscriptionDto } from './dto/create-subscription.dto';
import { UpdateSubscriptionDto } from './dto/update-subscription.dto';
import { UpdateSubscriptionStatusDto } from './dto/update-subscription-status.dto';
import { InitializeSubscriptionPaymentDto } from './dto/initialize-subscription-payment.dto';
import { PaginationQueryDto } from '../common/dto/pagination-query.dto';

import {
  CurrentUser,
  type RequestUser,
} from '../auth/decorator/current-user.decorator';

@Controller('subscriptions')
export class SubscriptionsController {
  constructor(private readonly subscriptionsService: SubscriptionsService) {}

  @Post()
  create(@Body() dto: CreateSubscriptionDto, @CurrentUser() user: RequestUser) {
    return this.subscriptionsService.create(dto, user);
  }

  @Get()
  findAll(@CurrentUser() user: RequestUser) {
    return this.subscriptionsService.findAll(user);
  }

  @Get('me')
  findMine(@CurrentUser() user: RequestUser) {
    return this.subscriptionsService.findMine(user);
  }

  @Get('me/payments')
  findMyPayments(
    @CurrentUser() user: RequestUser,
    @Query() query: PaginationQueryDto,
  ) {
    return this.subscriptionsService.findPaymentsForMine(user, query);
  }

  @Get(':id')
  findOne(@Param('id') id: string, @CurrentUser() user: RequestUser) {
    return this.subscriptionsService.findOne(id, user);
  }

  @Get(':id/payments')
  findPayments(
    @Param('id') id: string,
    @CurrentUser() user: RequestUser,
    @Query() query: PaginationQueryDto,
  ) {
    return this.subscriptionsService.findPayments(id, user, query);
  }

  @Patch(':id')
  update(
    @Param('id') id: string,
    @Body() dto: UpdateSubscriptionDto,
    @CurrentUser() user: RequestUser,
  ) {
    return this.subscriptionsService.update(id, dto, user);
  }

  @Patch(':id/status')
  updateStatus(
    @Param('id') id: string,
    @Body() dto: UpdateSubscriptionStatusDto,
    @CurrentUser() user: RequestUser,
  ) {
    return this.subscriptionsService.updateStatus(id, dto, user);
  }

  @Post(':id/pay')
  pay(
    @Param('id') id: string,
    @Body() dto: InitializeSubscriptionPaymentDto,
    @CurrentUser() user: RequestUser,
  ) {
    return this.subscriptionsService.initializePayment(id, dto, user);
  }

  @Post(':id/cancel')
  cancel(@Param('id') id: string, @CurrentUser() user: RequestUser) {
    return this.subscriptionsService.cancel(id, user);
  }
}
