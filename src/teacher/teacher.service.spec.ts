import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { afterEach, describe, expect, it, jest } from '@jest/globals';
import { UserRole } from '@prisma/client';
import type { RequestUser } from '../auth/decorator/current-user.decorator';
import { EmailService } from '../common/email.service';
import { AuditLogService } from '../audit-log/audit-log.service';
import { PlanLimitService } from '../plans/plan-limit.service';
import { PrismaService } from '../prisma/prisma.service';
import { TeacherService } from './teacher.service';

afterEach(() => {
  jest.restoreAllMocks();
});

describe('TeacherService.findMe', () => {
  const teacherUser: RequestUser = {
    id: 'teacher-user-1',
    supabaseUserId: 'teacher-auth-1',
    sub: 'teacher-auth-1',
    email: 'teacher@example.test',
    role: UserRole.TEACHER,
    schoolId: 'school-1',
  };

  function setup() {
    const profile = {
      id: 'teacher-profile-1',
      userId: teacherUser.id,
      schoolId: 'school-1',
    };
    const prisma = {
      schoolMembership: {
        findFirst: jest.fn(async () => ({ schoolId: 'school-1' })),
      },
      teacher: {
        findFirst: jest
          .fn()
          .mockResolvedValueOnce({ id: profile.id })
          .mockResolvedValueOnce(profile),
      },
    };
    const service = new TeacherService(
      prisma as unknown as PrismaService,
      {} as PlanLimitService,
      {} as AuditLogService,
      {} as EmailService,
    );

    return { service, prisma, profile };
  }

  it('resolves the profile from the authenticated user within their school', async () => {
    const { service, prisma, profile } = setup();

    await expect(service.findMe(teacherUser)).resolves.toBe(profile);
    expect(prisma.teacher.findFirst).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        where: { userId: teacherUser.id, schoolId: 'school-1' },
        select: { id: true },
      }),
    );
    expect(prisma.teacher.findFirst).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        where: { id: profile.id, schoolId: 'school-1' },
      }),
    );
  });

  it('rejects non-teachers without looking up a profile', async () => {
    const { service, prisma } = setup();

    await expect(
      service.findMe({ ...teacherUser, role: UserRole.STUDENT }),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(prisma.schoolMembership.findFirst).not.toHaveBeenCalled();
    expect(prisma.teacher.findFirst).not.toHaveBeenCalled();
  });

  it('returns not found when the teacher has no profile in the active school', async () => {
    const { service, prisma } = setup();
    prisma.teacher.findFirst.mockReset();
    prisma.teacher.findFirst.mockResolvedValueOnce(null);

    await expect(service.findMe(teacherUser)).rejects.toBeInstanceOf(
      NotFoundException,
    );
    expect(prisma.teacher.findFirst).toHaveBeenCalledTimes(1);
  });
});
