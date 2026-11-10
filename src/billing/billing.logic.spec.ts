import { describe, expect, it } from '@jest/globals';
import { allocateInstallments, applyDiscounts, feeAppliesTo, formatMoney, invoiceState, receiptNumber, validateInstallmentPlan } from './billing.logic';

const d = (s: string) => new Date(s);

describe('applyDiscounts', () => {
  it('no discounts = full price', () => { expect(applyDiscounts(50000, [])).toEqual({ discountAmount: 0, netAmount: 50000, applied: [] }); });
  it('a percentage comes off the original amount', () => {
    expect(applyDiscounts(50000, [{ name: 'Sibling', type: 'PERCENTAGE', value: 10 }])).toMatchObject({ discountAmount: 5000, netAmount: 45000 });
  });
  it('a fixed discount is subtracted as it is', () => {
    expect(applyDiscounts(50000, [{ name: 'Staff child', type: 'FIXED', value: 7500 }])).toMatchObject({ discountAmount: 7500, netAmount: 42500 });
  });
  it('percentages do NOT compound (10% + 10% of 50,000 = 10,000, not 9,500)', () => {
    expect(applyDiscounts(50000, [{ name: 'a', type: 'PERCENTAGE', value: 10 }, { name: 'b', type: 'PERCENTAGE', value: 10 }]).discountAmount).toBe(10000);
  });
  it('mixed discounts add up and are listed one by one', () => {
    const r = applyDiscounts(100000, [{ name: 'Scholarship', type: 'PERCENTAGE', value: 25 }, { name: 'Sibling', type: 'FIXED', value: 5000 }]);
    expect(r).toEqual({ discountAmount: 30000, netAmount: 70000, applied: [{ name: 'Scholarship', amount: 25000 }, { name: 'Sibling', amount: 5000 }] });
  });
  it('can never take more than the fee (net is 0, never negative)', () => {
    expect(applyDiscounts(20000, [{ name: 'Full', type: 'PERCENTAGE', value: 100 }, { name: 'More', type: 'FIXED', value: 5000 }])).toMatchObject({ discountAmount: 20000, netAmount: 0 });
  });
  it('rounds to kobo', () => {
    expect(applyDiscounts(33333, [{ name: 'x', type: 'PERCENTAGE', value: 10 }])).toMatchObject({ discountAmount: 3333.3, netAmount: 29999.7 });
  });
  it('ignores zero or negative values', () => {
    expect(applyDiscounts(1000, [{ name: 'a', type: 'FIXED', value: 0 }, { name: 'b', type: 'FIXED', value: -5 }]).applied).toEqual([]);
  });
});

describe('feeAppliesTo', () => {
  const student = { classId: 'jss1a', levelId: 'jss1' };
  it('a fee for one class applies to that class only', () => {
    expect(feeAppliesTo({ classId: 'jss1a' }, student)).toBe(true);
    expect(feeAppliesTo({ classId: 'jss1b' }, student)).toBe(false);
  });
  it('a fee for a level applies to every class in the level', () => {
    expect(feeAppliesTo({ levelId: 'jss1' }, student)).toBe(true);
    expect(feeAppliesTo({ levelId: 'jss2' }, student)).toBe(false);
  });
  it('a student whose class has no level is not caught by a level fee', () => {
    expect(feeAppliesTo({ levelId: 'jss1' }, { classId: 'x', levelId: null })).toBe(false);
  });
  it('a fee with no scope applies to everyone', () => { expect(feeAppliesTo({}, student)).toBe(true); expect(feeAppliesTo({ classId: null, levelId: null }, { classId: 'x' })).toBe(true); });
  it('the class wins when both are somehow set', () => { expect(feeAppliesTo({ classId: 'jss1b', levelId: 'jss1' }, student)).toBe(false); });
});

