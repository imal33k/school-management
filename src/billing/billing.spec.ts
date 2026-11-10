import { describe, expect, it, jest, beforeAll, afterAll, beforeEach, afterEach } from '@jest/globals';
import { Test } from '@nestjs/testing';
import { APP_GUARD } from '@nestjs/core';
import { BadGatewayException, BadRequestException, ConflictException, ForbiddenException, NotFoundException, ServiceUnavailableException, ValidationPipe, type INestApplication } from '@nestjs/common';
import request from 'supertest';
import { BulkInvoicingService } from './bulk-invoicing.service';
import { DiscountsService } from './discounts.service';
import { FeeScopeService } from './fee-scope.service';
import { InstallmentsService } from './installments.service';
import { ReceiptsService } from './receipts.service';
import { RefundsService } from './refunds.service';
import { PaystackRefundClient } from './paystack-refund.client';
import { OverdueInvoicesService } from './overdue-invoices.service';
import { DiscountsController, InvoiceBatchesController, FeeScopeController, InstallmentsController, ReceiptsController, RefundsController } from './billing.controllers';
import { BillingModule } from './billing.module';
import { StudentAccessService } from '../student-access/student-access.service';
import { PrismaService } from '../prisma/prisma.service';
import { RolesGuard } from '../auth/guards/roles.guard';

type Fn = (...args: any[]) => Promise<any>;
const mk = () => jest.fn<Fn>();
const prisma: any = {
  term: { findFirst: mk() }, feeStructure: { findMany: mk(), findFirst: mk(), update: mk() }, enrollment: { findMany: mk() },
  invoice: { findMany: mk(), findFirst: mk(), findUnique: mk(), createMany: mk(), update: mk() },
  studentDiscount: { findMany: mk(), findFirst: mk(), create: mk(), update: mk(), delete: mk() },
  student: { findFirst: mk() }, schoolClass: { findFirst: mk() }, classLevel: { findFirst: mk() },
  invoiceInstallment: { findMany: mk(), deleteMany: mk(), createMany: mk() },
  payment: { findFirst: mk(), findUnique: mk(), findMany: mk(), update: mk() },
  refund: { count: mk(), create: mk(), findFirst: mk(), findMany: mk(), update: mk() },
  school: { findUnique: mk() }, auditLog: { create: mk() },
};
prisma.$transaction = jest.fn(async (fn: (tx: any) => Promise<any>) => fn(prisma));

const admin = { id: 'u-admin', role: 'SCHOOL_ADMIN', schoolId: 'school-1' } as any;
const accountant = { id: 'u-acc', role: 'ACCOUNTANT', schoolId: 'school-1' } as any;
const teacher = { id: 'u-t', role: 'TEACHER', schoolId: 'school-1' } as any;
const noSchool = { id: 'x', role: 'SCHOOL_ADMIN' } as any;

const FEE_TUITION = { id: 'f-tuition', schoolId: 'school-1', termId: 't1', name: 'Tuition', amount: 100000, classId: null, levelId: null };
const FEE_LAB = { id: 'f-lab', schoolId: 'school-1', termId: 't1', name: 'Lab', amount: 10000, classId: 'c-ss1', levelId: null };
const FEE_JSS = { id: 'f-jss', schoolId: 'school-1', termId: 't1', name: 'JSS levy', amount: 5000, classId: null, levelId: 'L-jss1' };
const enrol = (studentId: string, classId: string, levelId: string | null = null) => ({ studentId, classId, class: { levelId } });

beforeEach(() => {
  jest.clearAllMocks();
  prisma.term.findFirst.mockResolvedValue({ id: 't1', academicSessionId: 'ses' });
  prisma.feeStructure.findMany.mockResolvedValue([FEE_TUITION]);
  prisma.enrollment.findMany.mockResolvedValue([enrol('s1', 'c-jss1', 'L-jss1'), enrol('s2', 'c-ss1', 'L-ss1')]);
  prisma.invoice.findMany.mockResolvedValue([]);
  prisma.invoice.createMany.mockResolvedValue({ count: 0 });
  prisma.studentDiscount.findMany.mockResolvedValue([]);
  prisma.auditLog.create.mockResolvedValue({});
});

