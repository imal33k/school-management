import { ConflictException } from '@nestjs/common';
import { UserRole } from '@prisma/client';
import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import type { RequestUser } from '../auth/decorator/current-user.decorator';
import { PrismaService } from '../prisma/prisma.service';
import { AcademicSessionService } from './academic-session.service';

describe('AcademicSessionService rollover', () => {
  const tx = {
    academicSession: {
      findFirst: jest.fn<(...args: unknown[]) => Promise<unknown>>(),
    },
    schoolClass: {
      create: jest.fn<(...args: unknown[]) => Promise<unknown>>(),
    },
    classSubject: {
      createMany: jest.fn<(...args: unknown[]) => Promise<unknown>>(),
    },
    classTeacher: {
      createMany: jest.fn<(...args: unknown[]) => Promise<unknown>>(),
    },
    timetableEntry: {
      createMany: jest.fn<(...args: unknown[]) => Promise<unknown>>(),
    },
    enrollment: {
      createMany: jest.fn<(...args: unknown[]) => Promise<unknown>>(),
    },
  };
  const prismaMock = {
    schoolMembership: {
      findFirst: jest.fn<(...args: unknown[]) => Promise<unknown>>(),
    },
    $transaction: jest.fn(
      (operation: (client: typeof tx) => Promise<unknown>) => operation(tx),
    ),
  };
  const service = new AcademicSessionService(
    prismaMock as unknown as PrismaService,
  );
  const admin = {
    id: 'admin-1',
    email: 'admin@example.test',
    role: UserRole.SCHOOL_ADMIN,
    schoolId: 'school-1',
  } as RequestUser;
  const sourceSession = {
    id: 'source-session',
    classes: [
      {
        id: 'source-class',
        name: 'Grade 1',
        level: '1',
        capacity: 30,
        subjects: [{ subjectId: 'subject-1' }],
        teachers: [{ teacherId: 'teacher-1', isPrimary: true }],
        timetableEntries: [
          {
            subjectId: 'subject-1',
            teacherId: 'teacher-1',
            day: 'MONDAY',
            startTime: '09:00',
            endTime: '10:00',
            room: 'Room 1',
          },
        ],
        enrollments: [{ studentId: 'student-1' }],
      },
    ],
  };

  beforeEach(() => {
    jest.clearAllMocks();
    prismaMock.schoolMembership.findFirst.mockResolvedValue({
      schoolId: 'school-1',
    });
    tx.academicSession.findFirst
      .mockResolvedValueOnce({
        id: 'target-session',
        isActive: false,
        _count: { classes: 0, enrollments: 0 },
      })
      .mockResolvedValueOnce(sourceSession);
    tx.schoolClass.create.mockResolvedValue({ id: 'target-class' });
    tx.classSubject.createMany.mockResolvedValue({ count: 1 });
    tx.classTeacher.createMany.mockResolvedValue({ count: 1 });
    tx.timetableEntry.createMany.mockResolvedValue({ count: 1 });
    tx.enrollment.createMany.mockResolvedValue({ count: 1 });
  });

  it('copies classes, assignments, timetables, and active enrollments transactionally', async () => {
    await expect(service.rollover(admin, 'target-session')).resolves.toEqual({
      sourceSessionId: 'source-session',
      targetSessionId: 'target-session',
      classes: 1,
      classAssignments: 2,
      timetableEntries: 1,
      studentEnrollments: 1,
    });

    expect(tx.academicSession.findFirst).toHaveBeenLastCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ isActive: true }),
        include: expect.objectContaining({
          classes: expect.objectContaining({
            include: expect.objectContaining({
              enrollments: expect.objectContaining({
                where: expect.objectContaining({
                  status: 'ACTIVE',
                  student: { status: 'ACTIVE' },
                }),
              }),
            }),
          }),
        }),
      }),
    );
    expect(tx.enrollment.createMany).toHaveBeenCalledWith({
      data: [
        {
          studentId: 'student-1',
          classId: 'target-class',
          academicSessionId: 'target-session',
          status: 'ACTIVE',
        },
      ],
    });
  });

  it('rejects a target session that already has classes or enrollments', async () => {
    tx.academicSession.findFirst.mockReset();
    tx.academicSession.findFirst.mockResolvedValue({
      id: 'target-session',
      isActive: false,
      _count: { classes: 1, enrollments: 1 },
    });

    await expect(
      service.rollover(admin, 'target-session'),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(tx.schoolClass.create).not.toHaveBeenCalled();
  });
});
