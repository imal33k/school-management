import {
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { EnrollmentStatus, UserRole } from '@prisma/client';

import { PrismaService } from '../prisma/prisma.service';
import { RequestUser } from '../auth/decorator/current-user.decorator';

// One place that answers "may this person see this student's data?"
//  - staff roles you list can see any student in their school
//    (a teacher is limited to students in classes they are assigned to)
//  - a student can see only themselves
//  - a parent can see only their own children
@Injectable()
export class StudentAccessService {
  constructor(private readonly prisma: PrismaService) {}

  async assertCanView(
    user: RequestUser,
    studentId: string,
    staffRoles: UserRole[] = [UserRole.SCHOOL_ADMIN, UserRole.TEACHER],
  ): Promise<{ schoolId: string }> {
    if (!user.schoolId) {
      throw new ForbiddenException('You are not part of a school');
    }

    const schoolId = user.schoolId;

    const student = await this.prisma.student.findFirst({
      where: { id: studentId, schoolId },
      select: { id: true, userId: true },
    });

    if (!student) {
      throw new NotFoundException('Student not found');
    }

    if (user.role === UserRole.STUDENT) {
      if (student.userId !== user.id) {
        throw new NotFoundException('Student not found');
      }

      return { schoolId };
    }

    if (user.role === UserRole.PARENT) {
      const link = await this.prisma.studentGuardian.findFirst({
        where: { studentId, parent: { userId: user.id, schoolId } },
        select: { id: true },
      });

      if (!link) {
        throw new NotFoundException('Student not found');
      }

      return { schoolId };
    }

    if (!staffRoles.includes(user.role)) {
      throw new ForbiddenException('You are not allowed to see this');
    }

    if (user.role === UserRole.TEACHER) {
      const teacher = await this.prisma.teacher.findFirst({
        where: { userId: user.id, schoolId },
        select: { id: true },
      });

      const shared = teacher
        ? await this.prisma.enrollment.findFirst({
            where: {
              studentId,
              status: EnrollmentStatus.ACTIVE,
              class: { teachers: { some: { teacherId: teacher.id } } },
            },
            select: { id: true },
          })
        : null;

      if (!shared) {
        throw new ForbiddenException('This student is not in one of your classes');
      }
    }

    return { schoolId };
  }

  // The students a student/parent may see (used by portal "my children" lists)
  async familyStudentIds(user: RequestUser): Promise<string[]> {
    if (!user.schoolId) {
      throw new ForbiddenException('You are not part of a school');
    }

    if (user.role === UserRole.STUDENT) {
      const student = await this.prisma.student.findFirst({
        where: { userId: user.id, schoolId: user.schoolId },
        select: { id: true },
      });

      return student ? [student.id] : [];
    }

    if (user.role === UserRole.PARENT) {
      const parent = await this.prisma.parent.findFirst({
        where: { userId: user.id, schoolId: user.schoolId },
        select: { children: { select: { studentId: true } } },
      });

      return parent ? parent.children.map((c) => c.studentId) : [];
    }

    throw new ForbiddenException('You are not allowed to do this');
  }
}