describe('bulk invoicing', () => {
  const service = new BulkInvoicingService(prisma);
  const dto = (over: object = {}) => ({ termId: 't1', ...over }) as any;
  const created = () => prisma.invoice.createMany.mock.calls[0][0].data;

  it('preview counts what would be billed and writes nothing', async () => {
    const out = await service.preview(dto(), admin);
    expect(out).toMatchObject({ students: 2, invoices: 2, willCreate: 2, skippedExisting: 0, fullyWaived: 0, totalBilled: 200000, totalDiscounts: 0 });
    expect(prisma.invoice.createMany).not.toHaveBeenCalled();
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });
  it('creates one invoice per student per fee, unpaid, with unique numbers and the due date', async () => {
    const out = await service.create(dto({ dueDate: '2026-12-01' }), admin);
    expect(out).toMatchObject({ created: 2, totalBilled: 200000 });
    const rows = created();
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({ schoolId: 'school-1', termId: 't1', feeStructureId: 'f-tuition', amount: 100000, amountPaid: 0, status: 'UNPAID', discountAmount: 0, discountNote: null });
    expect(rows[0].dueDate).toEqual(new Date('2026-12-01'));
    expect(new Set(rows.map((r: any) => r.invoiceNumber)).size).toBe(2);
    expect(rows[0].invoiceNumber).toMatch(/^INV-\d{4}-[0-9A-F]{16}$/);
  });
  it('a fee for one class bills only that class; a fee for a level bills that level', async () => {
    prisma.feeStructure.findMany.mockResolvedValue([FEE_LAB, FEE_JSS]);
    await service.create(dto(), admin);
    const pairs = created().map((r: any) => `${r.studentId}:${r.feeStructureId}`).sort();
    expect(pairs).toEqual(['s1:f-jss', 's2:f-lab']);
  });
  it('students who already have that invoice are skipped (no double billing)', async () => {
    prisma.invoice.findMany.mockResolvedValue([{ studentId: 's1', feeStructureId: 'f-tuition' }]);
    const out = await service.create(dto(), admin);
    expect(out).toMatchObject({ created: 1, skippedExisting: 1 });
    expect(created().map((r: any) => r.studentId)).toEqual(['s2']);
  });
  it('cancelled invoices do not count as already billed', async () => {
    await service.preview(dto(), admin);
    expect(prisma.invoice.findMany.mock.calls[0][0].where.status).toEqual({ not: 'CANCELLED' });
  });
  it('applies a student\'s discount and records it on the invoice', async () => {
    prisma.studentDiscount.findMany.mockResolvedValue([{ studentId: 's1', name: 'Scholarship', type: 'PERCENTAGE', value: 25, feeStructureId: null }]);
    await service.create(dto(), admin);
    const s1 = created().find((r: any) => r.studentId === 's1');
    const s2 = created().find((r: any) => r.studentId === 's2');
    expect(s1).toMatchObject({ amount: 75000, discountAmount: 25000, discountNote: 'Scholarship (25000)' });
    expect(s2).toMatchObject({ amount: 100000, discountAmount: 0 });
  });
  it('a discount for ONE fee does not touch the other fees', async () => {
    prisma.feeStructure.findMany.mockResolvedValue([FEE_TUITION, { ...FEE_TUITION, id: 'f-other', amount: 20000 }]);
    prisma.studentDiscount.findMany.mockResolvedValue([{ studentId: 's1', name: 'Tuition aid', type: 'FIXED', value: 10000, feeStructureId: 'f-tuition' }]);
    await service.create(dto(), admin);
    const amounts = Object.fromEntries(created().filter((r: any) => r.studentId === 's1').map((r: any) => [r.feeStructureId, r.amount]));
    expect(amounts).toEqual({ 'f-tuition': 90000, 'f-other': 20000 });
  });
  it('only discounts for this term (or all terms) are considered', async () => {
    await service.preview(dto(), admin);
    expect(prisma.studentDiscount.findMany.mock.calls[0][0].where).toMatchObject({ isActive: true, OR: [{ termId: null }, { termId: 't1' }] });
  });
  it('a 100% scholarship is not billed at all and is counted as waived', async () => {
    prisma.studentDiscount.findMany.mockResolvedValue([{ studentId: 's1', name: 'Full', type: 'PERCENTAGE', value: 100, feeStructureId: null }]);
    const out = await service.create(dto(), admin);
    expect(out).toMatchObject({ created: 1, fullyWaived: 1 });
  });
  it('narrows the students by class or by level', async () => {
    await service.preview(dto({ classId: 'c-jss1' }), admin);
    expect(prisma.enrollment.findMany.mock.calls[0][0].where.class).toMatchObject({ schoolId: 'school-1', id: 'c-jss1' });
    await service.preview(dto({ levelId: 'L-ss1' }), admin);
    expect(prisma.enrollment.findMany.mock.calls[1][0].where.class).toMatchObject({ levelId: 'L-ss1' });
  });
  it('only ACTIVE enrolments of the term\'s session are billed', async () => {
    await service.preview(dto(), admin);
    expect(prisma.enrollment.findMany.mock.calls[0][0].where).toMatchObject({ academicSessionId: 'ses', status: 'ACTIVE' });
  });
  it('class AND level together -> 400', async () => { await expect(service.preview(dto({ classId: 'a', levelId: 'b' }), admin)).rejects.toThrow(BadRequestException); });
  it('term from another school -> 404', async () => { prisma.term.findFirst.mockResolvedValue(null); await expect(service.preview(dto(), admin)).rejects.toThrow(NotFoundException); });
  it('no fee structures -> 409', async () => { prisma.feeStructure.findMany.mockResolvedValue([]); await expect(service.preview(dto(), admin)).rejects.toThrow('no fee structures'); });
  it('a listed fee that is missing -> 404', async () => { await expect(service.preview(dto({ feeStructureIds: ['f-tuition', 'ghost'] }), admin)).rejects.toThrow(NotFoundException); });
  it('nobody enrolled -> 409', async () => { prisma.enrollment.findMany.mockResolvedValue([]); await expect(service.preview(dto(), admin)).rejects.toThrow(ConflictException); });
  it('refuses more than 5000 invoices at once', async () => {
    prisma.enrollment.findMany.mockResolvedValue(Array.from({ length: 5001 }, (_, i) => enrol('s' + i, 'c')));
    await expect(service.preview(dto(), admin)).rejects.toThrow(/limit is 5000/);
  });
  it('nothing to create is not an error: created 0 and no write', async () => {
    prisma.invoice.findMany.mockResolvedValue([{ studentId: 's1', feeStructureId: 'f-tuition' }, { studentId: 's2', feeStructureId: 'f-tuition' }]);
    expect(await service.create(dto(), admin)).toMatchObject({ created: 0, skippedExisting: 2 });
    expect(prisma.invoice.createMany).not.toHaveBeenCalled();
  });
  it('the whole batch is one transaction and is written to the audit log', async () => {
    await service.create(dto(), admin);
    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
    expect(prisma.auditLog.create.mock.calls[0][0].data).toMatchObject({ action: 'invoices.bulk_created', userId: 'u-admin' });
  });
  it('everything is looked up inside the user\'s own school', async () => {
    await service.preview(dto(), admin);
    expect(prisma.term.findFirst.mock.calls[0][0].where.academicSession).toEqual({ schoolId: 'school-1' });
    expect(prisma.feeStructure.findMany.mock.calls[0][0].where.schoolId).toBe('school-1');
    await expect(service.preview(dto(), noSchool)).rejects.toThrow(ForbiddenException);
  });
});

