import {
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';

import { PrismaService } from '../../prisma/prisma.service';

import {
  RequestUser,
} from '../../auth/decorator/current-user.decorator';

import { UserRole, type Prisma } from '@prisma/client';

import { CreateParentDto } from './dto/create-guardian.dto';
import { UpdateParentDto } from './dto/update-guardian.dto';
import { LinkStudentDto } from './dto/link-student.dto';
import { PlanLimitService } from '../../plans/plan-limit.service';
import { PaginationQueryDto } from '../../common/dto/pagination-query.dto';

@Injectable()
export class GuardianService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly planLimits: PlanLimitService,
  ) {}

  private ensureAdmin(user: RequestUser) {
    if (
      user.role !== UserRole.SCHOOL_ADMIN &&
      user.role !== UserRole.SUPER_ADMIN
    ) {
      throw new ForbiddenException(
        'Only school administrators can manage parents',
      );
    }
  }

  private async getMembership(user: RequestUser) {
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

    return membership;
  }

  private async getParentAttendanceContext(user: RequestUser) {
    if (user.role !== UserRole.PARENT) {
      throw new ForbiddenException(
        "Only parents can view their children's attendance",
      );
    }

    const membership = await this.getMembership(user);
    const parent = await this.prisma.parent.findFirst({
      where: {
        userId: user.id,
        schoolId: membership.schoolId,
      },
      select: { id: true },
    });

    if (!parent) {
      throw new NotFoundException('Parent profile not found');
    }

    return { parentId: parent.id, schoolId: membership.schoolId };
  }

  private async findPaginatedAttendance(
    where: Prisma.AttendanceWhereInput,
    query: PaginationQueryDto,
  ) {
    const page = query.getPage();
    const limit = query.getLimit();
    const [data, total] = await Promise.all([
      this.prisma.attendance.findMany({
        where,
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
          class: {
            select: { id: true, name: true, level: true },
          },
        },
        orderBy: [{ date: 'desc' }, { id: 'asc' }],
        skip: (page - 1) * limit,
        take: limit,
      }),
      this.prisma.attendance.count({ where }),
    ]);

    return {
      data,
      meta: { page, limit, total, totalPages: Math.ceil(total / limit) },
    };
  }

  async findMyAttendance(
    user: RequestUser,
    query: PaginationQueryDto = new PaginationQueryDto(),
  ) {
    const { parentId, schoolId } =
      await this.getParentAttendanceContext(user);
    const children = await this.prisma.studentGuardian.findMany({
      where: {
        parentId,
        student: { schoolId },
      },
      select: { studentId: true },
    });

    return this.findPaginatedAttendance(
      {
        studentId: { in: children.map((child) => child.studentId) },
        class: { schoolId },
      },
      query,
    );
  }

  async create(
    user: RequestUser,
    dto: CreateParentDto,
  ) {
    this.ensureAdmin(user);

    const membership =
      await this.getMembership(user);

    await this.planLimits.ensureCanCreate(membership.schoolId, 'parents');

    if (dto.email) {
      const existingParent =
        await this.prisma.parent.findFirst({
          where: {
            schoolId: membership.schoolId,
            email: dto.email,
          },
        });

      if (existingParent) {
        throw new ConflictException(
          'A parent with this email already exists in this school',
        );
      }
    }

    return this.prisma.parent.create({
      data: {
        schoolId: membership.schoolId,
        firstName: dto.firstName,
        lastName: dto.lastName,
        email: dto.email,
        phone: dto.phone,
        address: dto.address,
      },
    });
  }


  async findMe(user: RequestUser) {
    if (user.role !== UserRole.PARENT) {
      throw new ForbiddenException('Only parents can view their family profile');
    }

    const membership = await this.getMembership(user);
    const parent = await this.prisma.parent.findFirst({ where: { userId: user.id, schoolId: membership.schoolId }, include: {
      children: { include: { student: { include: { enrollments: { include: { class: true, academicSession: true } }, results: { where: { examination: { status: 'PUBLISHED' } }, include: { examination: true, subject: true, term: true } }, attendance: { orderBy: { date: 'desc' }, take: 100 }, invoices: { include: { term: true, payments: true, feeStructure: true } } } } } },
    }});
    if (!parent) throw new NotFoundException('Parent profile not found');
    return parent;
  }

  async findMyChild(user:RequestUser, studentId:string) {
   if(user.role !== UserRole.PARENT) {
    throw new ForbiddenException(
      'Only Parent can access this resource' )
    }
    const membership = await this.prisma.schoolMembership.findFirst({
      where:{ userId: user.id, ...(user.schoolId ? { schoolId: user.schoolId } : {})}
    })
    if (!membership){
      throw new NotFoundException(
        'You are not a member of any school',
      );
    }
    const student = await this.prisma.student.findFirst({
      where: {id: studentId, schoolId: membership.schoolId,
        guardians: { some: { parent: {userId: user.id, schoolId: membership.schoolId}}},
        include: {enrollments:{ include: {class: true, academicSession:true}},
        results: true, attendance:{ orderBy: { date: 'desc'},
         take:100,
        },  invoices: { include:{ term:true, payments: true, feeStructure: true}}
      }}
    })
  }

  async findChildAttendance(
    user: RequestUser,
    studentId: string,
    query: PaginationQueryDto = new PaginationQueryDto(),
  ){
    const { parentId, schoolId } =
      await this.getParentAttendanceContext(user);
    const student = await this.prisma.student.findFirst({
      where: {
        id: studentId,
        schoolId,
        guardians: { some: { parentId } },
      },
      select: { id: true },
    });

    if (!student) {
      throw new NotFoundException('Student not found');
    }

    return this.findPaginatedAttendance(
      {
        studentId: student.id,
        class: { schoolId },
      },
      query,
    );
  }
  
  async findAll(user: RequestUser, query: PaginationQueryDto = new PaginationQueryDto()) {
    this.ensureAdmin(user);
    const membership =
      await this.getMembership(user);

    const where: any = { schoolId: membership.schoolId, ...(query.search ? { OR: [
      { firstName: { contains: query.search, mode: 'insensitive' } },
      { lastName: { contains: query.search, mode: 'insensitive' } },
      { email: { contains: query.search, mode: 'insensitive' } },
    ] } : {}) };
    const page = query.getPage(); const limit = query.getLimit();
    const result = await this.prisma.parent.findMany({ where,
      include: {
        children: {
          include: {
            student: true,
          },
        },
      },
      orderBy: { lastName: 'asc' },
      ...(query.paginated ? { skip: (page - 1) * limit, take: limit } : {}),
    });
    if (!query.paginated) return result;
    const total = await this.prisma.parent.count({ where });
    return { data: result, meta: { page, limit, total, totalPages: Math.ceil(total / limit) } };
  }

  async findOne(
    user: RequestUser,
    id: string,
  ) {
    if (
      user.role !== UserRole.SCHOOL_ADMIN &&
      user.role !== UserRole.SUPER_ADMIN &&
      user.role !== UserRole.PARENT
    ) {
      throw new ForbiddenException('You are not allowed to view this parent');
    }

    const membership =
      await this.getMembership(user);

    const parent =
      await this.prisma.parent.findFirst({
        where: {
          id,
          schoolId: membership.schoolId,
          ...(user.role === UserRole.PARENT ? { userId: user.id } : {}),
        },
        include: {
          children: {
            include: {
              student: {
                include: {
                  enrollments: {
                    include: {
                      class: true,
                      academicSession: true,
                    },
                  },
                },
              },
            },
          },
        },
      });

    if (!parent) {
      throw new NotFoundException(
        'Parent not found',
      );
    }

    return parent;
  }

  async update(
    user: RequestUser,
    id: string,
    dto: UpdateParentDto,
  ) {
    this.ensureAdmin(user);

    const membership =
      await this.getMembership(user);

    const parent =
      await this.prisma.parent.findFirst({
        where: {
          id,
          schoolId: membership.schoolId,
        },
      });

    if (!parent) {
      throw new NotFoundException(
        'Parent not found',
      );
    }

    if (
      dto.email &&
      dto.email !== parent.email
    ) {
      const existingParent =
        await this.prisma.parent.findFirst({
          where: {
            schoolId: membership.schoolId,
            email: dto.email,
            NOT: {
              id,
            },
          },
        });

      if (existingParent) {
        throw new ConflictException(
          'A parent with this email already exists in this school',
        );
      }
    }

    return this.prisma.parent.update({
      where: {
        id,
      },
      data: {
        firstName: dto.firstName,
        lastName: dto.lastName,
        email: dto.email,
        phone: dto.phone,
        address: dto.address,
      },
    });
  }

  async remove(
    user: RequestUser,
    id: string,
  ) {
    this.ensureAdmin(user);

    const membership =
      await this.getMembership(user);

    const parent =
      await this.prisma.parent.findFirst({
        where: {
          id,
          schoolId: membership.schoolId,
        },
      });

    if (!parent) {
      throw new NotFoundException(
        'Parent not found',
      );
    }

    await this.prisma.parent.delete({
      where: {
        id,
      },
    });

    return {
      message: 'Parent removed successfully',
    };
  }

  async linkStudent(
    user: RequestUser,
    parentId: string,
    dto: LinkStudentDto,
  ) {
    this.ensureAdmin(user);

    const membership =
      await this.getMembership(user);

    const parent =
      await this.prisma.parent.findFirst({
        where: {
          id: parentId,
          schoolId: membership.schoolId,
        },
      });

    if (!parent) {
      throw new NotFoundException(
        'Parent not found',
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
        'Student not found',
      );
    }

    const existingLink =
      await this.prisma.studentGuardian.findUnique({
        where: {
          studentId_parentId: {
            studentId: student.id,
            parentId: parent.id,
          },
        },
      });

    if (existingLink) {
      throw new ConflictException(
        'This parent is already linked to this student',
      );
    }

    if (dto.isPrimary) {
      await this.prisma.studentGuardian.updateMany({
        where: {
          studentId: student.id,
          isPrimary: true,
        },
        data: {
          isPrimary: false,
        },
      });
    }

    return this.prisma.studentGuardian.create({
      data: {
        studentId: student.id,
        parentId: parent.id,
        relationship: dto.relationship,
        isPrimary: dto.isPrimary,
      },
      include: {
        parent: true,
        student: true,
      },
    });
  }

  async unlinkStudent(
    user: RequestUser,
    parentId: string,
    studentId: string,
  ) {
    this.ensureAdmin(user);

    const membership =
      await this.getMembership(user);

    const parent =
      await this.prisma.parent.findFirst({
        where: {
          id: parentId,
          schoolId: membership.schoolId,
        },
      });

    if (!parent) {
      throw new NotFoundException(
        'Parent not found',
      );
    }

    const student =
      await this.prisma.student.findFirst({
        where: {
          id: studentId,
          schoolId: membership.schoolId,
        },
      });

    if (!student) {
      throw new NotFoundException(
        'Student not found',
      );
    }

    const relationship =
      await this.prisma.studentGuardian.findUnique({
        where: {
          studentId_parentId: {
            studentId,
            parentId,
          },
        },
      });

    if (!relationship) {
      throw new NotFoundException(
        'Parent is not linked to this student',
      );
    }

    await this.prisma.studentGuardian.delete({
      where: {
        studentId_parentId: {
          studentId,
          parentId,
        },
      },
    });

    return {
      message:
        'Parent removed from student successfully',
    };
  }
}