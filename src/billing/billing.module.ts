import { Module } from '@nestjs/common';

import { StudentAccessModule } from '../student-access/student-access.module';
import { BulkInvoicingService } from './bulk-invoicing.service';
import {
  DiscountsController,
  FeeScopeController,
  InstallmentsController,
  InvoiceBatchesController,
  ReceiptsController,
  RefundsController,
} from './billing.controllers';
import { DiscountsService } from './discounts.service';
import { FeeScopeService } from './fee-scope.service';
import { InstallmentsService } from './installments.service';
import { OverdueInvoicesService } from './overdue-invoices.service';
import { PaystackRefundClient } from './paystack-refund.client';
import { ReceiptsService } from './receipts.service';
import { RefundsService } from './refunds.service';

@Module({
  imports: [StudentAccessModule],
  controllers: [
    DiscountsController,
    InvoiceBatchesController,
    FeeScopeController,
    InstallmentsController,
    ReceiptsController,
    RefundsController,
  ],
  providers: [
    DiscountsService,
    BulkInvoicingService,
    FeeScopeService,
    InstallmentsService,
    ReceiptsService,
    RefundsService,
    PaystackRefundClient,
    OverdueInvoicesService,
  ],
  exports: [OverdueInvoicesService],
})
export class BillingModule {}