describe('discounts', () => {
  const service = new DiscountsService(prisma);
  beforeEach(() => {
    prisma.student.findFirst.mockResolvedValue({ id: 's1' });
    prisma.studentDiscount.create.mockImplementation(async (a: any) => ({ id: 'd1', ...a.data }));
    prisma.studentDiscount.update.mockImplementation(async (a: any) => ({ id: a.where.id, ...a.data }));
  });
  const body = (over: object = {}) => ({ studentId: 's1', name: ' Sibling ', type: 'PERCENTAGE', value: 10, ...over }) as any;
  it('creates a trimmed discount for a student of this school', async () => {
    expect(await service.create(body(), admin)).toMatchObject({ schoolId: 'school-1', studentId: 's1', name: 'Sibling', type: 'PERCENTAGE', value: 10, feeStructureId: null, termId: null });
  });
  it('a percentage over 100 -> 400', async () => { await expect(service.create(body({ value: 150 }), admin)).rejects.toThrow(BadRequestException); });
  it('a fixed amount over 100 is fine', async () => { await expect(service.create(body({ type: 'FIXED', value: 5000 }), admin)).resolves.toBeTruthy(); });
  it('student from another school -> 404', async () => { prisma.student.findFirst.mockResolvedValue(null); await expect(service.create(body(), admin)).rejects.toThrow(NotFoundException); expect(prisma.student.findFirst.mock.calls[0][0].where).toEqual({ id: 's1', schoolId: 'school-1' }); });
  it('fee structure or term from another school -> 404', async () => {
    prisma.feeStructure.findFirst.mockResolvedValue(null);
    await expect(service.create(body({ feeStructureId: 'f' }), admin)).rejects.toThrow(NotFoundException);
    prisma.feeStructure.findFirst.mockResolvedValue({ id: 'f' }); prisma.term.findFirst.mockResolvedValue(null);
    await expect(service.create(body({ feeStructureId: 'f', termId: 't' }), admin)).rejects.toThrow(NotFoundException);
  });
  it('blank name -> 400', async () => { await expect(service.create(body({ name: '   ' }), admin)).rejects.toThrow(BadRequestException); });
  it('updating a percentage discount to over 100 -> 400 (uses the saved type)', async () => {
    prisma.studentDiscount.findFirst.mockResolvedValue({ id: 'd1', type: 'PERCENTAGE' });
    await expect(service.update('d1', { value: 120 } as any, admin)).rejects.toThrow(BadRequestException);
  });
  it('can switch a discount off', async () => {
    prisma.studentDiscount.findFirst.mockResolvedValue({ id: 'd1', type: 'FIXED' });
    expect(await service.update('d1', { isActive: false } as any, admin)).toMatchObject({ isActive: false });
  });
  it('another school\'s discount -> 404 on update and delete', async () => {
    prisma.studentDiscount.findFirst.mockResolvedValue(null);
    await expect(service.update('d9', { isActive: false } as any, admin)).rejects.toThrow(NotFoundException);
    await expect(service.remove('d9', admin)).rejects.toThrow(NotFoundException);
    expect(prisma.studentDiscount.delete).not.toHaveBeenCalled();
  });
});

