import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { describe, expect, it, jest } from '@jest/globals';
import { EnrollmentStatus, UserRole } from '@prisma/client';
import type { RequestUser } from '../auth/decorator/current-user.decorator';
import { PrismaService } from '../prisma/prisma.service';
import { TimetableService } from './timetable-entry.service';

describe('TimetableService.findChildTimetable', () => {
  const parent: RequestUser = {
    id: 'parent-user-1',
    supabaseUserId: 'parent-auth-1',
    sub: 'parent-auth-1',
    email: 'parent@example.test',
    role: UserRole.PARENT,
    schoolId: 'school-1',
  };

  function setup() {
    const timetableEntries = [{ id: 'entry-1' }];
    const prisma = {
      schoolMembership: {
        findFirst: jest.fn(async () => ({ schoolId: 'school-1' })),
      },
      student: {
        findFirst: jest.fn(async () => ({
          enrollments: [{ classId: 'class-1' }, { classId: 'class-2' }],
        })),
      },
      timetableEntry: {
        findMany: jest.fn(async () => timetableEntries),
      },
    };

    return {
      service: new TimetableService(prisma as unknown as PrismaService),
      prisma,
      timetableEntries,
    };
  }

  it('uses the parent membership, guardian link, active classes, and shared response shape', async () => {
    const { service, prisma, timetableEntries } = setup();

    await expect(service.findChildTimetable(parent, 'student-1')).resolves.toBe(
      timetableEntries,
    );

    expect(prisma.schoolMembership.findFirst).toHaveBeenCalledWith({
      where: {
        userId: parent.id,
        schoolId: parent.schoolId,
      },
    });
    expect(prisma.student.findFirst).toHaveBeenCalledWith({
      where: {
        id: 'student-1',
        schoolId: 'school-1',
        guardians: {
          some: {
            parent: {
              userId: parent.id,
              schoolId: 'school-1',
            },
          },
        },
      },
      select: {
        enrollments: {
          where: { status: EnrollmentStatus.ACTIVE },
          select: { classId: true },
        },
      },
    });
    expect(prisma.timetableEntry.findMany).toHaveBeenCalledWith({
      where: {
        classId: { in: ['class-1', 'class-2'] },
        class: { schoolId: 'school-1' },
      },
      include: {
        class: true,
        subject: true,
        teacher: {
          select: { id: true, firstName: true, lastName: true },
        },
      },
      orderBy: [{ day: 'asc' }, { startTime: 'asc' }],
    });
  });

  it('rejects users who are not parents', async () => {
    const { service, prisma } = setup();

    await expect(
      service.findChildTimetable(
        { ...parent, role: UserRole.STUDENT },
        'student-1',
      ),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(prisma.schoolMembership.findFirst).not.toHaveBeenCalled();
  });

  it('returns not found when the student is outside the parent-school relationship', async () => {
    const { service, prisma } = setup();
    prisma.student.findFirst.mockImplementation(async () => null);

    await expect(
      service.findChildTimetable(parent, 'unlinked-student'),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(prisma.timetableEntry.findMany).not.toHaveBeenCalled();
  });

  it('returns an empty timetable when the child has no active enrollments', async () => {
    const { service, prisma } = setup();
    prisma.student.findFirst.mockImplementation(async () => ({
      enrollments: [],
    }));

    await expect(
      service.findChildTimetable(parent, 'student-1'),
    ).resolves.toEqual([]);
    expect(prisma.timetableEntry.findMany).not.toHaveBeenCalled();
  });
});
