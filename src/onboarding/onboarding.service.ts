import {
  ConflictException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';

import { Prisma, UserRole } from '@prisma/client';

import { PrismaService } from '../prisma/prisma.service';

import { RequestUser } from '../auth/decorator/current-user.decorator';

import { CreateSchoolOnboardingDto } from './dto/create-onboarding.dto';

@Injectable()
export class OnboardingService {
  constructor(
    private readonly prisma: PrismaService,
  ) {}

  async createSchool(
    user: RequestUser,
    dto: CreateSchoolOnboardingDto,
  ) {
    const existingUser = await this.prisma.user.findUnique({
      where: { id: user.id },
      select: {
        id: true,
        email: true,
        firstName: true,
        lastName: true,
        role: true,
      },
    });

    if (!existingUser) {
      throw new UnauthorizedException('User not found');
    }

    const existingMembership = await this.prisma.schoolMembership.findFirst({
      where: { userId: existingUser.id },
    });

    if (existingMembership) {
      throw new ConflictException('You already belong to a school');
    }

    const slug = await this.generateUniqueSlug(
      dto.name,
    );

    try {
      const result =
        await this.prisma.$transaction(
          async (tx) => {
            const school =
              await tx.school.create({
                data: {
                  name: dto.name,
                  slug,
                  email: dto.email,
                  phone: dto.phone,
                  address: dto.address,
                  website: dto.website,
                },
              });

            const membership =
              await tx.schoolMembership.create({
                data: {
                  userId: existingUser.id,
                  schoolId: school.id,
                  role: UserRole.SCHOOL_ADMIN,
                },
              });

            return {
              user: {
                id: existingUser.id,
                email: existingUser.email,
                firstName: existingUser.firstName,
                lastName: existingUser.lastName,
                role: existingUser.role,
              },
              school: {
                id: school.id,
                name: school.name,
                slug: school.slug,
                email: school.email,
                phone: school.phone,
                address: school.address,
                website: school.website,
              },
              membership: {
                id: membership.id,
                userId: membership.userId,
                schoolId: membership.schoolId,
                role: membership.role,
                createdAt: membership.createdAt,
              },
            };
          },
        );

      return result;
    } catch (error) {
      if (
        error instanceof
          Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002'
      ) {
        throw new ConflictException(
          'A school with this information already exists',
        );
      }

      throw error;
    }
  }

  private async generateUniqueSlug(
    schoolName: string,
  ): Promise<string> {
    const baseSlug = this.slugify(schoolName);

    let slug = baseSlug;
    let counter = 1;

    while (
      await this.prisma.school.findUnique({
        where: {
          slug,
        },
      })
    ) {
      slug = `${baseSlug}-${counter}`;
      counter++;
    }

    return slug;
  }

  private slugify(value: string): string {
    return value
      .toLowerCase()
      .trim()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '');
  }

}