describe('fee scope', () => {
  const service = new FeeScopeService(prisma);
  beforeEach(() => {
    prisma.feeStructure.findFirst.mockResolvedValue({ id: 'f1' });
    prisma.schoolClass.findFirst.mockResolvedValue({ id: 'c1' });
    prisma.classLevel.findFirst.mockResolvedValue({ id: 'L1' });
    prisma.feeStructure.update.mockImplementation(async (a: any) => ({ id: 'f1', ...a.data }));
  });
  it('sets a class scope and clears the level', async () => { expect(await service.setScope('f1', { classId: 'c1' }, admin)).toMatchObject({ classId: 'c1', levelId: null }); });
  it('sets a level scope', async () => { expect(await service.setScope('f1', { levelId: 'L1' }, admin)).toMatchObject({ classId: null, levelId: 'L1' }); });
  it('an empty body makes the fee apply to everyone again', async () => { expect(await service.setScope('f1', {}, admin)).toMatchObject({ classId: null, levelId: null }); });
  it('class AND level -> 400', async () => { await expect(service.setScope('f1', { classId: 'c1', levelId: 'L1' }, admin)).rejects.toThrow(BadRequestException); });
  it('class, level or fee from another school -> 404', async () => {
    prisma.schoolClass.findFirst.mockResolvedValue(null); await expect(service.setScope('f1', { classId: 'x' }, admin)).rejects.toThrow(NotFoundException);
    prisma.classLevel.findFirst.mockResolvedValue(null); await expect(service.setScope('f1', { levelId: 'x' }, admin)).rejects.toThrow(NotFoundException);
    prisma.feeStructure.findFirst.mockResolvedValue(null); await expect(service.setScope('nope', {}, admin)).rejects.toThrow(NotFoundException);
  });
});

describe('installments', () => {
  const access = { assertCanView: jest.fn<Fn>() };
  const service = new InstallmentsService(prisma, access as unknown as StudentAccessService);
  const invoice = { id: 'inv1', studentId: 's1', invoiceNumber: 'INV-1', amount: 50000, amountPaid: 25000, status: 'PARTIALLY_PAID', dueDate: null };
  const plan = { items: [{ dueDate: '2026-10-01', amount: 20000 }, { dueDate: '2026-11-01', amount: 15000 }, { dueDate: '2026-12-01', amount: 15000 }] } as any;
  beforeEach(() => { access.assertCanView.mockReset().mockResolvedValue({ schoolId: 'school-1' }); prisma.invoice.findFirst.mockResolvedValue(invoice); prisma.invoiceInstallment.findMany.mockResolvedValue([]); });

  it('saves a plan that adds up to the invoice, numbered 1, 2, 3', async () => {
    await service.setPlan('inv1', plan, admin);
    expect(prisma.invoiceInstallment.deleteMany).toHaveBeenCalledWith({ where: { invoiceId: 'inv1' } });
    expect(prisma.invoiceInstallment.createMany.mock.calls[0][0].data.map((r: any) => [r.number, r.amount])).toEqual([[1, 20000], [2, 15000], [3, 15000]]);
  });
  it('a plan that does not add up is rejected with the reason, and the old plan is kept', async () => {
    const err: any = await service.setPlan('inv1', { items: [{ dueDate: '2026-10-01', amount: 20000 }] } as any, admin).catch((e) => e);
    expect(err).toBeInstanceOf(BadRequestException);
    expect(err.getResponse().errors[0]).toMatch(/add up to 20000 but the invoice is 50000/);
    expect(prisma.invoiceInstallment.deleteMany).not.toHaveBeenCalled();
  });
  it.each(['PAID', 'CANCELLED'])('no plan on a %s invoice -> 409', async (status) => {
    prisma.invoice.findFirst.mockResolvedValue({ ...invoice, status });
    await expect(service.setPlan('inv1', plan, admin)).rejects.toThrow(ConflictException);
  });
  it('shows each installment with how much is paid (oldest first)', async () => {
    prisma.invoiceInstallment.findMany.mockResolvedValue([
      { number: 1, dueDate: new Date('2099-01-01'), amount: 20000 }, { number: 2, dueDate: new Date('2099-02-01'), amount: 30000 },
    ]);
    const out = await service.getPlan('inv1', admin);
    expect(out.installments.map((i) => [i.paid, i.status])).toEqual([[20000, 'PAID'], [5000, 'PARTIAL']]);
    expect(out.invoice).toMatchObject({ amount: 50000, amountPaid: 25000 });
  });
  it('viewing checks that the person may see THIS student (finance staff, or the student/parent)', async () => {
    await service.getPlan('inv1', admin);
    expect(access.assertCanView).toHaveBeenCalledWith(admin, 's1', ['SCHOOL_ADMIN', 'ACCOUNTANT']);
    access.assertCanView.mockRejectedValue(new NotFoundException('Student not found'));
    await expect(service.getPlan('inv1', { id: 'p', role: 'PARENT', schoolId: 'school-1' } as any)).rejects.toThrow(NotFoundException);
  });
  it('invoice from another school -> 404', async () => {
    prisma.invoice.findFirst.mockResolvedValue(null);
    await expect(service.getPlan('x', admin)).rejects.toThrow(NotFoundException);
    expect(prisma.invoice.findFirst.mock.calls[0][0].where).toEqual({ id: 'x', schoolId: 'school-1' });
  });
});

