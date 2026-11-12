import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { describe, expect, it, jest } from '@jest/globals';
import { AttendanceStatus, MessageChannel, UserRole } from '@prisma/client';
import type { RequestUser } from '../auth/decorator/current-user.decorator';
import { PrismaService } from '../prisma/prisma.service';
import { PaginationQueryDto } from '../common/dto/pagination-query.dto';
import { AttendanceService } from './attendance.service';

describe('AttendanceService.findTeacherAttendance', () => {
  const teacherUser: RequestUser = {
    id: 'teacher-user-1',
    supabaseUserId: 'teacher-auth-1',
    sub: 'teacher-auth-1',
    email: 'teacher@example.test',
    role: UserRole.TEACHER,
    schoolId: 'school-1',
  };

  function setup(options: {
    assignments?: { classId: string }[];
    classExists?: boolean;
    assignmentExists?: boolean;
    studentExists?: boolean;
    records?: { id: string }[];
    total?: number;
  } = {}) {
    const records = options.records ?? [{ id: 'attendance-1' }];
    const prisma = {
      schoolMembership: {
        findFirst: jest.fn(async () => ({ schoolId: 'school-1' })),
      },
      teacher: {
        findFirst: jest.fn(async () => ({ id: 'teacher-1' })),
      },
      classTeacher: {
        findMany: jest.fn(
          async () => options.assignments ?? [{ classId: 'class-1' }],
        ),
        findUnique: jest.fn(async () =>
          options.assignmentExists === false
            ? null
            : { classId: 'class-1', teacherId: 'teacher-1' },
        ),
      },
      schoolClass: {
        findFirst: jest.fn(async () =>
          options.classExists === false ? null : { id: 'class-1' },
        ),
      },
      student: {
        findFirst: jest.fn(async () =>
          options.studentExists === false ? null : { id: 'student-1' },
        ),
      },
      attendance: {
        findMany: jest.fn(async () => records),
        count: jest.fn(async () => options.total ?? 3),
      },
    };

    return {
      service: new AttendanceService(prisma as unknown as PrismaService),
      prisma,
      records,
    };
  }

  describe('AttendanceService attendance notifications', () => {
      const schoolAdmin: RequestUser = {
        id: 'admin-user-1',
        supabaseUserId: 'admin-auth-1',
        sub: 'admin-auth-1',
        email: 'admin@example.test',
        role: UserRole.SCHOOL_ADMIN,
        schoolId: 'school-1',
      };
      const date = new Date('2026-11-12T00:00:00.000Z');
      const linkedGuardians = [
        {
          id: 'parent-1',
          firstName: 'Mary',
          lastName: 'Guardian',
          email: 'mary@example.test',
          userId: 'parent-user-1',
          user: { email: 'mary-user@example.test' },
        },
        {
          id: 'parent-2',
          firstName: 'Alex',
          lastName: 'Guardian',
          email: null,
          userId: 'parent-user-2',
          user: { email: 'alex@example.test' },
        },
      ];

      function setup(options: {
        messageChannels?: MessageChannel[];
        timezone?: string;
        guardians?: typeof linkedGuardians;
        existingRecords?: Array<{
          id: string;
          studentId: string;
          status: AttendanceStatus;
          updatedAt: Date;
        }>;
      } = {}) {
        const students = [
          {
            id: 'student-1',
            firstName: 'John',
            lastName: 'Doe',
            guardians: (options.guardians ?? linkedGuardians).map((parent) => ({
              parent,
            })),
          },
          {
            id: 'student-2',
            firstName: 'Jane',
            lastName: 'Doe',
            guardians: (options.guardians ?? linkedGuardians).map((parent) => ({
              parent,
            })),
          },
          {
            id: 'student-3',
            firstName: 'Sam',
            lastName: 'Doe',
            guardians: (options.guardians ?? linkedGuardians).map((parent) => ({
              parent,
            })),
          },
        ];
        const attendanceByStudent = new Map(
          (options.existingRecords ?? []).map((record) => [
            record.studentId,
            record,
          ]),
        );
        const deliveries: Array<Record<string, unknown>> = [];
        const notifications: Array<Record<string, unknown>> = [];
        let updateSequence = 0;
        const tx = {
          school: {
            findUniqueOrThrow: jest.fn(async () => ({
              name: 'Example School',
              timezone: options.timezone ?? 'Africa/Lagos',
              messageChannels: options.messageChannels ?? [MessageChannel.EMAIL],
            })),
          },
          student: {
            findMany: jest.fn(
              async ({ where }: { where: { id: { in: string[] } } }) =>
                students.filter(({ id }) => where.id.in.includes(id)),
            ),
          },
          attendance: {
            create: jest.fn(async ({ data }: { data: Record<string, unknown> }) => ({
              ...data,
              id: 'attendance-1',
              createdAt: date,
              updatedAt: date,
            })),
            findMany: jest.fn(
              async ({ where }: { where: { studentId: { in: string[] } } }) =>
                [...attendanceByStudent.values()].filter((record) =>
                  where.studentId.in.includes(record.studentId),
                ),
            ),
            findFirst: jest.fn(async () => {
              const record = attendanceByStudent.get('student-1');
              return record
                ? {
                    ...record,
                    date,
                    classId: 'class-1',
                    note: null,
                    teacherId: null,
                  }
                : null;
            }),
            upsert: jest.fn(
              async ({
                where,
                create,
                update,
              }: {
                where: { studentId_date: { studentId: string } };
                create: {
                  studentId: string;
                  date: Date;
                  status: AttendanceStatus;
                };
                update: { status: AttendanceStatus };
              }) => {
                const studentId = where.studentId_date.studentId;
                const previous = attendanceByStudent.get(studentId);
                const record = {
                  id: previous?.id ?? `attendance-${studentId}`,
                  studentId,
                  date: previous ? date : create.date,
                  status: previous ? update.status : create.status,
                  updatedAt: new Date(date.getTime() + ++updateSequence),
                };
                attendanceByStudent.set(studentId, record);
                return record;
              },
            ),
            update: jest.fn(
              async ({
                where,
                data,
              }: {
                where: { id: string };
                data: { status?: AttendanceStatus };
              }) => {
                const record = attendanceByStudent.get('student-1')!;
                const updated = {
                  ...record,
                  status: data.status ?? record.status,
                  updatedAt: new Date(date.getTime() + ++updateSequence),
                  date,
                  classId: 'class-1',
                  student: students[0],
                  class: { id: 'class-1' },
                  teacher: null,
                };
                attendanceByStudent.set('student-1', updated);
                return { ...updated, id: where.id };
              },
            ),
          },
          messageDelivery: {
            createMany: jest.fn(
              async ({ data }: { data: Array<Record<string, unknown>> }) => {
                deliveries.push(...data);
                return { count: data.length };
              },
            ),
          },
          notification: {
            upsert: jest.fn(async (args: Record<string, unknown>) => {
              notifications.push(args);
              return {};
            }),
          },
        };
        const prisma = {
          schoolMembership: {
            findFirst: jest.fn(async () => ({ schoolId: 'school-1' })),
          },
          student: {
            findFirst: jest.fn(async () => students[0]),
          },
          schoolClass: {
            findFirst: jest.fn(async () => ({
              id: 'class-1',
              academicSession: {
                startDate: new Date('2026-01-01T00:00:00.000Z'),
                endDate: new Date('2027-01-01T00:00:00.000Z'),
              },
            })),
          },
          enrollment: {
            findFirst: jest.fn(async () => ({ id: 'enrollment-1' })),
            findMany: jest.fn(
              async ({ where }: { where: { studentId: { in: string[] } } }) =>
                where.studentId.in.map((studentId) => ({ studentId })),
            ),
          },
          teacher: {
            findFirst: jest.fn(async () => ({ id: 'teacher-1' })),
          },
          classTeacher: {
            findUnique: jest.fn(async () => ({ classId: 'class-1' })),
          },
          attendance: {
            findUnique: jest.fn(async () => null),
            findFirst: jest.fn(async () => ({
              id: 'attendance-1',
              classId: 'class-1',
              status: AttendanceStatus.PRESENT,
            })),
          },
          $transaction: jest.fn(
            async (work: (client: typeof tx) => Promise<unknown>) => work(tx),
          ),
        };

        return {
          service: new AttendanceService(prisma as unknown as PrismaService),
          prisma,
          tx,
          deliveries,
          notifications,
          attendanceByStudent,
        };
      }

      it('queues an absent alert only for linked guardians in email and in-app channels', async () => {
        const { service, tx, deliveries, notifications } = setup({
          timezone: 'America/Los_Angeles',
          guardians: [linkedGuardians[0]],
        });

        const attendance = await service.create(
          {
            studentId: 'student-1',
            classId: 'class-1',
            date: '2026-11-12',
            status: AttendanceStatus.ABSENT,
          },
          schoolAdmin,
        );

        expect(attendance).toMatchObject({ status: AttendanceStatus.ABSENT });
        expect(deliveries).toHaveLength(1);
        expect(deliveries[0]).toMatchObject({
          schoolId: 'school-1',
          userId: 'parent-user-1',
          to: 'mary@example.test',
          channel: MessageChannel.EMAIL,
          subject: 'Attendance Alert - John',
          event: 'ATTENDANCE_ALERT',
        });
        expect(deliveries[0].body).toContain('John Doe was marked absent');
        expect(deliveries[0].body).toContain('November 12, 2026');
        expect(deliveries[0].body).toContain('Example School');
        expect(notifications).toHaveLength(1);
        expect(notifications[0]).toMatchObject({
          where: { eventKey: expect.stringContaining('attendance-1') },
          create: {
            schoolId: 'school-1',
            type: 'ATTENDANCE',
            recipients: { create: [{ userId: 'parent-user-1' }] },
          },
        });
        expect(tx.student.findMany).toHaveBeenCalledWith(
          expect.objectContaining({
            where: { id: { in: ['student-1'] }, schoolId: 'school-1' },
            select: expect.objectContaining({
              guardians: expect.objectContaining({
                where: { parent: { schoolId: 'school-1' } },
              }),
            }),
          }),
        );
      });

      it('queues late alerts and does not alert for present attendance', async () => {
        const late = setup({ guardians: [linkedGuardians[0]] });
        await late.service.create(
          {
            studentId: 'student-1',
            classId: 'class-1',
            date: '2026-11-12',
            status: AttendanceStatus.LATE,
          },
          schoolAdmin,
        );
        expect(late.deliveries[0].body).toContain('was marked late');
        expect(late.notifications).toHaveLength(1);

        const present = setup();
        await present.service.create(
          {
            studentId: 'student-1',
            classId: 'class-1',
            date: '2026-11-12',
            status: AttendanceStatus.PRESENT,
          },
          schoolAdmin,
        );
        expect(present.deliveries).toHaveLength(0);
        expect(present.notifications).toHaveLength(0);
        expect(present.tx.school.findUniqueOrThrow).not.toHaveBeenCalled();
      });

      it('respects disabled email preferences while retaining in-app alerts', async () => {
        const { service, deliveries, notifications } = setup({
          messageChannels: [],
          guardians: [linkedGuardians[0]],
        });

        await service.create(
          {
            studentId: 'student-1',
            classId: 'class-1',
            date: '2026-11-12',
            status: AttendanceStatus.ABSENT,
          },
          schoolAdmin,
        );

        expect(deliveries).toHaveLength(0);
        expect(notifications).toHaveLength(1);
      });

      it('bulk marks absent and late students, but not present students', async () => {
        const { service, deliveries, notifications, prisma } = setup();

        await service.bulkMark(
          {
            classId: 'class-1',
            date: '2026-11-12',
            records: [
              { studentId: 'student-1', status: AttendanceStatus.ABSENT },
              { studentId: 'student-2', status: AttendanceStatus.LATE },
              { studentId: 'student-3', status: AttendanceStatus.PRESENT },
            ],
          },
          schoolAdmin,
        );

        expect(deliveries).toHaveLength(4);
        expect(deliveries.map(({ body }) => body)).toEqual(
          expect.arrayContaining([
            expect.stringContaining('John Doe was marked absent'),
            expect.stringContaining('Jane Doe was marked late'),
          ]),
        );
        expect(notifications).toHaveLength(2);
        expect(prisma.$transaction).toHaveBeenCalledTimes(1);
      });

      it('does not repeat same-status bulk alerts, but alerts on a later absent transition', async () => {
        const { service, deliveries, notifications } = setup({
          guardians: [linkedGuardians[0]],
          existingRecords: [
            {
              id: 'attendance-1',
              studentId: 'student-1',
              status: AttendanceStatus.ABSENT,
              updatedAt: date,
            },
          ],
        });
        const mark = async (status: AttendanceStatus) =>
          service.bulkMark(
            {
              classId: 'class-1',
              date: '2026-11-12',
              records: [{ studentId: 'student-1', status }],
            },
            schoolAdmin,
          );

        await mark(AttendanceStatus.ABSENT);
        expect(deliveries).toHaveLength(0);
        expect(notifications).toHaveLength(0);

        await mark(AttendanceStatus.PRESENT);
        expect(deliveries).toHaveLength(0);
        await mark(AttendanceStatus.ABSENT);

        expect(deliveries).toHaveLength(1);
        expect(notifications).toHaveLength(1);
      });

      it('alerts on individual status transitions but not repeated status updates', async () => {
        const { service, deliveries, notifications } = setup({
          guardians: [linkedGuardians[0]],
          existingRecords: [
            {
              id: 'attendance-1',
              studentId: 'student-1',
              status: AttendanceStatus.ABSENT,
              updatedAt: date,
            },
          ],
        });

        await service.update(
          'attendance-1',
          { status: AttendanceStatus.PRESENT },
          schoolAdmin,
        );
        expect(deliveries).toHaveLength(0);

        await service.update(
          'attendance-1',
          { status: AttendanceStatus.ABSENT },
          schoolAdmin,
        );
        expect(deliveries).toHaveLength(1);
        expect(notifications).toHaveLength(1);

        await service.update(
          'attendance-1',
          { status: AttendanceStatus.ABSENT },
          schoolAdmin,
        );
        expect(deliveries).toHaveLength(1);
        expect(notifications).toHaveLength(1);
      });
  });

  it('limits paginated attendance to assigned classes and tenant school', async () => {
    const { service, prisma, records } = setup({
      assignments: [{ classId: 'class-1' }, { classId: 'class-2' }],
    });
    const query = new PaginationQueryDto();
    query.page = 2;
    query.limit = 1;

    await expect(
      service.findTeacherAttendance(teacherUser, query),
    ).resolves.toEqual({
      data: records,
      meta: { page: 2, limit: 1, total: 3, totalPages: 3 },
    });

    expect(prisma.schoolMembership.findFirst).toHaveBeenCalledWith({
      where: { userId: teacherUser.id, schoolId: teacherUser.schoolId },
    });
    expect(prisma.teacher.findFirst).toHaveBeenCalledWith({
      where: { userId: teacherUser.id, schoolId: 'school-1' },
    });
    expect(prisma.classTeacher.findMany).toHaveBeenCalledWith({
      where: {
        teacherId: 'teacher-1',
        class: { schoolId: 'school-1' },
      },
      select: { classId: true },
    });
    expect(prisma.attendance.findMany).toHaveBeenCalledWith({
      where: {
        classId: { in: ['class-1', 'class-2'] },
        class: { schoolId: 'school-1' },
      },
      include: { student: true, class: true },
      orderBy: [{ date: 'desc' }, { id: 'asc' }],
      skip: 1,
      take: 1,
    });
    expect(prisma.attendance.count).toHaveBeenCalledWith({
      where: {
        classId: { in: ['class-1', 'class-2'] },
        class: { schoolId: 'school-1' },
      },
    });
  });

  it('rejects users who are not teachers before querying attendance', async () => {
    const { service, prisma } = setup();

    await expect(
      service.findTeacherAttendance({
        ...teacherUser,
        role: UserRole.STUDENT,
      }),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(prisma.schoolMembership.findFirst).not.toHaveBeenCalled();
    expect(prisma.attendance.findMany).not.toHaveBeenCalled();
  });

  it('returns paginated attendance for a class assigned to the teacher', async () => {
    const { service, prisma, records } = setup();
    const query = new PaginationQueryDto();
    query.page = 2;
    query.limit = 1;

    await expect(
      service.findTeacherClassAttendance('class-1', teacherUser, query),
    ).resolves.toEqual({
      data: records,
      meta: { page: 2, limit: 1, total: 3, totalPages: 3 },
    });

    expect(prisma.schoolClass.findFirst).toHaveBeenCalledWith({
      where: { id: 'class-1', schoolId: 'school-1' },
      select: { id: true },
    });
    expect(prisma.classTeacher.findUnique).toHaveBeenCalledWith({
      where: {
        classId_teacherId: {
          classId: 'class-1',
          teacherId: 'teacher-1',
        },
      },
    });
    expect(prisma.attendance.findMany).toHaveBeenCalledWith({
      where: {
        classId: 'class-1',
        class: {
          schoolId: 'school-1',
          teachers: { some: { teacherId: 'teacher-1' } },
        },
      },
      include: { student: true, class: true },
      orderBy: [{ date: 'desc' }, { id: 'asc' }],
      skip: 1,
      take: 1,
    });
  });

  it('rejects a class that is not assigned to the teacher', async () => {
    const { service, prisma } = setup({ assignmentExists: false });

    await expect(
      service.findTeacherClassAttendance('class-1', teacherUser),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(prisma.attendance.findMany).not.toHaveBeenCalled();
  });

  it('hides classes outside the teacher school and returns empty pages for assigned classes', async () => {
    const outsideSchool = setup({ classExists: false });

    await expect(
      outsideSchool.service.findTeacherClassAttendance(
        'other-school-class',
        teacherUser,
      ),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(outsideSchool.prisma.classTeacher.findUnique).not.toHaveBeenCalled();

    const emptyPage = setup({ records: [], total: 0 });
    await expect(
      emptyPage.service.findTeacherClassAttendance('class-1', teacherUser),
    ).resolves.toEqual({
      data: [],
      meta: { page: 1, limit: 20, total: 0, totalPages: 0 },
    });
  });

  it('returns student attendance only after an active enrollment in an assigned class', async () => {
    const { service, prisma, records } = setup();
    const query = new PaginationQueryDto();
    query.page = 2;
    query.limit = 1;

    await expect(
      service.findTeacherStudentAttendance('student-1', teacherUser, query),
    ).resolves.toEqual({
      data: records,
      meta: { page: 2, limit: 1, total: 3, totalPages: 3 },
    });

    expect(prisma.student.findFirst).toHaveBeenCalledWith({
      where: {
        id: 'student-1',
        schoolId: 'school-1',
        enrollments: {
          some: {
            status: 'ACTIVE',
            classId: { in: ['class-1'] },
            class: { schoolId: 'school-1' },
          },
        },
      },
      select: { id: true },
    });
    expect(prisma.attendance.findMany).toHaveBeenCalledWith({
      where: {
        studentId: 'student-1',
        classId: { in: ['class-1'] },
        class: {
          schoolId: 'school-1',
          teachers: { some: { teacherId: 'teacher-1' } },
        },
      },
      include: { student: true, class: true },
      orderBy: [{ date: 'desc' }, { id: 'asc' }],
      skip: 1,
      take: 1,
    });
  });

  it('does not disclose attendance for unrelated or out-of-school students', async () => {
    const unrelated = setup({ studentExists: false });

    await expect(
      unrelated.service.findTeacherStudentAttendance(
        'unrelated-student',
        teacherUser,
      ),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(unrelated.prisma.attendance.findMany).not.toHaveBeenCalled();

    const otherSchool = setup({ studentExists: false });
    await expect(
      otherSchool.service.findTeacherStudentAttendance(
        'other-school-student',
        teacherUser,
      ),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(otherSchool.prisma.student.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ schoolId: 'school-1' }),
      }),
    );
    expect(otherSchool.prisma.attendance.findMany).not.toHaveBeenCalled();
  });

  it('keeps the existing student and administrative attendance queries intact', async () => {
    const { service, prisma, records } = setup();

    await expect(
      service.findMine({ ...teacherUser, role: UserRole.STUDENT }),
    ).resolves.toBe(records);
    expect(prisma.student.findFirst).toHaveBeenCalledWith({
      where: { userId: teacherUser.id },
    });
    expect(prisma.attendance.findMany).toHaveBeenCalledWith({
      where: { studentId: 'student-1' },
      include: { class: true, teacher: true },
      orderBy: { date: 'desc' },
    });

    const admin: RequestUser = {
      ...teacherUser,
      id: 'admin-user-1',
      role: UserRole.SCHOOL_ADMIN,
    };
    await expect(service.findAll(admin)).resolves.toBe(records);
    expect(prisma.attendance.findMany).toHaveBeenLastCalledWith({
      where: { class: { schoolId: 'school-1' } },
      include: { student: true, class: true, teacher: true },
      orderBy: { date: 'desc' },
    });
  });
});
