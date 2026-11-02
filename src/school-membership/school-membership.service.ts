import {
  BadRequestException,
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
import { createHash, randomBytes } from 'crypto';
import { EmailService } from '../common/email.service';
import { CreateSchoolInvitationDto } from './dto/create-school-invitation.dto';
import { AcceptSchoolInvitationDto } from './dto/accept-school-invitation.dto';

@Injectable()
export class SchoolMembershipService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly planLimits: PlanLimitService,
    private readonly email: EmailService,
  ) {}

  private isSchoolRole(role: UserRole | undefined): role is UserRole {
    return role !== undefined && role !== UserRole.SUPER_ADMIN;
  }

  async create(user: RequestUser, dto: CreateSchoolMembershipDto) {
    if (!this.isSchoolRole(dto.role)) {
      throw new ForbiddenException(
        'Super-admin access cannot be assigned through a school membership',
      );
    }

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
      const adminMembership = await this.prisma.schoolMembership.findFirst({
        where: {
          userId: user.id,
          schoolId: dto.schoolId,
          role: UserRole.SCHOOL_ADMIN,
        },
      });

      if (!adminMembership) {
        throw new ForbiddenException('You cannot manage this school');
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

  async createInvitation(user: RequestUser, dto: CreateSchoolInvitationDto) {
    const allowedRoles: UserRole[] = [
      UserRole.ACCOUNTANT,
      UserRole.TEACHER,
      UserRole.PARENT,
      UserRole.STUDENT,
    ];
    if (!allowedRoles.includes(dto.role)) {
      throw new BadRequestException(
        'Invitations can only be created for accountant, teacher, parent, or student roles',
      );
    }

    const adminMembership =
      user.role === UserRole.SUPER_ADMIN
        ? null
        : await this.prisma.schoolMembership.findFirst({
            where: { userId: user.id, role: UserRole.SCHOOL_ADMIN },
          });

    if (user.role !== UserRole.SUPER_ADMIN && !adminMembership) {
      throw new ForbiddenException(
        'Only school administrators can invite users',
      );
    }

    const schoolId =
      user.role === UserRole.SUPER_ADMIN
        ? dto.schoolId
        : adminMembership!.schoolId;
    if (!schoolId) {
      throw new BadRequestException(
        'schoolId is required for super-admin invitations',
      );
    }

    this.email.assertConfigured();
    const appUrl = (
      process.env.FRONTEND_URL ?? 'http://localhost:5173'
    ).replace(/\/$/, '');

    if (dto.role === UserRole.TEACHER && !dto.employeeId) {
      throw new BadRequestException(
        'employeeId is required for teacher invitations',
      );
    }
    if (dto.role === UserRole.STUDENT && !dto.admissionNumber) {
      throw new BadRequestException(
        'admissionNumber is required for student invitations',
      );
    }

    const existingUser = await this.prisma.user.findUnique({
      where: { email: dto.email },
    });
    if (existingUser) {
      throw new ConflictException(
        'This email already has an account; add the user through school membership instead',
      );
    }

    const existingInvitation = await this.prisma.schoolInvitation.findFirst({
      where: {
        schoolId,
        email: dto.email,
        acceptedAt: null,
        expiresAt: { gt: new Date() },
      },
    });
    if (existingInvitation) {
      throw new ConflictException(
        'An invitation is already pending for this email',
      );
    }

    if (dto.role === UserRole.STUDENT) {
      await this.planLimits.ensureCanCreate(schoolId, 'students');
    } else if (dto.role === UserRole.TEACHER) {
      await this.planLimits.ensureCanCreate(schoolId, 'teachers');
    } else if (dto.role === UserRole.PARENT) {
      await this.planLimits.ensureCanCreate(schoolId, 'parents');
    }

    const rawToken = randomBytes(32).toString('hex');
    const tokenHash = createHash('sha256').update(rawToken).digest('hex');
    const invitation = await this.prisma.schoolInvitation.create({
      data: {
        schoolId,
        createdById: user.id,
        email: dto.email,
        role: dto.role,
        employeeId: dto.employeeId,
        admissionNumber: dto.admissionNumber,
        tokenHash,
        expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
      },
    });

    try {
      await this.email.send(
        dto.email,
        'You are invited to join a school',
        `Accept this invitation within seven days: ${appUrl}/accept-invitation?token=${rawToken}`,
      );
    } catch (error) {
      await this.prisma.schoolInvitation.delete({
        where: { id: invitation.id },
      });
      throw error;
    }

    return { message: 'Invitation sent successfully' };
  }

  async acceptInvitation(dto: AcceptSchoolInvitationDto) {
    const tokenHash = createHash('sha256').update(dto.token).digest('hex');
    const now = new Date();
    const invitation = await this.prisma.schoolInvitation.findFirst({
      where: {
        tokenHash,
        acceptedAt: null,
        expiresAt: { gt: now },
      },
    });
    if (!invitation) {
      throw new BadRequestException('Invitation is invalid or expired');
    }

    await this.planLimits.ensureSubscriptionActive(invitation.schoolId);

    const existingUser = await this.prisma.user.findUnique({
      where: { email: invitation.email },
    });
    if (existingUser) {
      throw new ConflictException(
        'An account already exists for this email; contact the school administrator',
      );
    }

    if (invitation.role === UserRole.TEACHER) {
      await this.planLimits.ensureCanCreate(invitation.schoolId, 'teachers');
    } else if (invitation.role === UserRole.STUDENT) {
      await this.planLimits.ensureCanCreate(invitation.schoolId, 'students');
    } else if (invitation.role === UserRole.PARENT) {
      await this.planLimits.ensureCanCreate(invitation.schoolId, 'parents');
    }

    const password = await bcrypt.hash(dto.password, 10);
    try {
      return await this.prisma.$transaction(async (tx) => {
        const consumed = await tx.schoolInvitation.updateMany({
          where: {
            id: invitation.id,
            acceptedAt: null,
            expiresAt: { gt: now },
          },
          data: { acceptedAt: now },
        });
        if (consumed.count !== 1) {
          throw new BadRequestException('Invitation is invalid or expired');
        }

        const createdUser = await tx.user.create({
          data: {
            email: invitation.email,
            password,
            firstName: dto.firstName,
            lastName: dto.lastName,
            phone: dto.phone,
            role: invitation.role,
            emailVerifiedAt: now,
          },
        });
        await tx.schoolMembership.create({
          data: {
            userId: createdUser.id,
            schoolId: invitation.schoolId,
            role: invitation.role,
          },
        });

        if (invitation.role === UserRole.TEACHER) {
          await tx.teacher.create({
            data: {
              schoolId: invitation.schoolId,
              userId: createdUser.id,
              employeeId: invitation.employeeId!,
              firstName: dto.firstName,
              lastName: dto.lastName,
              email: invitation.email,
              phone: dto.phone,
            },
          });
        } else if (invitation.role === UserRole.STUDENT) {
          await tx.student.create({
            data: {
              schoolId: invitation.schoolId,
              userId: createdUser.id,
              admissionNumber: invitation.admissionNumber!,
              firstName: dto.firstName,
              lastName: dto.lastName,
              email: invitation.email,
              phone: dto.phone,
            },
          });
        } else if (invitation.role === UserRole.PARENT) {
          await tx.parent.create({
            data: {
              schoolId: invitation.schoolId,
              userId: createdUser.id,
              firstName: dto.firstName,
              lastName: dto.lastName,
              email: invitation.email,
              phone: dto.phone,
            },
          });
        }

        return {
          id: createdUser.id,
          email: createdUser.email,
          role: createdUser.role,
          schoolId: invitation.schoolId,
        };
      });
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002'
      ) {
        throw new ConflictException(
          'The invitation conflicts with an existing account or profile',
        );
      }
      throw error;
    }
  }

  async createUser(user: RequestUser, dto: CreateSchoolUserDto) {
    const adminMembership = await this.prisma.schoolMembership.findFirst({
      where: { userId: user.id, role: UserRole.SCHOOL_ADMIN },
    });
    if (user.role !== UserRole.SUPER_ADMIN && !adminMembership)
      throw new ForbiddenException(
        'Only school administrators can create school users',
      );
    const schoolId =
      user.role === UserRole.SUPER_ADMIN
        ? dto.schoolId
        : adminMembership!.schoolId;
    if (!schoolId)
      throw new ForbiddenException('A school could not be resolved');
    const allowedUserRoles: UserRole[] = [
      UserRole.ACCOUNTANT,
      UserRole.PARENT,
      UserRole.STUDENT,
    ];
    if (!allowedUserRoles.includes(dto.role)) {
      throw new ForbiddenException(
        'Use the dedicated teachers or administrator endpoint for this role',
      );
    }
    if (dto.role === UserRole.STUDENT && !dto.admissionNumber)
      throw new ConflictException(
        'admissionNumber is required for student accounts',
      );
    if (dto.role === UserRole.STUDENT)
      await this.planLimits.ensureCanCreate(schoolId, 'students');
    if (dto.role === UserRole.PARENT)
      await this.planLimits.ensureCanCreate(schoolId, 'parents');
    const existing = await this.prisma.user.findUnique({
      where: { email: dto.email },
    });
    if (existing)
      throw new ConflictException('A user with this email already exists');
    const password = await bcrypt.hash(dto.password, 10);
    return this.prisma.$transaction(async (tx) => {
      const createdUser = await tx.user.create({
        data: {
          email: dto.email,
          password,
          firstName: dto.firstName,
          lastName: dto.lastName,
          phone: dto.phone,
          role: dto.role,
          emailVerifiedAt: new Date(),
        },
      });
      await tx.schoolMembership.create({
        data: { userId: createdUser.id, schoolId, role: dto.role },
      });
      if (dto.role === UserRole.PARENT)
        await tx.parent.create({
          data: {
            schoolId,
            userId: createdUser.id,
            firstName: dto.firstName,
            lastName: dto.lastName,
            email: dto.email,
            phone: dto.phone,
          },
        });
      if (dto.role === UserRole.STUDENT)
        await tx.student.create({
          data: {
            schoolId,
            userId: createdUser.id,
            admissionNumber: dto.admissionNumber!,
            firstName: dto.firstName,
            lastName: dto.lastName,
            email: dto.email,
            phone: dto.phone,
          },
        });
      return {
        id: createdUser.id,
        email: createdUser.email,
        firstName: createdUser.firstName,
        lastName: createdUser.lastName,
        role: createdUser.role,
        schoolId,
      };
    });
  }

  async findByUser(user: RequestUser, userId: string) {
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
    const adminMemberships = await this.prisma.schoolMembership.findMany({
      where: {
        userId: user.id,
        role: UserRole.SCHOOL_ADMIN,
      },
    });

    const schoolIds = adminMemberships.map((membership) => membership.schoolId);

    if (schoolIds.length === 0) {
      throw new ForbiddenException('You are not allowed to view this user');
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
    const adminMembership = await this.prisma.schoolMembership.findFirst({
      where: {
        userId: user.id,
        schoolId,
        role: UserRole.SCHOOL_ADMIN,
      },
    });

    if (!adminMembership) {
      throw new ForbiddenException('You cannot view this school');
    }

    const page = Number(query.page ?? 1);
    const limit = Number(query.limit ?? 20);
    const where: Prisma.SchoolMembershipWhereInput = {
      schoolId,
      ...(query.role ? { role: query.role as UserRole } : {}),
      ...(query.search
        ? {
            user: {
              OR: [
                { firstName: { contains: query.search, mode: 'insensitive' } },
                { lastName: { contains: query.search, mode: 'insensitive' } },
                { email: { contains: query.search, mode: 'insensitive' } },
              ],
            },
          }
        : {}),
    };
    const [data, total] = await Promise.all([
      this.prisma.schoolMembership.findMany({
        where,
        include: {
          user: {
            select: {
              id: true,
              email: true,
              firstName: true,
              lastName: true,
              phone: true,
              role: true,
              status: true,
            },
          },
        },
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
      }),
      this.prisma.schoolMembership.count({ where }),
    ]);
    return {
      data,
      meta: { page, limit, total, totalPages: Math.ceil(total / limit) },
    };
  }

  async findOne(user: RequestUser, id: string) {
    const membership = await this.prisma.schoolMembership.findUnique({
      where: {
        id,
      },
    });

    if (!membership) {
      throw new NotFoundException('Membership not found');
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
    const adminMembership = await this.prisma.schoolMembership.findFirst({
      where: {
        userId: user.id,
        schoolId: membership.schoolId,
        role: UserRole.SCHOOL_ADMIN,
      },
    });

    if (adminMembership) {
      return membership;
    }

    throw new ForbiddenException('You are not allowed to view this membership');
  }

  async updateRole(
    user: RequestUser,
    id: string,
    dto: UpdateSchoolMembershipDto,
  ) {
    const membership = await this.prisma.schoolMembership.findUnique({
      where: {
        id,
      },
    });

    if (!membership) {
      throw new NotFoundException('Membership does not exist');
    }

    // SUPER_ADMIN can change any membership role
    if (user.role === UserRole.SUPER_ADMIN) {
      if (!this.isSchoolRole(dto.role)) {
        throw new BadRequestException(
          'Super-admin access cannot be assigned through a school membership',
        );
      }
      return this.prisma.schoolMembership.update({
        where: { id },
        data: { role: dto.role },
      });
    }

    // Check whether the user is a SCHOOL_ADMIN
    // of the membership's school
    const adminMembership = await this.prisma.schoolMembership.findFirst({
      where: {
        userId: user.id,
        schoolId: membership.schoolId,
        role: UserRole.SCHOOL_ADMIN,
      },
    });

    if (!adminMembership) {
      throw new ForbiddenException('You cannot manage this school');
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

    if (!this.isSchoolRole(dto.role)) {
      throw new BadRequestException(
        'Super-admin access cannot be assigned through a school membership',
      );
    }

    return this.prisma.schoolMembership.update({
      where: { id },
      data: { role: dto.role },
    });
  }

  async remove(user: RequestUser, id: string) {
    const membership = await this.prisma.schoolMembership.findUnique({
      where: {
        id,
      },
    });

    if (!membership) {
      throw new NotFoundException('Membership not found');
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
    const adminMembership = await this.prisma.schoolMembership.findFirst({
      where: {
        userId: user.id,
        schoolId: membership.schoolId,
        role: UserRole.SCHOOL_ADMIN,
      },
    });

    if (!adminMembership) {
      throw new ForbiddenException('You cannot manage this school');
    }

    // Cannot delete another SCHOOL_ADMIN
    if (membership.role === UserRole.SCHOOL_ADMIN) {
      throw new ForbiddenException('You cannot delete another school admin');
    }

    return this.prisma.schoolMembership.delete({
      where: {
        id,
      },
    });
  }
}