describe('receipts', () => {
  const access = { assertCanView: jest.fn<Fn>() };
  const service = new ReceiptsService(prisma, access as unknown as StudentAccessService);
  const payment = (over: object = {}) => ({
    id: '3f2a91bc-1111-4222-8333-444455556666', studentId: 's1', status: 'SUCCESSFUL', provider: 'PAYSTACK', reference: 'REF123', amount: 25000,
    paidAt: new Date('2026-11-09T10:00:00Z'), createdAt: new Date('2026-11-09T09:00:00Z'),
    student: { firstName: 'Ada', lastName: 'Bello', admissionNumber: 'A1' },
    invoice: { invoiceNumber: 'INV-1', amount: 50000, amountPaid: 25000, feeStructure: { name: 'Tuition' }, term: { name: 'First Term' } }, ...over,
  });
  beforeEach(() => { access.assertCanView.mockReset().mockResolvedValue({ schoolId: 'school-1' }); prisma.payment.findFirst.mockResolvedValue(payment()); prisma.school.findUnique.mockResolvedValue({ name: 'Greenfield', address: '1 Road', phone: null, email: null, currency: 'NGN' }); });
  it('makes a real PDF with a readable filename', async () => {
    const out = await service.getReceiptPdf('p1', admin);
    expect(out.buffer.subarray(0, 5).toString()).toBe('%PDF-');
    expect(out.filename).toBe('receipt-RCPT-2026-3F2A91BC.pdf');
  });
  it('works for a payment with no invoice', async () => { prisma.payment.findFirst.mockResolvedValue(payment({ invoice: null, provider: 'INTERNAL' })); await expect(service.getReceiptPdf('p1', admin)).resolves.toBeTruthy(); });
  it.each(['PENDING', 'FAILED', 'REFUNDED'])('no receipt for a %s payment -> 409', async (status) => {
    prisma.payment.findFirst.mockResolvedValue(payment({ status }));
    await expect(service.getReceiptPdf('p1', admin)).rejects.toThrow('only issued for successful');
  });
  it('checks the person may see this student\'s money', async () => {
    await service.getReceiptPdf('p1', admin);
    expect(access.assertCanView).toHaveBeenCalledWith(admin, 's1', ['SCHOOL_ADMIN', 'ACCOUNTANT']);
    access.assertCanView.mockRejectedValue(new NotFoundException('Student not found'));
    await expect(service.getReceiptPdf('p1', { id: 'x', role: 'STUDENT', schoolId: 'school-1' } as any)).rejects.toThrow(NotFoundException);
  });
  it('payment from another school -> 404', async () => { prisma.payment.findFirst.mockResolvedValue(null); await expect(service.getReceiptPdf('p1', admin)).rejects.toThrow(NotFoundException); expect(prisma.payment.findFirst.mock.calls[0][0].where).toEqual({ id: 'p1', schoolId: 'school-1' }); });
});

