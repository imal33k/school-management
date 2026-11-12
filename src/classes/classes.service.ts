import {
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';

import { PrismaService } from '../prisma/prisma.service';
import {
  RequestUser,
} from '../auth/decorator/current-user.decorator';

import { UserRole } from '@prisma/client';

import { CreateClassDto } from './dto/create-class.dto';
import { UpdateClassDto } from './dto/update-class.dto';
import { AssignTeacherDto } from './dto/assign-teacher.dto';
import { EnrollStudentDto } from './dto/enroll-class.dto';
import { AssignSubjectDto } from './dto/assign-subject.dto';

@Injectable()
export class ClassesService {
  constructor(
    private readonly prisma: PrismaService,
  ) {}

  private ensureAdmin(user: RequestUser) {
    if (
      user.role !== UserRole.SCHOOL_ADMIN &&
      user.role !== UserRole.SUPER_ADMIN
    ) {
      throw new ForbiddenException(
        'Only school administrators can manage classes',
      );
    }
  }

  private ensureSchoolStaff(user: RequestUser) {
    if (
      user.role !== UserRole.SCHOOL_ADMIN &&
      user.role !== UserRole.SUPER_ADMIN &&
      user.role !== UserRole.TEACHER
    ) {
      throw new ForbiddenException(
        'Only school staff can access class records',
      );
    }
  }

  async create(
    user: RequestUser,
    dto: CreateClassDto,
  ) {
    this.ensureAdmin(user);

    const membership =
      await this.prisma.schoolMembership.findFirst({
        where: {
          userId: user.id,
          ...(user.schoolId ? { schoolId: user.schoolId } : {}),
        },
      });

    if (!membership) {
      throw new NotFoundException(
        'You are not a member of any school',
      );
    }

    const academicSession =
      await this.prisma.academicSession.findFirst({
        where: {
          schoolId: membership.schoolId,
          isActive: true,
        },
      });

    if (!academicSession) {
      throw new NotFoundException(
        'No active academic session found for this school',
      );
    }

    const existingClass =
      await this.prisma.schoolClass.findFirst({
        where: {
          schoolId: membership.schoolId,
          academicSessionId: academicSession.id,
          name: dto.name,
        },
      });

    if (existingClass) {
      throw new ConflictException(
        'A class with this name already exists in the active academic session',
      );
    }

    return this.prisma.schoolClass.create({
      data: {
        schoolId: membership.schoolId,
        academicSessionId: academicSession.id,
        name: dto.name,
        level: dto.level,
        capacity: dto.capacity,
      },
    });
  }

  async findAll(user: RequestUser) {
    this.ensureSchoolStaff(user);

    const membership =
      await this.prisma.schoolMembership.findFirst({
        where: {
          userId: user.id,
          ...(user.schoolId ? { schoolId: user.schoolId } : {}),
        },
      });

    if (!membership) {
      throw new NotFoundException(
        'You are not a member of any school',
      );
    }

    return this.prisma.schoolClass.findMany({
      where: {
        schoolId: membership.schoolId,
        ...(user.role === UserRole.TEACHER && {
  teachers: {
    some: {
      teacher: {
        userId: user.id,
      },
    },
  },
}),
      },
      include: {
        academicSession: true,
      },
      orderBy: {
        name: 'asc',
      },
    });
  }

  async findOne(
    id: string,
    user: RequestUser,
  ) {
    this.ensureSchoolStaff(user);

    const membership =
      await this.prisma.schoolMembership.findFirst({
        where: {
          userId: user.id,
          ...(user.schoolId ? { schoolId: user.schoolId } : {}),
        },
      });

    if (!membership) {
      throw new NotFoundException(
        'You are not a member of any school',
      );
    }

    const schoolClass =
      await this.prisma.schoolClass.findFirst({
        where: {
          id,
          schoolId: membership.schoolId,
        },
        include: {
          academicSession: true,

          enrollments: {
            where: { status: 'ACTIVE' },
            include: {
              student: true,
            },
          },

          teachers: {
            include: {
              teacher: true,
            },
          },

          subjects: {
            include: {
              subject: true,
            },
          },
        },
      });

    if (!schoolClass) {
      throw new NotFoundException(
        'Class not found',
      );
    }

    if (user.role === UserRole.TEACHER) {
      const assignedClass = await this.prisma.classTeacher.findFirst({
        where: {
          classId: schoolClass.id,
          teacher: { userId: user.id },
        },
        select: { id: true },
      });

      if (!assignedClass) {
        throw new ForbiddenException('You are not assigned to this class');
      }
    }

    return schoolClass;
  }

  async update(
    user: RequestUser,
    id: string,
    dto: UpdateClassDto,
  ) {
    this.ensureAdmin(user);

    const membership =
      await this.prisma.schoolMembership.findFirst({
        where: {
          userId: user.id,
          ...(user.schoolId ? { schoolId: user.schoolId } : {}),
        },
      });

    if (!membership) {
      throw new NotFoundException(
        'You are not a member of any school',
      );
    }

    const existingClass =
      await this.prisma.schoolClass.findFirst({
        where: {
          id,
          schoolId: membership.schoolId,
        },
      });

    if (!existingClass) {
      throw new NotFoundException(
        'Class not found',
      );
    }

    return this.prisma.schoolClass.update({
      where: {
        id,
      },
      data: {
        name: dto.name,
        level: dto.level,
        capacity: dto.capacity,
      },
    });
  }

  async remove(
    user: RequestUser,
    id: string,
  ) {
    this.ensureAdmin(user);

    const membership =
      await this.prisma.schoolMembership.findFirst({
        where: {
          userId: user.id,
          ...(user.schoolId ? { schoolId: user.schoolId } : {}),
        },
      });

    if (!membership) {
      throw new NotFoundException(
        'You are not a member of any school',
      );
    }

    const existingClass =
      await this.prisma.schoolClass.findFirst({
        where: {
          id,
          schoolId: membership.schoolId,
        },
        include: {
          _count: {
            select: {
              attendance: true,
              examinations: true,
              enrollments: true,
              timetableEntries: true,
            },
          },
        },
      });

    if (!existingClass) {
      throw new NotFoundException(
        'Class not found',
      );
    }

    if (Object.values(existingClass._count).some((count) => count > 0)) {
      throw new ConflictException(
        'Classes with attendance, examination, enrollment, or timetable history cannot be deleted',
      );
    }

    return this.prisma.schoolClass.delete({
      where: {
        id,
      },
    });
  }

  async assignTeacher(
    user: RequestUser,
    classId: string,
    dto: AssignTeacherDto,
  ) {
    this.ensureAdmin(user);

    const membership =
      await this.prisma.schoolMembership.findFirst({
        where: {
          userId: user.id,
          ...(user.schoolId ? { schoolId: user.schoolId } : {}),
        },
      });

    if (!membership) {
      throw new NotFoundException(
        'You are not a member of any school',
      );
    }

    const schoolClass =
      await this.prisma.schoolClass.findFirst({
        where: {
          id: classId,
          schoolId: membership.schoolId,
        },
      });

    if (!schoolClass) {
      throw new NotFoundException(
        'Class not found',
      );
    }

    const teacher =
      await this.prisma.teacher.findFirst({
        where: {
          id: dto.teacherId,
          schoolId: membership.schoolId,
        },
      });

    if (!teacher) {
      throw new NotFoundException(
        'Teacher not found in this school',
      );
    }

    const existingAssignment =
      await this.prisma.classTeacher.findUnique({
        where: {
          classId_teacherId: {
            classId,
            teacherId: dto.teacherId,
          },
        },
      });

    if (existingAssignment) {
      throw new ConflictException(
        'Teacher is already assigned to this class',
      );
    }

    return this.prisma.classTeacher.create({
      data: {
        classId,
        teacherId: dto.teacherId,
      },
      include: {
        teacher: true,
        class: true,
      },
    });
  }

  async setPrimaryTeacher(
    user: RequestUser,
    classId: string,
    teacherId: string,
  ) {
    this.ensureAdmin(user);
    const membership = await this.prisma.schoolMembership.findFirst({
      where: { userId: user.id },
    });

    if (!membership) {
      throw new NotFoundException('You are not a member of any school');
    }

    const assignment = await this.prisma.classTeacher.findFirst({
      where: {
        classId,
        teacherId,
        class: { schoolId: membership.schoolId },
      },
    });

    if (!assignment) {
      throw new NotFoundException('Teacher is not assigned to this class');
    }

    return this.prisma.$transaction(async (tx) => {
      await tx.classTeacher.updateMany({
        where: { classId },
        data: { isPrimary: false },
      });

      return tx.classTeacher.update({
        where: {
          classId_teacherId: { classId, teacherId },
        },
        data: { isPrimary: true },
        include: { teacher: true, class: true },
      });
    });
  }

  async unassignTeacher(
    user: RequestUser,
    classId: string,
    teacherId: string,
  ) {
    this.ensureAdmin(user);
    const membership = await this.prisma.schoolMembership.findFirst({
      where: { userId: user.id },
    });

    if (!membership) {
      throw new NotFoundException('You are not a member of any school');
    }

    const assignment = await this.prisma.classTeacher.findFirst({
      where: {
        classId,
        teacherId,
        class: { schoolId: membership.schoolId },
      },
    });

    if (!assignment) {
      throw new NotFoundException('Teacher is not assigned to this class');
    }

    const scheduledEntry = await this.prisma.timetableEntry.findFirst({
      where: { classId, teacherId },
      select: { id: true },
    });

    if (scheduledEntry) {
      throw new ConflictException(
        'Remove this teacher from the class timetable before unassigning them',
      );
    }

    await this.prisma.classTeacher.delete({
      where: {
        classId_teacherId: { classId, teacherId },
      },
    });

    return { message: 'Teacher unassigned from class successfully' };
  }

  async assignSubject(
    user: RequestUser,
    classId: string,
    dto: AssignSubjectDto,
  ) {
    this.ensureAdmin(user);

    const membership =
      await this.prisma.schoolMembership.findFirst({
        where: {
          userId: user.id,
          ...(user.schoolId ? { schoolId: user.schoolId } : {}),
        },
      });

    if (!membership) {
      throw new NotFoundException(
        'You are not a member of any school',
      );
    }

    const schoolClass =
      await this.prisma.schoolClass.findFirst({
        where: {
          id: classId,
          schoolId: membership.schoolId,
        },
      });

    if (!schoolClass) {
      throw new NotFoundException(
        'Class not found',
      );
    }

    const subject =
      await this.prisma.subject.findFirst({
        where: {
          id: dto.subjectId,
          schoolId: membership.schoolId,
        },
      });

    if (!subject) {
      throw new NotFoundException(
        'Subject not found in this school',
      );
    }

    const existingAssignment =
      await this.prisma.classSubject.findUnique({
        where: {
          classId_subjectId: {
            classId,
            subjectId: dto.subjectId,
          },
        },
      });

    if (existingAssignment) {
      throw new ConflictException(
        'Subject is already assigned to this class',
      );
    }

    return this.prisma.classSubject.create({
      data: {
        classId,
        subjectId: dto.subjectId,
      },
      include: {
        subject: true,
        class: true,
      },
    });
  }

  async unassignSubject(
    user: RequestUser,
    classId: string,
    subjectId: string,
  ) {
    this.ensureAdmin(user);
    const membership = await this.prisma.schoolMembership.findFirst({
      where: { userId: user.id },
    });

    if (!membership) {
      throw new NotFoundException('You are not a member of any school');
    }

    const assignment = await this.prisma.classSubject.findFirst({
      where: {
        classId,
        subjectId,
        class: { schoolId: membership.schoolId },
      },
    });

    if (!assignment) {
      throw new NotFoundException('Subject is not assigned to this class');
    }

    const scheduledEntry = await this.prisma.timetableEntry.findFirst({
      where: { classId, subjectId },
      select: { id: true },
    });

    if (scheduledEntry) {
      throw new ConflictException(
        'Remove this subject from the class timetable before unassigning it',
      );
    }

    await this.prisma.classSubject.delete({
      where: {
        classId_subjectId: { classId, subjectId },
      },
    });

    return { message: 'Subject unassigned from class successfully' };
  }

  async enrollStudent(
    user: RequestUser,
    classId: string,
    dto: EnrollStudentDto,
  ) {
    this.ensureAdmin(user);

    const membership =
      await this.prisma.schoolMembership.findFirst({
        where: {
          userId: user.id,
          ...(user.schoolId ? { schoolId: user.schoolId } : {}),
        },
      });

    if (!membership) {
      throw new NotFoundException(
        'You are not a member of any school',
      );
    }

    const student =
      await this.prisma.student.findFirst({
        where: {
          id: dto.studentId,
          schoolId: membership.schoolId,
        },
      });

    if (!student) {
      throw new NotFoundException(
        'Student not found in this school',
      );
    }

    return this.prisma.$transaction(
      async (tx) => {
        const schoolClass = await tx.schoolClass.findFirst({
          where: { id: classId, schoolId: membership.schoolId },
          include: { academicSession: true },
        });
        if (!schoolClass) {
          throw new NotFoundException('Class not found');
        }
        if (!schoolClass.academicSession.isActive) {
          throw new ConflictException(
            'Students can only be enrolled in a class from the active academic session',
          );
        }

        const existingEnrollment = await tx.enrollment.findUnique({
          where: {
            studentId_academicSessionId: {
              studentId: student.id,
              academicSessionId: schoolClass.academicSessionId,
            },
          },
        });
        if (existingEnrollment) {
          throw new ConflictException(
            'Student is already enrolled in a class for this academic session',
          );
        }

        if (schoolClass.capacity !== null) {
          const enrollmentCount = await tx.enrollment.count({
            where: {
              classId: schoolClass.id,
              status: 'ACTIVE',
            },
          });
          if (enrollmentCount >= schoolClass.capacity) {
            throw new ConflictException(
              'This class has reached its capacity',
            );
          }
        }

        return tx.enrollment.create({
          data: {
            studentId: student.id,
            classId: schoolClass.id,
            academicSessionId: schoolClass.academicSessionId,
          },
          include: {
            student: true,
            class: true,
            academicSession: true,
          },
        });
      },
      { isolationLevel: 'Serializable' },
    );
  }
}