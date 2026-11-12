import { Injectable, Logger } from '@nestjs/common';
import {
  Cron,
  CronExpression,
} from '@nestjs/schedule';
import {
  InvoiceStatus,
  MessageChannel,
  MessageStatus,
  Prisma,
  SchoolStatus,
  SubscriptionStatus,
  UserRole,
} from '@prisma/client';
import {
  addDaysToDateKey,
  daysBetweenDateKeys,
  localDateKey,
  startOfLocalDate,
  zonedDateParts,
} from '../common/timezone';
import { OverdueInvoicesService } from '../billing/overdue-invoices.service';
import { PrismaService } from '../prisma/prisma.service';
import { MessageDeliveryService } from '../notifications/message-delivery.service';
import { SubscriptionLifecycleService } from '../subscriptions/subscription-lifecycle.service';

const LAGOS_TIME_ZONE = 'Africa/Lagos';
const SENT_MESSAGE_RETENTION_DAYS = 90;
const REMINDER_SEND_WINDOW_MINUTES = 5;

@Injectable()
export class ScheduledJobsService {
  private readonly logger = new Logger(ScheduledJobsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly overdueInvoices: OverdueInvoicesService,
    private readonly subscriptionLifecycle: SubscriptionLifecycleService,
    private readonly messageDelivery: MessageDeliveryService,
  ) {}

  @Cron(CronExpression.EVERY_MINUTE, {
    name: 'dispatch-pending-messages',
    timeZone: 'UTC',
  })
  async dispatchPendingMessages() {
    await this.runJob('dispatch-pending-messages', () =>
      this.messageDelivery.dispatchPendingBatch(),
    );
  }

  @Cron('0 6 * * *', {
    name: 'mark-overdue-invoices',
    timeZone: LAGOS_TIME_ZONE,
  })
  async markOverdueInvoices() {
    await this.runJob('mark-overdue-invoices', () =>
      this.overdueInvoices.markOverdue(),
    );
  }

  @Cron('0 3 * * *', {
    name: 'clean-expired-refresh-tokens',
    timeZone: LAGOS_TIME_ZONE,
  })
  async cleanExpiredRefreshTokens() {
    await this.runJob('clean-expired-refresh-tokens', async () => {
      const result = await this.prisma.refreshToken.deleteMany({
        where: { expiresAt: { lt: new Date() } },
      });
      return { deleted: result.count };
    });
  }

  @Cron('30 3 * * 0', {
    name: 'clean-old-sent-messages',
    timeZone: LAGOS_TIME_ZONE,
  })
  async cleanOldSentMessages() {
    await this.runJob('clean-old-sent-messages', async () => {
      const cutoff = new Date(
        Date.now() - SENT_MESSAGE_RETENTION_DAYS * 24 * 60 * 60 * 1000,
      );
      const result = await this.prisma.messageDelivery.deleteMany({
        where: {
          status: MessageStatus.SENT,
          sentAt: { lt: cutoff },
        },
      });
      return { deleted: result.count };
    });
  }

  @Cron('0 * * * *', {
    name: 'process-subscription-lifecycle',
    timeZone: 'UTC',
  })
  async processSubscriptionLifecycle() {
    await this.runJob('process-subscription-lifecycle', () =>
      this.subscriptionLifecycle.processDueSubscriptions(),
    );
  }

  @Cron(CronExpression.EVERY_MINUTE, {
    name: 'queue-school-local-reminders',
    timeZone: 'UTC',
  })
  async queueSchoolLocalReminders() {
    const now = new Date();
    const schools = await this.prisma.school.findMany({
      where: { status: SchoolStatus.ACTIVE },
      select: {
        id: true,
        name: true,
        timezone: true,
        email: true,
        currency: true,
        messageChannels: true,
      },
    });

    await this.runJob('queue-school-local-reminders', async () => {
      let eligibleSchools = 0;
      for (const school of schools) {
        try {
          const localTime = zonedDateParts(now, school.timezone);
          if (
            localTime.hour !== 7 ||
            localTime.minute >= REMINDER_SEND_WINDOW_MINUTES ||
            !school.messageChannels.includes(MessageChannel.EMAIL)
          ) {
            continue;
          }

          eligibleSchools++;
          const today = localDateKey(now, school.timezone);
          await this.queueInvoiceReminders(school, today);
          await this.queueSubscriptionReminders(school, today);
        } catch (error) {
          this.logger.error(
            `Failed to queue reminders for school ${school.id}: ${
              error instanceof Error ? error.message : String(error)
            }`,
            error instanceof Error ? error.stack : undefined,
          );
        }
      }

      return { eligibleSchools };
    });
  }

