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

  async create(
    user: RequestUser,
    dto: CreateClassDto,
  ) {
    this.ensureAdmin(user);

    const membership =
      await this.prisma.schoolMembership.findFirst({
        where: {
          userId: user.id,
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
    const membership =
      await this.prisma.schoolMembership.findFirst({
        where: {
          userId: user.id,
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
    const membership =
      await this.prisma.schoolMembership.findFirst({
        where: {
          userId: user.id,
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

    const existingEnrollment =
      await this.prisma.enrollment.findUnique({
        where: {
          studentId_academicSessionId: {
            studentId: dto.studentId,
            academicSessionId:
              schoolClass.academicSessionId,
          },
        },
      });

    if (existingEnrollment) {
      throw new ConflictException(
        'Student is already enrolled in a class for this academic session',
      );
    }

    return this.prisma.enrollment.create({
      data: {
        studentId: dto.studentId,
        classId,
        academicSessionId:
          schoolClass.academicSessionId,
      },
      include: {
        student: true,
        class: true,
        academicSession: true,
      },
    });
  }
}