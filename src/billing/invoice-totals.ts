import { InvoiceStatus, PaymentStatus, Prisma } from '@prisma/client';

import { invoiceState } from './billing.logic';

// Re-count what an invoice has really received and set its status.
// Used after a refund, and by the nightly job that marks overdue invoices.
export async function recalculateInvoice(
  tx: Prisma.TransactionClient,
  invoiceId: string,
  now: Date = new Date(),
) {
  const invoice = await tx.invoice.findUnique({ where: { id: invoiceId } });

  if (!invoice || invoice.status === InvoiceStatus.CANCELLED) {
    return;
  }

  const payments = await tx.payment.findMany({
    where: { invoiceId, status: PaymentStatus.SUCCESSFUL },
    select: { amount: true },
  });

  const amountPaid = payments.reduce(
    (total, payment) => total.plus(payment.amount),
    new Prisma.Decimal(0),
  );

  const status = invoiceState({
    amount: Number(invoice.amount),
    amountPaid: Number(amountPaid),
    dueDate: invoice.dueDate,
    now,
  });

  await tx.invoice.update({
    where: { id: invoiceId },
    data: { amountPaid, status: status as InvoiceStatus },
  });
}
