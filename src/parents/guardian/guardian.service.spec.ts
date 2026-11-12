import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { describe, expect, it, jest } from '@jest/globals';
import { UserRole } from '@prisma/client';
import type { RequestUser } from '../../auth/decorator/current-user.decorator';
import { PaginationQueryDto } from '../../common/dto/pagination-query.dto';
import { PrismaService } from '../../prisma/prisma.service';
import { PlanLimitService } from '../../plans/plan-limit.service';
import { GuardianService } from './guardian.service';

describe('GuardianService parent attendance', () => {
  const parentUser: RequestUser = {
    id: 'parent-user-1',
    supabaseUserId: 'parent-auth-1',
    sub: 'parent-auth-1',
    email: 'parent@example.test',
    role: UserRole.PARENT,
    schoolId: 'school-1',
  };

  function setup(options: {
    linkedChildren?: { studentId: string }[];
    parentExists?: boolean;
    studentExists?: boolean;
    records?: { id: string }[];
    total?: number;
  } = {}) {
    const records = options.records ?? [{ id: 'attendance-1' }];
    const prisma = {
      schoolMembership: {
        findFirst: jest.fn(async () => ({ schoolId: 'school-1' })),
      },
      parent: {
        findFirst: jest.fn(async () =>
          options.parentExists === false ? null : { id: 'parent-1' },
        ),
      },
      studentGuardian: {
        findMany: jest.fn(
          async () =>
            options.linkedChildren ?? [
              { studentId: 'student-1' },
              { studentId: 'student-2' },
            ],
        ),
      },
      student: {
        findFirst: jest.fn(async () =>
          options.studentExists === false ? null : { id: 'student-1' },
        ),
      },
      attendance: {
        findMany: jest.fn(async () => records),
        count: jest.fn(async () => options.total ?? 2),
      },
    };

    return {
      service: new GuardianService(
        prisma as unknown as PrismaService,
        {} as unknown as PlanLimitService,
      ),
      prisma,
      records,
    };
  }

  it('returns paginated attendance for all linked children in the parent school', async () => {
    const { service, prisma, records } = setup();
    const query = new PaginationQueryDto();
    query.page = 2;
    query.limit = 1;

    await expect(service.findMyAttendance(parentUser, query)).resolves.toEqual({
      data: records,
      meta: { page: 2, limit: 1, total: 2, totalPages: 2 },
    });

    expect(prisma.schoolMembership.findFirst).toHaveBeenCalledWith({
      where: { userId: parentUser.id, schoolId: parentUser.schoolId },
    });
    expect(prisma.parent.findFirst).toHaveBeenCalledWith({
      where: { userId: parentUser.id, schoolId: 'school-1' },
      select: { id: true },
    });
    expect(prisma.studentGuardian.findMany).toHaveBeenCalledWith({
      where: {
        parentId: 'parent-1',
        student: { schoolId: 'school-1' },
      },
      select: { studentId: true },
    });
    expect(prisma.attendance.findMany).toHaveBeenCalledWith({
      where: {
        studentId: { in: ['student-1', 'student-2'] },
        class: { schoolId: 'school-1' },
      },
      include: {
        student: {
          select: {
            id: true,
            admissionNumber: true,
            firstName: true,
            middleName: true,
            lastName: true,
          },
        },
        class: { select: { id: true, name: true, level: true } },
      },
      orderBy: [{ date: 'desc' }, { id: 'asc' }],
      skip: 1,
      take: 1,
    });
  });

  it('returns an empty paginated result when the parent has no linked children', async () => {
    const { service, prisma } = setup({
      linkedChildren: [],
      records: [],
      total: 0,
    });

    await expect(service.findMyAttendance(parentUser)).resolves.toEqual({
      data: [],
      meta: { page: 1, limit: 20, total: 0, totalPages: 0 },
    });
    expect(prisma.attendance.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          studentId: { in: [] },
          class: { schoolId: 'school-1' },
        },
      }),
    );
  });

  it('returns paginated attendance for one child linked to the authenticated parent', async () => {
    const { service, prisma, records } = setup();
    const query = new PaginationQueryDto();
    query.page = 2;
    query.limit = 1;

    await expect(
      service.findChildAttendance(parentUser, 'student-1', query),
    ).resolves.toEqual({
      data: records,
      meta: { page: 2, limit: 1, total: 2, totalPages: 2 },
    });

    expect(prisma.student.findFirst).toHaveBeenCalledWith({
      where: {
        id: 'student-1',
        schoolId: 'school-1',
        guardians: { some: { parentId: 'parent-1' } },
      },
      select: { id: true },
    });
    expect(prisma.attendance.findMany).toHaveBeenCalledWith({
      where: {
        studentId: 'student-1',
        class: { schoolId: 'school-1' },
      },
      include: {
        student: {
          select: {
            id: true,
            admissionNumber: true,
            firstName: true,
            middleName: true,
            lastName: true,
          },
        },
        class: { select: { id: true, name: true, level: true } },
      },
      orderBy: [{ date: 'desc' }, { id: 'asc' }],
      skip: 1,
      take: 1,
    });
  });

  it('hides unrelated and out-of-school children behind the same not-found response', async () => {
    const unrelated = setup({ studentExists: false });

    await expect(
      unrelated.service.findChildAttendance(parentUser, 'unrelated-student'),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(unrelated.prisma.attendance.findMany).not.toHaveBeenCalled();

    const otherSchool = setup({ studentExists: false });
    await expect(
      otherSchool.service.findChildAttendance(
        parentUser,
        'other-school-student',
      ),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(otherSchool.prisma.student.findFirst).toHaveBeenCalledWith({
      where: {
        id: 'other-school-student',
        schoolId: 'school-1',
        guardians: { some: { parentId: 'parent-1' } },
      },
      select: { id: true },
    });
    expect(otherSchool.prisma.attendance.findMany).not.toHaveBeenCalled();
  });

  it('returns an empty page when a linked child has no attendance', async () => {
    const { service } = setup({ records: [], total: 0 });

    await expect(
      service.findChildAttendance(parentUser, 'student-1'),
    ).resolves.toEqual({
      data: [],
      meta: { page: 1, limit: 20, total: 0, totalPages: 0 },
    });
  });

  it('rejects non-parent users before looking up a membership', async () => {
    const { service, prisma } = setup();

    await expect(
      service.findMyAttendance({
        ...parentUser,
        role: UserRole.STUDENT,
      }),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(prisma.schoolMembership.findFirst).not.toHaveBeenCalled();
  });

  it('does not return attendance when the authenticated parent profile is missing', async () => {
    const { service, prisma } = setup({ parentExists: false });

    await expect(
      service.findMyAttendance(parentUser),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(prisma.studentGuardian.findMany).not.toHaveBeenCalled();
    expect(prisma.attendance.findMany).not.toHaveBeenCalled();
  });
});
