import { Module } from '@nestjs/common';
import { InvoiceService } from './invoice.service';
import { InvoiceController } from './invoice.controller';
import { InvoiceLifecycleService } from './invoice-lifecycle.service';

@Module({
  controllers: [InvoiceController],
  providers: [InvoiceService, InvoiceLifecycleService],
})
export class InvoiceModule {}