describe('refunds', () => {
  const client = { refund: jest.fn<Fn>() };
  const service = new RefundsService(prisma, client as unknown as PaystackRefundClient);
  const paid = (over: object = {}) => ({ id: 'pay1', schoolId: 'school-1', status: 'SUCCESSFUL', provider: 'PAYSTACK', reference: 'REF1', amount: 25000, invoiceId: 'inv1', ...over });
  beforeEach(() => {
    client.refund.mockReset().mockResolvedValue({ id: '998', status: 'pending' });
    prisma.payment.findFirst.mockResolvedValue(paid());
    prisma.payment.update.mockResolvedValue({});
    prisma.refund.count.mockResolvedValue(0);
    prisma.refund.create.mockImplementation(async (a: any) => ({ id: 'r1', ...a.data }));
    prisma.invoice.findUnique.mockResolvedValue({ id: 'inv1', status: 'PAID', amount: 25000, dueDate: null });
    prisma.payment.findMany.mockResolvedValue([]);
    prisma.invoice.update.mockResolvedValue({});
  });
  const body = (over: object = {}) => ({ paymentId: 'pay1', reason: 'Paid twice by mistake', ...over }) as any;

  it('an online payment: asks Paystack, records the refund as PROCESSING, marks the payment REFUNDED and recounts the invoice', async () => {
    const out: any = await service.create(body(), accountant);
    expect(client.refund).toHaveBeenCalledWith({ transaction: 'REF1', reason: 'Paid twice by mistake' });
    expect(out).toMatchObject({ status: 'PROCESSING', providerReference: '998', amount: 25000, createdById: 'u-acc' });
    expect(prisma.payment.update).toHaveBeenCalledWith({ where: { id: 'pay1' }, data: { status: 'REFUNDED' } });
    expect(prisma.invoice.update.mock.calls[0][0].data.status).toBe('UNPAID'); // nothing left paid
    expect(prisma.auditLog.create.mock.calls[0][0].data.action).toBe('payment.refunded');
  });
  it('Paystack says "processed" -> the refund is COMPLETED straight away', async () => {
    client.refund.mockResolvedValue({ id: '1', status: 'processed' });
    expect((await service.create(body(), admin) as any).status).toBe('COMPLETED');
  });
  it('a payment the school recorded itself is refunded without calling Paystack', async () => {
    prisma.payment.findFirst.mockResolvedValue(paid({ provider: 'INTERNAL' }));
    const out: any = await service.create(body(), admin);
    expect(client.refund).not.toHaveBeenCalled();
    expect(out).toMatchObject({ status: 'COMPLETED', providerReference: null });
  });
  it('if Paystack refuses, NOTHING changes in the database', async () => {
    client.refund.mockRejectedValue(new BadGatewayException('Transaction not found'));
    await expect(service.create(body(), admin)).rejects.toThrow(BadGatewayException);
    expect(prisma.$transaction).not.toHaveBeenCalled();
    expect(prisma.payment.update).not.toHaveBeenCalled();
  });
  it.each(['PENDING', 'FAILED', 'REFUNDED'])('a %s payment cannot be refunded -> 409', async (status) => {
    prisma.payment.findFirst.mockResolvedValue(paid({ status }));
    await expect(service.create(body(), admin)).rejects.toThrow(/Only successful payments/);
    expect(client.refund).not.toHaveBeenCalled();
  });
  it('a payment that already has a refund cannot be refunded twice', async () => {
    prisma.refund.count.mockResolvedValue(1);
    await expect(service.create(body(), admin)).rejects.toThrow('already has a refund');
    expect(client.refund).not.toHaveBeenCalled();
  });
  it('only finance staff; a reason is required', async () => {
    await expect(service.create(body(), teacher)).rejects.toThrow(ForbiddenException);
    await expect(service.create(body(), { id: 's', role: 'STUDENT', schoolId: 'school-1' } as any)).rejects.toThrow(ForbiddenException);
    await expect(service.create(body({ reason: '  no ' }), admin)).rejects.toThrow(BadRequestException);
  });
  it('payment from another school -> 404', async () => {
    prisma.payment.findFirst.mockResolvedValue(null);
    await expect(service.create(body(), admin)).rejects.toThrow(NotFoundException);
    expect(prisma.payment.findFirst.mock.calls[0][0].where).toEqual({ id: 'pay1', schoolId: 'school-1' });
  });
  it('marking a processing refund COMPLETED just records it', async () => {
    prisma.refund.findFirst.mockResolvedValue({ id: 'r1', status: 'PROCESSING', paymentId: 'pay1' });
    prisma.refund.update.mockImplementation(async (a: any) => ({ id: 'r1', ...a.data }));
    expect(await service.updateStatus('r1', { status: 'COMPLETED' }, admin)).toMatchObject({ status: 'COMPLETED', failureReason: null });
    expect(prisma.payment.update).not.toHaveBeenCalled();
  });
  it('a FAILED refund puts the payment back to SUCCESSFUL and recounts the invoice', async () => {
    prisma.refund.findFirst.mockResolvedValue({ id: 'r1', status: 'PROCESSING', paymentId: 'pay1' });
    prisma.refund.update.mockImplementation(async (a: any) => ({ id: 'r1', ...a.data }));
    prisma.payment.findUnique.mockResolvedValue(paid({ status: 'REFUNDED' }));
    prisma.payment.findMany.mockResolvedValue([{ amount: 25000 }]);
    prisma.invoice.findUnique.mockResolvedValue({ id: 'inv1', status: 'UNPAID', amount: 25000, dueDate: null });
    expect(await service.updateStatus('r1', { status: 'FAILED', failureReason: 'Bank rejected' }, admin)).toMatchObject({ status: 'FAILED', failureReason: 'Bank rejected' });
    expect(prisma.payment.update).toHaveBeenCalledWith({ where: { id: 'pay1' }, data: { status: 'SUCCESSFUL' } });
    expect(prisma.invoice.update.mock.calls[0][0].data.status).toBe('PAID');
  });
  it('a finished refund cannot be changed again', async () => {
    prisma.refund.findFirst.mockResolvedValue({ id: 'r1', status: 'COMPLETED', paymentId: 'pay1' });
    await expect(service.updateStatus('r1', { status: 'FAILED' }, admin)).rejects.toThrow(ConflictException);
  });
  it('refund from another school -> 404', async () => { prisma.refund.findFirst.mockResolvedValue(null); await expect(service.updateStatus('r9', { status: 'COMPLETED' }, admin)).rejects.toThrow(NotFoundException); });
});

describe('PaystackRefundClient (Paystack itself is faked here)', () => {
  const client = new PaystackRefundClient();
  const original = process.env.PAYSTACK_SECRET_KEY;
  let spy: jest.SpiedFunction<typeof fetch>;
  beforeEach(() => { process.env.PAYSTACK_SECRET_KEY = 'sk_test_x'; spy = jest.spyOn(globalThis, 'fetch'); });
  afterEach(() => { spy.mockRestore(); process.env.PAYSTACK_SECRET_KEY = original; });
  const reply = (body: unknown, ok = true) => spy.mockResolvedValue({ ok, json: async () => body } as Response);

  it('sends the transaction reference and note with the secret key', async () => {
    reply({ status: true, data: { id: 77, status: 'pending' } });
    expect(await client.refund({ transaction: 'REF1', reason: 'Duplicate' })).toEqual({ id: '77', status: 'pending' });
    const [url, init] = spy.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://api.paystack.co/refund');
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer sk_test_x');
    expect(JSON.parse(init.body as string)).toEqual({ transaction: 'REF1', merchant_note: 'Duplicate' });
  });
  it('no key -> says Paystack is not configured and makes no call', async () => {
    delete process.env.PAYSTACK_SECRET_KEY;
    await expect(client.refund({ transaction: 'R', reason: 'x' })).rejects.toThrow(ServiceUnavailableException);
    expect(spy).not.toHaveBeenCalled();
  });
  it('Paystack saying no -> 502 with Paystack\'s message', async () => {
    reply({ status: false, message: 'Transaction has already been fully reversed' }, false);
    await expect(client.refund({ transaction: 'R', reason: 'x' })).rejects.toThrow('already been fully reversed');
  });
  it('network failure -> 503', async () => { spy.mockRejectedValue(new Error('timeout')); await expect(client.refund({ transaction: 'R', reason: 'x' })).rejects.toThrow(ServiceUnavailableException); });
  it('garbage reply -> 502', async () => { spy.mockResolvedValue({ ok: true, json: async () => { throw new Error('bad json'); } } as unknown as Response); await expect(client.refund({ transaction: 'R', reason: 'x' })).rejects.toThrow(BadGatewayException); });
});

