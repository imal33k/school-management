// Pure money rules for fees. No database and no Nest in this file.

import { roundTo2 } from '../grading/grading.logic';

// ---------- Discounts ----------

export interface DiscountRule {
  name: string;
  type: 'PERCENTAGE' | 'FIXED';
  value: number;
}

export interface DiscountResult {
  discountAmount: number;
  netAmount: number;
  applied: { name: string; amount: number }[];
}

// Percentages are taken off the ORIGINAL amount (they do not compound),
// fixed discounts are subtracted as they are, and the total discount can
// never be more than the fee itself.
export function applyDiscounts(
  baseAmount: number,
  rules: DiscountRule[],
): DiscountResult {
  const applied: { name: string; amount: number }[] = [];
  let total = 0;

  for (const rule of rules) {
    const raw =
      rule.type === 'PERCENTAGE' ? (baseAmount * rule.value) / 100 : rule.value;
    const amount = roundTo2(Math.max(0, raw));

    if (amount > 0) {
      applied.push({ name: rule.name, amount });
      total += amount;
    }
  }

  const discountAmount = roundTo2(Math.min(total, baseAmount));

  return {
    discountAmount,
    netAmount: roundTo2(baseAmount - discountAmount),
    applied,
  };
}

// ---------- Who a fee applies to ----------

export interface FeeScope {
  classId?: string | null;
  levelId?: string | null;
}

// A fee for one class applies to that class only, a fee for a level applies
// to every class in that level, and a fee with neither applies to everyone.
export function feeAppliesTo(
  fee: FeeScope,
  student: { classId: string; levelId?: string | null },
): boolean {
  if (fee.classId) {
    return fee.classId === student.classId;
  }

  if (fee.levelId) {
    return !!student.levelId && fee.levelId === student.levelId;
  }

  return true;
}

// ---------- Invoice status ----------

export type InvoiceState = 'UNPAID' | 'PARTIALLY_PAID' | 'PAID' | 'OVERDUE';

// A date with the time cut off (UTC), so "due today" is not overdue yet
export function startOfDayUtc(date: Date): Date {
  return new Date(
    Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()),
  );
}

export function invoiceState(input: {
  amount: number;
  amountPaid: number;
  dueDate?: Date | null;
  now?: Date;
}): InvoiceState {
  const amount = roundTo2(input.amount);
  const paid = roundTo2(input.amountPaid);

  if (paid >= amount) {
    return 'PAID';
  }

  const today = startOfDayUtc(input.now ?? new Date());

  if (input.dueDate && startOfDayUtc(input.dueDate) < today) {
    return 'OVERDUE';
  }

  return paid > 0 ? 'PARTIALLY_PAID' : 'UNPAID';
}

// ---------- Installment plans ----------

export interface PlanItem {
  dueDate: Date;
  amount: number;
}

export function validateInstallmentPlan(
  invoiceAmount: number,
  items: PlanItem[],
): string[] {
  const errors: string[] = [];

  if (items.length === 0) {
    return ['A payment plan needs at least one installment'];
  }

  if (items.length > 12) {
    errors.push('A payment plan can have at most 12 installments');
  }

  items.forEach((item, index) => {
    if (!(item.amount > 0)) {
      errors.push(`Installment ${index + 1}: amount must be more than 0`);
    }

    if (Number.isNaN(item.dueDate.getTime())) {
      errors.push(`Installment ${index + 1}: the due date is not valid`);
    }

    if (index > 0 && item.dueDate <= items[index - 1].dueDate) {
      errors.push(`Installment ${index + 1}: must be due after installment ${index}`);
    }
  });

  const sum = roundTo2(items.reduce((total, item) => total + item.amount, 0));

  if (Math.abs(sum - roundTo2(invoiceAmount)) >= 0.005) {
    errors.push(
      `The installments add up to ${sum} but the invoice is ${roundTo2(invoiceAmount)}`,
    );
  }

  return errors;
}

export interface InstallmentView {
  number: number;
  dueDate: Date;
  amount: number;
  paid: number;
  status: 'PAID' | 'PARTIAL' | 'OVERDUE' | 'UPCOMING';
}

// Payments fill the installments from the oldest one onwards.
// Nothing is stored per installment, so it can never drift out of step
// with the payments themselves.
export function allocateInstallments(
  items: { number: number; dueDate: Date; amount: number }[],
  amountPaid: number,
  now: Date = new Date(),
): InstallmentView[] {
  let remaining = roundTo2(amountPaid);
  const today = startOfDayUtc(now);

  return [...items]
    .sort((a, b) => a.number - b.number)
    .map((item) => {
      const paid = roundTo2(Math.min(remaining, item.amount));
      remaining = roundTo2(remaining - paid);

      let status: InstallmentView['status'];

      if (paid >= item.amount) {
        status = 'PAID';
      } else if (startOfDayUtc(item.dueDate) < today) {
        status = 'OVERDUE';
      } else {
        status = paid > 0 ? 'PARTIAL' : 'UPCOMING';
      }

      return { ...item, paid, status };
    });
}

// ---------- Receipts ----------

export function receiptNumber(paymentId: string, date: Date): string {
  return `RCPT-${date.getUTCFullYear()}-${paymentId.replace(/-/g, '').slice(0, 8).toUpperCase()}`;
}

// The built-in PDF font has no Naira sign, so show the currency code instead
export function formatMoney(amount: number, currency = 'NGN'): string {
  const text = roundTo2(amount).toLocaleString('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });

  return `${currency} ${text}`;
}