describe('invoiceState', () => {
  const now = d('2026-11-10T15:00:00Z');
  it('fully paid is PAID, even if overdue', () => { expect(invoiceState({ amount: 100, amountPaid: 100, dueDate: d('2026-01-01'), now })).toBe('PAID'); });
  it('overpaid is PAID', () => { expect(invoiceState({ amount: 100, amountPaid: 120, now })).toBe('PAID'); });
  it('nothing paid, due in the future = UNPAID', () => { expect(invoiceState({ amount: 100, amountPaid: 0, dueDate: d('2026-12-01'), now })).toBe('UNPAID'); });
  it('part paid, not yet due = PARTIALLY_PAID', () => { expect(invoiceState({ amount: 100, amountPaid: 40, dueDate: d('2026-12-01'), now })).toBe('PARTIALLY_PAID'); });
  it('due TODAY is not overdue yet', () => { expect(invoiceState({ amount: 100, amountPaid: 0, dueDate: d('2026-11-10T00:00:00Z'), now })).toBe('UNPAID'); });
  it('due yesterday and unpaid = OVERDUE', () => { expect(invoiceState({ amount: 100, amountPaid: 0, dueDate: d('2026-11-09'), now })).toBe('OVERDUE'); });
  it('due yesterday and part paid = OVERDUE', () => { expect(invoiceState({ amount: 100, amountPaid: 40, dueDate: d('2026-11-09'), now })).toBe('OVERDUE'); });
  it('no due date can never be overdue', () => { expect(invoiceState({ amount: 100, amountPaid: 0, now })).toBe('UNPAID'); });
  it('ignores floating point noise (0.1 + 0.2 pays 0.3)', () => { expect(invoiceState({ amount: 0.3, amountPaid: 0.1 + 0.2, now })).toBe('PAID'); });
});

describe('validateInstallmentPlan', () => {
  const plan = [{ dueDate: d('2026-10-01'), amount: 20000 }, { dueDate: d('2026-11-01'), amount: 15000 }, { dueDate: d('2026-12-01'), amount: 15000 }];
  it('a good plan has no problems', () => { expect(validateInstallmentPlan(50000, plan)).toEqual([]); });
  it('must add up to the invoice', () => { expect(validateInstallmentPlan(60000, plan)).toEqual(['The installments add up to 50000 but the invoice is 60000']); });
  it('needs at least one installment, at most 12', () => {
    expect(validateInstallmentPlan(100, [])).toEqual(['A payment plan needs at least one installment']);
    const many = Array.from({ length: 13 }, (_, i) => ({ dueDate: new Date(Date.UTC(2026, i, 1)), amount: 10 }));
    expect(validateInstallmentPlan(130, many).join()).toMatch(/at most 12/);
  });
  it('due dates must go forward', () => {
    expect(validateInstallmentPlan(50000, [plan[0], { dueDate: d('2026-10-01'), amount: 30000 }]).join()).toMatch(/must be due after installment 1/);
  });
  it('amounts must be positive and dates real', () => {
    expect(validateInstallmentPlan(100, [{ dueDate: d('2026-10-01'), amount: 0 }, { dueDate: new Date('nope'), amount: 100 }]).join()).toMatch(/amount must be more than 0/);
    expect(validateInstallmentPlan(100, [{ dueDate: new Date('nope'), amount: 100 }]).join()).toMatch(/not valid/);
  });
});

describe('allocateInstallments', () => {
  const items = [{ number: 1, dueDate: d('2026-10-01'), amount: 20000 }, { number: 2, dueDate: d('2026-11-01'), amount: 15000 }, { number: 3, dueDate: d('2026-12-01'), amount: 15000 }];
  const now = d('2026-11-10T00:00:00Z');
  it('payments fill the oldest installment first', () => {
    const r = allocateInstallments(items, 25000, now);
    expect(r.map((x) => [x.paid, x.status])).toEqual([[20000, 'PAID'], [5000, 'OVERDUE'], [0, 'UPCOMING']]);
  });
  it('nothing paid: old ones are overdue, future ones upcoming', () => {
    expect(allocateInstallments(items, 0, now).map((x) => x.status)).toEqual(['OVERDUE', 'OVERDUE', 'UPCOMING']);
  });
  it('a part-paid installment that is not due yet is PARTIAL', () => {
    expect(allocateInstallments(items, 40000, now).map((x) => x.status)).toEqual(['PAID', 'PAID', 'PARTIAL']);
  });
  it('everything paid', () => { expect(allocateInstallments(items, 50000, now).every((x) => x.status === 'PAID')).toBe(true); });
  it('more than the plan never overfills an installment', () => { expect(allocateInstallments(items, 99999, now).map((x) => x.paid)).toEqual([20000, 15000, 15000]); });
  it('works whatever order the rows arrive in', () => { expect(allocateInstallments([items[2], items[0], items[1]], 20000, now)[0]).toMatchObject({ number: 1, status: 'PAID' }); });
});

describe('receipt helpers', () => {
  it('receipt number is stable and readable', () => {
    expect(receiptNumber('3f2a91bc-1111-4222-8333-444455556666', d('2026-11-09T10:00:00Z'))).toBe('RCPT-2026-3F2A91BC');
  });
  it('money shows the currency code, 2 decimals and thousands separators', () => {
    expect(formatMoney(1500000)).toBe('NGN 1,500,000.00');
    expect(formatMoney(49.5, 'USD')).toBe('USD 49.50');
  });
});
