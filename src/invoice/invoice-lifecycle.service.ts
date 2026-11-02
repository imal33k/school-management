import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { InvoiceStatus } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class InvoiceLifecycleService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(InvoiceLifecycleService.name);
  private timer?: NodeJS.Timeout;

  constructor(private readonly prisma: PrismaService) {}

  onModuleInit() {
    void this.markDueInvoicesOverdue();
    this.timer = setInterval(
      () => void this.markDueInvoicesOverdue(),
      15 * 60 * 1000,
    );
    this.timer.unref();
  }

  onModuleDestroy() {
    if (this.timer) clearInterval(this.timer);
  }

  private async markDueInvoicesOverdue() {
    try {
      await this.prisma.invoice.updateMany({
        where: {
          status: {
            in: [InvoiceStatus.UNPAID, InvoiceStatus.PARTIALLY_PAID],
          },
          dueDate: { lte: new Date() },
        },
        data: { status: InvoiceStatus.OVERDUE },
      });
    } catch (error) {
      this.logger.error(
        'Failed to mark due invoices overdue',
        error instanceof Error ? error.stack : String(error),
      );
    }
  }
}