describe('HTTP routes', () => {
  const calls = new Map<string, ReturnType<typeof jest.fn>>();
  const fake = (...names: string[]) => Object.fromEntries(names.map((n) => { const f = jest.fn<Fn>().mockResolvedValue({ ok: 1 }); calls.set(n, f); return [n, f]; }));
  const discounts = fake('findAll', 'create', 'update', 'remove');
  const batches = fake('preview', 'create');
  const overdue = fake('markForMySchool');
  const scopes = fake('findAll', 'setScope');
  const installments = fake('getPlan', 'setPlan', 'removePlan');
  const refunds = fake('findAll', 'create', 'updateStatus');
  const receipts = { getReceiptPdf: jest.fn<Fn>() };
  let role = 'SCHOOL_ADMIN';
  let app: INestApplication;
  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      controllers: [DiscountsController, InvoiceBatchesController, FeeScopeController, InstallmentsController, ReceiptsController, RefundsController],
      providers: [
        { provide: DiscountsService, useValue: discounts }, { provide: BulkInvoicingService, useValue: batches }, { provide: OverdueInvoicesService, useValue: overdue }, { provide: FeeScopeService, useValue: scopes },
        { provide: InstallmentsService, useValue: installments }, { provide: ReceiptsService, useValue: receipts }, { provide: RefundsService, useValue: refunds },
        { provide: APP_GUARD, useClass: RolesGuard },
      ],
    }).compile();
    app = moduleRef.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
    app.use((req: any, _r: unknown, next: () => void) => { req.user = { id: 'u', role, schoolId: 'school-1' }; next(); });
    await app.init();
  });
  afterAll(async () => { await app.close(); });
  beforeEach(() => { role = 'SCHOOL_ADMIN'; receipts.getReceiptPdf.mockReset().mockResolvedValue({ buffer: Buffer.from('%PDF-1.3 fake'), filename: 'r.pdf' }); });
  const status = async (r: string, method: 'get' | 'post' | 'put' | 'patch' | 'delete', url: string, body?: object) => { role = r; const q = request(app.getHttpServer())[method](url); return (body ? q.send(body) : q).then((x) => x.status); };

  it('discounts: finance staff can read, only the admin can change', async () => {
    for (const r of ['SCHOOL_ADMIN', 'ACCOUNTANT']) expect(await status(r, 'get', '/student-discounts')).toBe(200);
    expect(await status('TEACHER', 'get', '/student-discounts')).toBe(403);
    expect(await status('SCHOOL_ADMIN', 'post', '/student-discounts', { studentId: 's', name: 'Sib', type: 'FIXED', value: 5 })).toBe(201);
    expect(await status('ACCOUNTANT', 'post', '/student-discounts', { studentId: 's', name: 'Sib', type: 'FIXED', value: 5 })).toBe(403);
    expect(await status('ACCOUNTANT', 'delete', '/student-discounts/d1')).toBe(403);
  });
  it('discount bodies are checked', async () => {
    expect(await status('SCHOOL_ADMIN', 'post', '/student-discounts', { studentId: 's', name: 'x', type: 'HALF', value: 5 })).toBe(400);
    expect(await status('SCHOOL_ADMIN', 'post', '/student-discounts', { studentId: 's', name: 'x', type: 'FIXED', value: -5 })).toBe(400);
  });
  it('bulk invoicing: finance staff only, term required, unknown fields refused', async () => {
    for (const r of ['SCHOOL_ADMIN', 'ACCOUNTANT']) { expect(await status(r, 'post', '/invoice-batches/preview', { termId: 't' })).toBe(201); expect(await status(r, 'post', '/invoice-batches', { termId: 't', dueDate: '2026-12-01' })).toBe(201); }
    for (const r of ['TEACHER', 'STUDENT', 'PARENT']) expect(await status(r, 'post', '/invoice-batches', { termId: 't' })).toBe(403);
    expect(await status('SCHOOL_ADMIN', 'post', '/invoice-batches', {})).toBe(400);
    expect(await status('SCHOOL_ADMIN', 'post', '/invoice-batches', { termId: 't', hack: 1 })).toBe(400);
    expect(await status('SCHOOL_ADMIN', 'post', '/invoice-batches', { termId: 't', dueDate: 'tomorrow' })).toBe(400);
  });
  it('mark-overdue: finance staff only, and it is not read as something else', async () => {
    for (const r of ['SCHOOL_ADMIN', 'ACCOUNTANT']) expect(await status(r, 'post', '/invoice-batches/mark-overdue')).toBe(201);
    for (const r of ['TEACHER', 'STUDENT', 'PARENT']) expect(await status(r, 'post', '/invoice-batches/mark-overdue')).toBe(403);
    expect(overdue.markForMySchool).toHaveBeenCalledTimes(2);
    expect(batches.create).not.toHaveBeenCalled();
  });
  it('fee scope: finance can look, only the admin can set', async () => {
    expect(await status('ACCOUNTANT', 'get', '/fee-scopes')).toBe(200);
    expect(await status('SCHOOL_ADMIN', 'put', '/fee-scopes/f1', { levelId: 'L1' })).toBe(200);
    expect(await status('ACCOUNTANT', 'put', '/fee-scopes/f1', { levelId: 'L1' })).toBe(403);
  });
  it('installments: staff, students and parents may look; only finance staff may set', async () => {
    for (const r of ['SCHOOL_ADMIN', 'ACCOUNTANT', 'STUDENT', 'PARENT']) expect(await status(r, 'get', '/invoice-installments/inv1')).toBe(200);
    expect(await status('TEACHER', 'get', '/invoice-installments/inv1')).toBe(403);
    const plan = { items: [{ dueDate: '2026-10-01', amount: 100 }] };
    expect(await status('ACCOUNTANT', 'put', '/invoice-installments/inv1', plan)).toBe(200);
    expect(await status('PARENT', 'put', '/invoice-installments/inv1', plan)).toBe(403);
    expect(await status('SCHOOL_ADMIN', 'put', '/invoice-installments/inv1', { items: [] })).toBe(400);
    expect(await status('SCHOOL_ADMIN', 'put', '/invoice-installments/inv1', { items: [{ dueDate: 'x', amount: 5 }] })).toBe(400);
  });
  it('receipts come back as a PDF; admin, accountant, student and parent may ask, teacher may not', async () => {
    for (const r of ['SCHOOL_ADMIN', 'ACCOUNTANT', 'STUDENT', 'PARENT']) expect(await status(r, 'get', '/receipts/p1')).toBe(200);
    expect(await status('TEACHER', 'get', '/receipts/p1')).toBe(403);
    role = 'PARENT';
    const res = await request(app.getHttpServer()).get('/receipts/p1').buffer(true).parse((r, cb) => { const c: Buffer[] = []; r.on('data', (d: Buffer) => c.push(d)); r.on('end', () => cb(null, Buffer.concat(c))); });
    expect(res.headers['content-type']).toContain('application/pdf');
    expect(res.headers['content-disposition']).toBe('inline; filename="r.pdf"');
  });
  it('refunds: finance staff only; reason must be real; status must be COMPLETED or FAILED', async () => {
    for (const r of ['SCHOOL_ADMIN', 'ACCOUNTANT']) { expect(await status(r, 'post', '/refunds', { paymentId: 'p', reason: 'Paid twice' })).toBe(201); expect(await status(r, 'get', '/refunds')).toBe(200); }
    for (const r of ['TEACHER', 'STUDENT', 'PARENT']) expect(await status(r, 'post', '/refunds', { paymentId: 'p', reason: 'Paid twice' })).toBe(403);
    expect(await status('SCHOOL_ADMIN', 'post', '/refunds', { paymentId: 'p', reason: 'no' })).toBe(400);
    expect(await status('SCHOOL_ADMIN', 'patch', '/refunds/r1/status', { status: 'COMPLETED' })).toBe(200);
    expect(await status('SCHOOL_ADMIN', 'patch', '/refunds/r1/status', { status: 'PROCESSING' })).toBe(400);
  });
  it('module wiring builds', async () => {
    const mod = await Test.createTestingModule({ imports: [BillingModule] }).useMocker((t) => (t === PrismaService ? {} : undefined)).compile();
    expect(mod.get(RefundsService)).toBeInstanceOf(RefundsService);
    expect(mod.get(BulkInvoicingService)).toBeInstanceOf(BulkInvoicingService);
  });
});

