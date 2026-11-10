import { describe, expect, it, jest, beforeEach } from '@jest/globals';
import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { StudentAccessService } from './student-access.service';

type Fn = (...args: any[]) => Promise<any>;
const mk = () => jest.fn<Fn>();
const prisma = { student: { findFirst: mk() }, studentGuardian: { findFirst: mk() }, teacher: { findFirst: mk() }, enrollment: { findFirst: mk() }, parent: { findFirst: mk() } };
const service = new StudentAccessService(prisma as any);
const as = (role: string, id = 'u1') => ({ id, role, schoolId: 'school-1' }) as any;

beforeEach(() => {
  jest.clearAllMocks();
  prisma.student.findFirst.mockResolvedValue({ id: 's1', userId: 'u-student' });
  prisma.studentGuardian.findFirst.mockResolvedValue({ id: 'g' });
  prisma.teacher.findFirst.mockResolvedValue({ id: 't1' });
  prisma.enrollment.findFirst.mockResolvedValue({ id: 'e' });
});

describe('assertCanView', () => {
  it('looks the student up inside the user\'s own school (another school = not found)', async () => {
    prisma.student.findFirst.mockResolvedValue(null);
    await expect(service.assertCanView(as('SCHOOL_ADMIN'), 's1')).rejects.toThrow(NotFoundException);
    expect(prisma.student.findFirst.mock.calls[0][0].where).toEqual({ id: 's1', schoolId: 'school-1' });
  });
  it('a user with no school is refused', async () => { await expect(service.assertCanView({ id: 'x', role: 'SCHOOL_ADMIN' } as any, 's1')).rejects.toThrow(ForbiddenException); });
  it('an admin can see any student in the school', async () => { await expect(service.assertCanView(as('SCHOOL_ADMIN'), 's1')).resolves.toEqual({ schoolId: 'school-1' }); });
  it('a student can see only themselves (anyone else looks like "not found")', async () => {
    await expect(service.assertCanView(as('STUDENT', 'u-student'), 's1')).resolves.toBeTruthy();
    await expect(service.assertCanView(as('STUDENT', 'someone-else'), 's1')).rejects.toThrow(NotFoundException);
  });
  it('a parent can see only their own children', async () => {
    await expect(service.assertCanView(as('PARENT'), 's1')).resolves.toBeTruthy();
    expect(prisma.studentGuardian.findFirst.mock.calls[0][0].where).toEqual({ studentId: 's1', parent: { userId: 'u1', schoolId: 'school-1' } });
    prisma.studentGuardian.findFirst.mockResolvedValue(null);
    await expect(service.assertCanView(as('PARENT'), 's1')).rejects.toThrow(NotFoundException);
  });
  it('a teacher can see only students in classes they are assigned to', async () => {
    await expect(service.assertCanView(as('TEACHER'), 's1')).resolves.toBeTruthy();
    expect(prisma.enrollment.findFirst.mock.calls[0][0].where).toMatchObject({ studentId: 's1', status: 'ACTIVE', class: { teachers: { some: { teacherId: 't1' } } } });
    prisma.enrollment.findFirst.mockResolvedValue(null);
    await expect(service.assertCanView(as('TEACHER'), 's1')).rejects.toThrow(ForbiddenException);
  });
  it('a teacher with no teacher profile is refused', async () => { prisma.teacher.findFirst.mockResolvedValue(null); await expect(service.assertCanView(as('TEACHER'), 's1')).rejects.toThrow(ForbiddenException); });
  it('only the staff roles the caller lists may pass (an accountant is not let in by default)', async () => {
    await expect(service.assertCanView(as('ACCOUNTANT'), 's1')).rejects.toThrow(ForbiddenException);
    await expect(service.assertCanView(as('ACCOUNTANT'), 's1', ['SCHOOL_ADMIN', 'ACCOUNTANT'] as any)).resolves.toBeTruthy();
    await expect(service.assertCanView(as('TEACHER'), 's1', ['SCHOOL_ADMIN', 'ACCOUNTANT'] as any)).rejects.toThrow(ForbiddenException);
  });
});

describe('familyStudentIds', () => {
  it('a student gets their own id; no profile = empty list', async () => {
    expect(await service.familyStudentIds(as('STUDENT'))).toEqual(['s1']);
    prisma.student.findFirst.mockResolvedValue(null);
    expect(await service.familyStudentIds(as('STUDENT'))).toEqual([]);
  });
  it('a parent gets their children', async () => {
    prisma.parent.findFirst.mockResolvedValue({ children: [{ studentId: 's1' }, { studentId: 's2' }] });
    expect(await service.familyStudentIds(as('PARENT'))).toEqual(['s1', 's2']);
  });
  it('staff are refused (they use the staff endpoints)', async () => { await expect(service.familyStudentIds(as('SCHOOL_ADMIN'))).rejects.toThrow(ForbiddenException); });
});