  private async queueInvoiceReminders(
    school: {
      id: string;
      name: string;
      timezone: string;
      currency: string;
    },
    today: string,
  ) {
    const from = startOfLocalDate(
      addDaysToDateKey(today, -7),
      'UTC',
    );
    const until = startOfLocalDate(
      addDaysToDateKey(today, 4),
      'UTC',
    );
    const invoices = await this.prisma.invoice.findMany({
      where: {
        schoolId: school.id,
        status: {
          in: [
            InvoiceStatus.UNPAID,
            InvoiceStatus.PARTIALLY_PAID,
            InvoiceStatus.OVERDUE,
          ],
        },
        dueDate: { gte: from, lt: until },
      },
      include: {
        student: {
          select: {
            firstName: true,
            lastName: true,
            email: true,
            user: { select: { email: true } },
            guardians: {
              select: {
                parent: {
                  select: {
                    email: true,
                    user: { select: { email: true } },
                  },
                },
              },
            },
          },
        },
      },
    });

    const messages: Prisma.MessageDeliveryCreateManyInput[] = [];
    for (const invoice of invoices) {
      if (!invoice.dueDate) continue;

      const dueDate = localDateKey(invoice.dueDate, 'UTC');
      const daysUntilDue = daysBetweenDateKeys(today, dueDate);
      const reminder = this.invoiceReminderType(daysUntilDue);
      if (!reminder) continue;

      const recipients = new Set<string>();
      if (invoice.student.email) recipients.add(invoice.student.email);
      if (invoice.student.user?.email) {
        recipients.add(invoice.student.user.email);
      }
      for (const guardian of invoice.student.guardians) {
        if (guardian.parent.email) recipients.add(guardian.parent.email);
        if (guardian.parent.user?.email) {
          recipients.add(guardian.parent.user.email);
        }
      }

      for (const recipient of recipients) {
        messages.push({
          schoolId: school.id,
          channel: MessageChannel.EMAIL,
          to: recipient,
          subject: `Invoice reminder: ${invoice.invoiceNumber}`,
          body: [
            `Hello,`,
            ``,
            `This is a reminder about invoice ${invoice.invoiceNumber} for ${invoice.student.firstName} ${invoice.student.lastName}.`,
            `Amount due: ${school.currency} ${invoice.amount.minus(invoice.amountPaid).toFixed(2)}`,
            `Due date: ${dueDate}`,
            `Reminder: ${reminder}`,
            ``,
            `Regards,`,
            school.name,
          ].join('\n'),
          event: 'invoice-reminder',
          dedupeKey: `invoice:${invoice.id}:${dueDate}:${reminder}:${recipient.toLowerCase()}`,
        });
      }
    }

    return this.messageDelivery.enqueue(messages);
  }

  private invoiceReminderType(daysUntilDue: number): string | null {
    if (daysUntilDue === 3) return 'due-in-3-days';
    if (daysUntilDue === 0) return 'due-today';
    if (daysUntilDue === -7) return '7-days-overdue';
    return null;
  }

  private async queueSubscriptionReminders(
    school: {
      id: string;
      name: string;
      timezone: string;
      email: string | null;
    },
    today: string,
  ) {
    const from = startOfLocalDate(today, school.timezone);
    const until = startOfLocalDate(
      addDaysToDateKey(today, 8),
      school.timezone,
    );
    const subscriptions = await this.prisma.subscription.findMany({
      where: {
        schoolId: school.id,
        status: { in: [SubscriptionStatus.ACTIVE, SubscriptionStatus.TRIAL] },
        endDate: { gte: from, lt: until },
      },
      include: {
        plan: { select: { name: true } },
        school: {
          select: {
            memberships: {
              where: { role: UserRole.SCHOOL_ADMIN },
              select: { user: { select: { email: true } } },
            },
          },
        },
      },
    });

    const messages: Prisma.MessageDeliveryCreateManyInput[] = [];
    for (const subscription of subscriptions) {
      const endDate = localDateKey(subscription.endDate, school.timezone);
      const daysUntilEnd = daysBetweenDateKeys(today, endDate);
      if (![7, 3, 1].includes(daysUntilEnd)) continue;

      const recipients = new Set<string>();
      if (school.email) recipients.add(school.email);
      for (const membership of subscription.school.memberships) {
        if (membership.user.email) recipients.add(membership.user.email);
      }

      for (const recipient of recipients) {
        messages.push({
          schoolId: school.id,
          channel: MessageChannel.EMAIL,
          to: recipient,
          subject: `Subscription ending soon: ${subscription.plan.name}`,
          body: [
            `Hello,`,
            ``,
            `Your ${subscription.plan.name} subscription is scheduled to end on ${endDate}.`,
            `Please review your subscription to avoid interruption to your school's service.`,
            ``,
            `Regards,`,
            school.name,
          ].join('\n'),
          event: 'subscription-reminder',
          dedupeKey: `subscription:${subscription.id}:${endDate}:${daysUntilEnd}:${recipient.toLowerCase()}`,
        });
      }
    }

    return this.messageDelivery.enqueue(messages);
  }

  private async runJob(
    name: string,
    work: () => Promise<unknown>,
  ) {
    try {
      const result = await work();
      this.logger.log(`${name} completed: ${JSON.stringify(result)}`);
    } catch (error) {
      this.logger.error(
        `${name} failed: ${error instanceof Error ? error.message : String(error)}`,
        error instanceof Error ? error.stack : undefined,
      );
    }
  }
}