describe('overdue invoices', () => {
  const service = new OverdueInvoicesService(prisma);
  beforeEach(() => { prisma.invoice.updateMany = mk().mockResolvedValue({ count: 7 }); });
  it('marks unpaid and part-paid invoices whose due date is BEFORE today as OVERDUE', async () => {
    expect(await service.markOverdue({ now: new Date('2026-11-10T15:30:00Z') })).toEqual({ marked: 7 });
    const arg = prisma.invoice.updateMany.mock.calls[0][0];
    expect(arg.where.status).toEqual({ in: ['UNPAID', 'PARTIALLY_PAID'] });
    expect(arg.where.dueDate).toEqual({ lt: new Date('2026-11-10T00:00:00.000Z') }); // due TODAY is not overdue
    expect(arg.data).toEqual({ status: 'OVERDUE' });
  });
  it('never touches paid, cancelled or already-overdue invoices', async () => {
    await service.markOverdue();
    const statuses = prisma.invoice.updateMany.mock.calls[0][0].where.status.in;
    expect(statuses).not.toContain('PAID'); expect(statuses).not.toContain('CANCELLED'); expect(statuses).not.toContain('OVERDUE');
  });
  it('a school admin only ever marks their own school', async () => {
    await service.markForMySchool(admin);
    expect(prisma.invoice.updateMany.mock.calls[0][0].where.schoolId).toBe('school-1');
    await expect(service.markForMySchool(noSchool)).rejects.toThrow(ForbiddenException);
  });
  it('with no school given (the nightly job) it covers every school', async () => {
    await service.markOverdue();
    expect('schoolId' in prisma.invoice.updateMany.mock.calls[0][0].where).toBe(false);
  });
});
