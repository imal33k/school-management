import {
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';

import { CreateSchoolMembershipDto } from './dto/create-school-membership.dto';
import { UpdateSchoolMembershipDto } from './dto/update-school-membership.dto';
import { PrismaService } from '../prisma/prisma.service';
import { RequestUser } from '../auth/decorator/current-user.decorator';
import { Prisma, UserRole } from '@prisma/client';
import * as bcrypt from 'bcrypt';
import { CreateSchoolUserDto } from './dto/create-school-user.dto';
import { MembershipQueryDto } from './dto/membership-query.dto';
import { PlanLimitService } from '../plans/plan-limit.service';

@Injectable()
export class SchoolMembershipService {
  constructor(private readonly prisma: PrismaService, private readonly planLimits: PlanLimitService) {}

  async create(user: RequestUser,dto: CreateSchoolMembershipDto) {
    try {
      // SUPER_ADMIN can create any school membership
      if (user.role === UserRole.SUPER_ADMIN) {
        return await this.prisma.schoolMembership.create({
          data: {
            userId: dto.userId,
            schoolId: dto.schoolId,
            role: dto.role,
          },
        });
      }

      // Check if the authenticated user is a SCHOOL_ADMIN
      // of the school they are trying to manage
      const adminMembership =
        await this.prisma.schoolMembership.findFirst({
          where: {
            userId: user.id,
            schoolId: dto.schoolId,
            role: UserRole.SCHOOL_ADMIN,
          },
        });

      if (!adminMembership) {
        throw new ForbiddenException(
          'You cannot manage this school',
        );
      }

      // SCHOOL_ADMIN cannot create another SCHOOL_ADMIN
      if (dto.role === UserRole.SCHOOL_ADMIN) {
        throw new ForbiddenException(
          'School admins cannot create another school admin',
        );
      }

      return await this.prisma.schoolMembership.create({
        data: {
          userId: dto.userId,
          schoolId: dto.schoolId,
          role: dto.role,
        },
      });
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002'
      ) {
        throw new ConflictException(
          'Membership already exists for this user in this school',
        );
      }

      throw error;
    }
  }

  async createUser(user: RequestUser, dto: CreateSchoolUserDto) {
    const adminMembership = await this.prisma.schoolMembership.findFirst({ where: { userId: user.id, role: UserRole.SCHOOL_ADMIN } });
    if (user.role !== UserRole.SUPER_ADMIN && !adminMembership) throw new ForbiddenException('Only school administrators can create school users');
    const schoolId = user.role === UserRole.SUPER_ADMIN ? dto.schoolId : adminMembership!.schoolId;
    if (!schoolId) throw new ForbiddenException('A school could not be resolved');
    if (dto.role === UserRole.SUPER_ADMIN || dto.role === UserRole.SCHOOL_ADMIN) {
      throw new ForbiddenException('Use the super-admin school administration flow to create administrators');
    }
    if (dto.role === UserRole.STUDENT && !dto.admissionNumber) throw new ConflictException('admissionNumber is required for student accounts');
    if (dto.role === UserRole.STUDENT) await this.planLimits.ensureCanCreate(schoolId, 'students');
    if (dto.role === UserRole.PARENT) await this.planLimits.ensureCanCreate(schoolId, 'parents');
    const existing = await this.prisma.user.findUnique({ where: { email: dto.email } });
    if (existing) throw new ConflictException('A user with this email already exists');
    const password = await bcrypt.hash(dto.password, 10);
    return this.prisma.$transaction(async tx => {
      const createdUser = await tx.user.create({ data: { email: dto.email, password, firstName: dto.firstName, lastName: dto.lastName, phone: dto.phone, role: dto.role } });
      await tx.schoolMembership.create({ data: { userId: createdUser.id, schoolId, role: dto.role } });
      if (dto.role === UserRole.PARENT) await tx.parent.create({ data: { schoolId, userId: createdUser.id, firstName: dto.firstName, lastName: dto.lastName, email: dto.email, phone: dto.phone } });
      if (dto.role === UserRole.STUDENT) await tx.student.create({ data: { schoolId, userId: createdUser.id, admissionNumber: dto.admissionNumber!, firstName: dto.firstName, lastName: dto.lastName, email: dto.email, phone: dto.phone } });
      return { id: createdUser.id, email: createdUser.email, firstName: createdUser.firstName, lastName: createdUser.lastName, role: createdUser.role, schoolId };
    });
  }

  async findByUser(
    user: RequestUser,
    userId: string,
  ) {
    // SUPER_ADMIN can view any user's memberships
    if (user.role === UserRole.SUPER_ADMIN) {
      return this.prisma.schoolMembership.findMany({
        where: {
          userId,
        },
      });
    }

    // Users can view their own memberships
    if (user.id === userId) {
      return this.prisma.schoolMembership.findMany({
        where: {
          userId,
        },
      });
    }

    // SCHOOL_ADMIN can view users in their schools
    const adminMemberships =
      await this.prisma.schoolMembership.findMany({
        where: {
          userId: user.id,
          role: UserRole.SCHOOL_ADMIN,
        },
      });

    const schoolIds = adminMemberships.map(
      (membership) => membership.schoolId,
    );

    if (schoolIds.length === 0) {
      throw new ForbiddenException(
        'You are not allowed to view this user',
      );
    }

    return this.prisma.schoolMembership.findMany({
      where: {
        userId,
        schoolId: {
          in: schoolIds,
        },
      },
    });
  }

  async findBySchool(
    user: RequestUser,
    schoolId: string,
    query: MembershipQueryDto = new MembershipQueryDto(),
  ) {
    // SUPER_ADMIN can view any school
    if (user.role === UserRole.SUPER_ADMIN) {
      return this.prisma.schoolMembership.findMany({
        where: {
          schoolId,
        },
      });
    }

    // Check whether the user is a SCHOOL_ADMIN
    // of this school
    const adminMembership =
      await this.prisma.schoolMembership.findFirst({
        where: {
          userId: user.id,
          schoolId,
          role: UserRole.SCHOOL_ADMIN,
        },
      });

    if (!adminMembership) {
      throw new ForbiddenException(
        'You cannot view this school',
      );
    }

    const page = Number(query.page ?? 1);
    const limit = Number(query.limit ?? 20);
    const where: Prisma.SchoolMembershipWhereInput = {
      schoolId,
      ...(query.role ? { role: query.role as UserRole } : {}),
      ...(query.search ? { user: { OR: [
        { firstName: { contains: query.search, mode: 'insensitive' } },
        { lastName: { contains: query.search, mode: 'insensitive' } },
        { email: { contains: query.search, mode: 'insensitive' } },
      ] } } : {}),
    };
    const [data, total] = await Promise.all([
      this.prisma.schoolMembership.findMany({
        where,
        include: { user: { select: { id: true, email: true, firstName: true, lastName: true, phone: true, role: true, status: true } } },
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
      }),
      this.prisma.schoolMembership.count({ where }),
    ]);
    return { data, meta: { page, limit, total, totalPages: Math.ceil(total / limit) } };
  }

  async findOne(
    user: RequestUser,
    id: string,
  ) {
    const membership =
      await this.prisma.schoolMembership.findUnique({
        where: {
          id,
        },
      });

    if (!membership) {
      throw new NotFoundException(
        'Membership not found',
      );
    }

    // SUPER_ADMIN can access any membership
    if (user.role === UserRole.SUPER_ADMIN) {
      return membership;
    }

    // User can access their own membership
    if (membership.userId === user.id) {
      return membership;
    }

    // Check whether the user is a SCHOOL_ADMIN
    // of the membership's school
    const adminMembership =
      await this.prisma.schoolMembership.findFirst({
        where: {
          userId: user.id,
          schoolId: membership.schoolId,
          role: UserRole.SCHOOL_ADMIN,
        },
      });

    if (adminMembership) {
      return membership;
    }

    throw new ForbiddenException(
      'You are not allowed to view this membership',
    );
  }

  async updateRole(
    user: RequestUser,
    id: string,
    dto: UpdateSchoolMembershipDto,
  ) {
    const membership =
      await this.prisma.schoolMembership.findUnique({
        where: {
          id,
        },
      });

    if (!membership) {
      throw new NotFoundException(
        'Membership does not exist',
      );
    }

    // SUPER_ADMIN can change any membership role
    if (user.role === UserRole.SUPER_ADMIN) {
      return this.prisma.schoolMembership.update({
        where: {
          id,
        },
        data: {
          role: dto.role,
        },
      });
    }

    // Check whether the user is a SCHOOL_ADMIN
    // of the membership's school
    const adminMembership =
      await this.prisma.schoolMembership.findFirst({
        where: {
          userId: user.id,
          schoolId: membership.schoolId,
          role: UserRole.SCHOOL_ADMIN,
        },
      });

    if (!adminMembership) {
      throw new ForbiddenException(
        'You cannot manage this school',
      );
    }

    // Cannot modify another SCHOOL_ADMIN
    if (membership.role === UserRole.SCHOOL_ADMIN) {
      throw new ForbiddenException(
        'You cannot change another school admin role',
      );
    }

    // Cannot promote someone to SCHOOL_ADMIN
    if (dto.role === UserRole.SCHOOL_ADMIN) {
      throw new ForbiddenException(
        'You cannot promote someone to school admin',
      );
    }

    return this.prisma.schoolMembership.update({
      where: {
        id,
      },
      data: {
        role: dto.role,
      },
    });
  }

  async remove(
    user: RequestUser,
    id: string,
  ) {
    const membership =
      await this.prisma.schoolMembership.findUnique({
        where: {
          id,
        },
      });

    if (!membership) {
      throw new NotFoundException(
        'Membership not found',
      );
    }

    // SUPER_ADMIN can delete any membership
    if (user.role === UserRole.SUPER_ADMIN) {
      return this.prisma.schoolMembership.delete({
        where: {
          id,
        },
      });
    }

    // Check whether the user is a SCHOOL_ADMIN
    // of the membership's school
    const adminMembership =
      await this.prisma.schoolMembership.findFirst({
        where: {
          userId: user.id,
          schoolId: membership.schoolId,
          role: UserRole.SCHOOL_ADMIN,
        },
      });

    if (!adminMembership) {
      throw new ForbiddenException(
        'You cannot manage this school',
      );
    }

    // Cannot delete another SCHOOL_ADMIN
    if (membership.role === UserRole.SCHOOL_ADMIN) {
      throw new ForbiddenException(
        'You cannot delete another school admin',
      );
    }

    return this.prisma.schoolMembership.delete({
      where: {
        id,
      },
    });
  }

  
}