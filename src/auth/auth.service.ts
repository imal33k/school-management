import {
  BadRequestException,
  ConflictException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';

import { RegisterDto } from './dto/register.dto';
import { LoginDto } from './dto/login.dto';
import { ChangePasswordDto } from './dto/change-password.dto';
import { RequestUser } from './decorator/current-user.decorator';

import { PrismaService } from '../prisma/prisma.service';

import * as bcrypt from 'bcrypt';

import { JwtService } from '@nestjs/jwt';
import { Prisma, UserRole } from '@prisma/client';
import { createHash, randomBytes, randomUUID } from 'crypto';
import { EmailService } from '../common/email.service';
import { ForgotPasswordDto } from './dto/forgot-password.dto';
import { ResetPasswordDto } from './dto/reset-password.dto';
import { VerifyEmailDto } from './dto/verify-email.dto';

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jwtService: JwtService,
    private readonly email: EmailService,
  ) {}

  private buildAccessTokenPayload(
    user: { id: string; email: string; role: UserRole },
    sessionId: string,
  ) {
    return {
      sub: user.id,
      email: user.email,
      role: user.role,
      tokenType: 'access',
      sessionId,
    };
  }

  private hashToken(token: string) {
    return createHash('sha256').update(token).digest('hex');
  }

  private resolveLoginEmail(dto: LoginDto): string {
    const email = dto.email ?? dto.schoolemail;
    if (!email) {
      throw new BadRequestException('Email is required');
    }
    return email;
  }

  private getFrontendUrl() {
    return (process.env.FRONTEND_URL ?? 'http://localhost:5173').replace(
      /\/$/,
      '',
    );
  }

  private isEmailVerificationBypassed() {
    return (
      process.env.NODE_ENV === 'development' &&
      process.env.SKIP_EMAIL_VERIFICATION === 'true'
    );
  }

  private async sendVerificationEmail(userId: string, email: string) {
    const rawToken = randomBytes(32).toString('hex');
    const tokenHash = this.hashToken(rawToken);
    await this.prisma.$transaction([
      this.prisma.emailVerificationToken.deleteMany({
        where: { userId, usedAt: null },
      }),
      this.prisma.emailVerificationToken.create({
        data: {
          userId,
          tokenHash,
          expiresAt: new Date(Date.now() + 60 * 60 * 1000),
        },
      }),
    ]);

    try {
      await this.email.send(
        email,
        'Verify your schoolhouse email',
        `Verify your email within one hour: ${this.getFrontendUrl()}/verify-email?token=${rawToken}`,
      );
    } catch (error) {
      await this.prisma.emailVerificationToken.deleteMany({
        where: { tokenHash },
      });
      throw error;
    }
  }

  private async generateSchoolSlug(name: string): Promise<string> {
    const baseSlug = name
      .toLowerCase()
      .trim()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '');
    let slug = baseSlug;
    let suffix = 1;

    while (await this.prisma.school.findUnique({ where: { slug } })) {
      slug = `${baseSlug}-${suffix}`;
      suffix += 1;
    }

    return slug;
  }

  private async issueRefreshToken(userId: string) {
    const refreshToken = randomBytes(32).toString('hex');
    const tokenHash = this.hashToken(refreshToken);
    const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
    const familyId = randomUUID();

    await this.prisma.refreshToken.create({
      data: {
        userId,
        familyId,
        tokenHash,
        expiresAt,
      },
    });

    return {
      refreshToken,
      expiresAt,
      familyId,
    };
  }

  async register(registerDto: RegisterDto) {
    const skipEmailVerification = this.isEmailVerificationBypassed();
    if (!skipEmailVerification) {
      this.email.assertConfigured();
    }

    const existingUser = await this.prisma.user.findUnique({
      where: {
        email: registerDto.schoolemail,
      },
    });

    if (existingUser) {
      throw new ConflictException('This email already exists');
    }

    const hashedPassword = await bcrypt.hash(registerDto.password, 10);
    const slug = await this.generateSchoolSlug(registerDto.schoolName);

    let createdAccount: {
      id: string;
      email: string;
      firstName: string;
      lastName: string;
      phone: string | null;
      role: UserRole;
      school: { id: string; name: string; address: string | null };
    };
    try {
      createdAccount = await this.prisma.$transaction(async (tx) => {
        const user = await tx.user.create({
          data: {
            email: registerDto.schoolemail,
            password: hashedPassword,
            firstName: 'School',
            lastName: 'Admin',
            phone: registerDto.phone,
            role: UserRole.SCHOOL_ADMIN,
            emailVerifiedAt: skipEmailVerification ? new Date() : null,
          },
        });

        const school = await tx.school.create({
          data: {
            name: registerDto.schoolName,
            slug,
            email: registerDto.schoolemail,
            phone: registerDto.phone,
            address: registerDto.schooladdress,
          },
        });

        await tx.schoolMembership.create({
          data: {
            userId: user.id,
            schoolId: school.id,
            role: UserRole.SCHOOL_ADMIN,
          },
        });

        return {
          id: user.id,
          email: user.email,
          firstName: user.firstName,
          lastName: user.lastName,
          phone: user.phone,
          role: user.role,
          school: {
            id: school.id,
            name: school.name,
            address: school.address,
          },
        };
      });
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002'
      ) {
        throw new ConflictException(
          'A user or school with this information already exists',
        );
      }
      throw error;
    }

    if (skipEmailVerification) {
      return {
        message:
          'Account created. Email verification is disabled for this development environment.',
      };
    }

    await this.sendVerificationEmail(createdAccount.id, createdAccount.email);
    return {
      message: 'Check your email for a verification link before signing in.',
    };
  }

  async verifyEmail(dto: VerifyEmailDto) {
    const tokenHash = this.hashToken(dto.token);
    const now = new Date();
    const token = await this.prisma.emailVerificationToken.findFirst({
      where: { tokenHash, usedAt: null, expiresAt: { gt: now } },
      select: { id: true, userId: true },
    });
    if (!token) {
      throw new UnauthorizedException(
        'Email verification link is invalid or expired',
      );
    }

    await this.prisma.$transaction(async (tx) => {
      const consumed = await tx.emailVerificationToken.updateMany({
        where: {
          id: token.id,
          usedAt: null,
          expiresAt: { gt: now },
        },
        data: { usedAt: now },
      });
      if (consumed.count !== 1) {
        throw new UnauthorizedException(
          'Email verification link is invalid or expired',
        );
      }

      await tx.user.update({
        where: { id: token.userId },
        data: {
          emailVerifiedAt: now,
          failedLoginAttempts: 0,
          lockedUntil: null,
        },
      });
      await tx.emailVerificationToken.deleteMany({
        where: { userId: token.userId, id: { not: token.id } },
      });
    });

    return { message: 'Email verified. You can now sign in.' };
  }

  async resendEmailVerification(email: string) {
    if (this.isEmailVerificationBypassed()) {
      return {
        message: 'Email verification is disabled for this development environment.',
      };
    }

    this.email.assertConfigured();
    const user = await this.prisma.user.findUnique({
      where: { email },
      select: { id: true, email: true, emailVerifiedAt: true },
    });
    if (user && !user.emailVerifiedAt) {
      await this.sendVerificationEmail(user.id, user.email);
    }
    return {
      message:
        'If the address belongs to an unverified account, a verification link has been sent.',
    };
  }

  async changePassword(user: RequestUser, dto: ChangePasswordDto) {
    const existing = await this.prisma.user.findUnique({
      where: { id: user.id },
    });
    if (!existing) throw new UnauthorizedException('User not found');
    const valid = await bcrypt.compare(dto.currentPassword, existing.password);
    if (!valid)
      throw new UnauthorizedException('Current password is incorrect');
    await this.prisma.$transaction([
      this.prisma.user.update({
        where: { id: existing.id },
        data: {
          password: await bcrypt.hash(dto.newPassword, 10),
          mustChangePassword: false,
        },
      }),
      this.prisma.passwordResetToken.deleteMany({
        where: { userId: existing.id, usedAt: null },
      }),
      this.prisma.refreshToken.updateMany({
        where: { userId: existing.id, revokedAt: null },
        data: { revokedAt: new Date() },
      }),
    ]);
    return { message: 'Password changed successfully' };
  }

  async forgotPassword(dto: ForgotPasswordDto) {
    this.email.assertConfigured();
    const user = await this.prisma.user.findUnique({
      where: { email: dto.email },
    });

    if (user) {
      const token = randomBytes(32).toString('hex');
      const tokenHash = createHash('sha256').update(token).digest('hex');
      const expiresAt = new Date(Date.now() + 60 * 60 * 1000);

      await this.prisma.$transaction([
        this.prisma.passwordResetToken.deleteMany({
          where: { userId: user.id, usedAt: null },
        }),
        this.prisma.passwordResetToken.create({
          data: { userId: user.id, tokenHash, expiresAt },
        }),
      ]);

      try {
        await this.email.send(
          user.email,
          'Reset your password',
          `Use this link within one hour to reset your password: ${this.getFrontendUrl()}/reset-password?token=${token}`,
        );
      } catch (error) {
        await this.prisma.passwordResetToken.deleteMany({
          where: { tokenHash },
        });
        throw error;
      }
    }

    return {
      message: 'If the account exists, a password reset email has been sent.',
    };
  }

  async resetPassword(dto: ResetPasswordDto) {
    const tokenHash = createHash('sha256').update(dto.token).digest('hex');
    const now = new Date();
    const token = await this.prisma.passwordResetToken.findFirst({
      where: { tokenHash, usedAt: null, expiresAt: { gt: now } },
    });

    if (!token) {
      throw new UnauthorizedException(
        'Password reset token is invalid or expired',
      );
    }

    const password = await bcrypt.hash(dto.password, 10);
    await this.prisma.$transaction(async (tx) => {
      const consumed = await tx.passwordResetToken.updateMany({
        where: {
          id: token.id,
          usedAt: null,
          expiresAt: { gt: now },
        },
        data: { usedAt: now },
      });

      if (consumed.count !== 1) {
        throw new UnauthorizedException(
          'Password reset token is invalid or expired',
        );
      }

      await tx.user.update({
        where: { id: token.userId },
        data: {
          password,
          failedLoginAttempts: 0,
          lockedUntil: null,
        },
      });
      await tx.passwordResetToken.deleteMany({
        where: { userId: token.userId, id: { not: token.id } },
      });
      await tx.refreshToken.updateMany({
        where: { userId: token.userId, revokedAt: null },
        data: { revokedAt: now },
      });
    });

    return { message: 'Password reset successfully' };
  }

  async login(loginDto: LoginDto) {
    const email = this.resolveLoginEmail(loginDto);

    const existingUser = await this.prisma.user.findUnique({
      where: {
        email,
      },
    });

    if (!existingUser) {
      throw new UnauthorizedException('Invalid email or password');
    }

    if (existingUser.status !== 'ACTIVE') {
      throw new UnauthorizedException('This account is not active');
    }

    const now = new Date();
    if (existingUser.lockedUntil && existingUser.lockedUntil > now) {
      throw new UnauthorizedException(
        'Invalid email or password. Try again after the temporary lockout.',
      );
    }
    if (!existingUser.emailVerifiedAt && !this.isEmailVerificationBypassed()) {
      throw new UnauthorizedException(
        'Verify your email address before signing in',
      );
    }
    if (existingUser.lockedUntil && existingUser.lockedUntil <= now) {
      await this.prisma.user.updateMany({
        where: {
          id: existingUser.id,
          lockedUntil: { lte: now },
        },
        data: { failedLoginAttempts: 0, lockedUntil: null },
      });
    }

    const passwordMatch = await bcrypt.compare(
      loginDto.password,
      existingUser.password,
    );

    if (!passwordMatch) {
      const failedAttempt = await this.prisma.user.update({
        where: { id: existingUser.id },
        data: { failedLoginAttempts: { increment: 1 } },
        select: { failedLoginAttempts: true },
      });
      if (failedAttempt.failedLoginAttempts >= 5) {
        await this.prisma.user.updateMany({
          where: {
            id: existingUser.id,
            lockedUntil: null,
            failedLoginAttempts: { gte: 5 },
          },
          data: { lockedUntil: new Date(Date.now() + 15 * 60 * 1000) },
        });
      }
      throw new UnauthorizedException('Invalid email or password');
    }

    const resetAttempts = await this.prisma.user.updateMany({
      where: {
        id: existingUser.id,
        OR: [{ lockedUntil: null }, { lockedUntil: { lte: now } }],
      },
      data: { failedLoginAttempts: 0, lockedUntil: null },
    });
    if (resetAttempts.count !== 1) {
      throw new UnauthorizedException(
        'Invalid email or password. Try again after the temporary lockout.',
      );
    }

    const { refreshToken, familyId } = await this.issueRefreshToken(
      existingUser.id,
    );
    const accessToken = await this.jwtService.signAsync(
      this.buildAccessTokenPayload(existingUser, familyId),
    );

    return {
      access_token: accessToken,
      refresh_token: refreshToken,
      token_type: 'bearer',
      expires_in: 15 * 60,
      must_change_password: existingUser.mustChangePassword,
    };
  }

  async refresh(refreshToken: string) {
    const tokenHash = this.hashToken(refreshToken);
    const now = new Date();

    const storedToken = await this.prisma.refreshToken.findUnique({
      where: { tokenHash },
      include: {
        user: true,
      },
    });

    if (!storedToken || !storedToken.user || storedToken.expiresAt <= now) {
      throw new UnauthorizedException('Refresh token is invalid or expired');
    }

    if (storedToken.user.status !== 'ACTIVE') {
      throw new UnauthorizedException('This account is not active');
    }

    if (storedToken.revokedAt) {
      if (storedToken.replacedById) {
        await this.revokeRefreshTokenFamily(storedToken.familyId, now);
      }
      throw new UnauthorizedException('Refresh token is invalid or expired');
    }

    const rotation = await this.prisma.$transaction(async (tx) => {
      const claimed = await tx.refreshToken.updateMany({
        where: {
          id: storedToken.id,
          tokenHash,
          revokedAt: null,
          expiresAt: { gt: now },
        },
        data: {
          revokedAt: now,
          lastUsedAt: now,
        },
      });

      if (claimed.count !== 1) {
        return null;
      }

      const newRefreshToken = randomBytes(32).toString('hex');
      const newTokenHash = this.hashToken(newRefreshToken);
      const nextRefresh = await tx.refreshToken.create({
        data: {
          userId: storedToken.userId,
          familyId: storedToken.familyId,
          tokenHash: newTokenHash,
          expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
        },
      });

      await tx.refreshToken.update({
        where: { id: storedToken.id },
        data: { replacedById: nextRefresh.id },
      });

      return { refreshToken: newRefreshToken, sessionId: storedToken.familyId };
    });

    if (!rotation) {
      const latestToken = await this.prisma.refreshToken.findUnique({
        where: { id: storedToken.id },
      });
      if (latestToken?.replacedById) {
        await this.revokeRefreshTokenFamily(storedToken.familyId, now);
      }
      throw new UnauthorizedException('Refresh token is invalid or expired');
    }

    const accessToken = await this.jwtService.signAsync(
      this.buildAccessTokenPayload(storedToken.user, rotation.sessionId),
    );

    return {
      access_token: accessToken,
      refresh_token: rotation.refreshToken,
      token_type: 'bearer',
      expires_in: 15 * 60,
    };
  }

  private async revokeRefreshTokenFamily(familyId: string, revokedAt: Date) {
    await this.prisma.refreshToken.updateMany({
      where: { familyId, revokedAt: null },
      data: { revokedAt },
    });
  }

  async logout(user: RequestUser, refreshToken?: string) {
    const now = new Date();

    if (refreshToken) {
      const tokenHash = this.hashToken(refreshToken);
      const session = await this.prisma.refreshToken.findFirst({
        where: { userId: user.id, tokenHash },
        select: { familyId: true },
      });
      if (session) {
        await this.revokeRefreshTokenFamily(session.familyId, now);
      }

      return { message: 'Logged out successfully' };
    }

    await this.prisma.refreshToken.updateMany({
      where: {
        userId: user.id,
        revokedAt: null,
      },
      data: {
        revokedAt: now,
        lastUsedAt: now,
      },
    });

    return { message: 'All sessions were terminated successfully' };
  }

  async getActiveSessions(user: RequestUser) {
    const now = new Date();

    const sessions = await this.prisma.refreshToken.findMany({
      where: {
        userId: user.id,
        revokedAt: null,
        expiresAt: { gt: now },
      },
      orderBy: {
        createdAt: 'desc',
      },
      select: {
        id: true,
        createdAt: true,
        expiresAt: true,
        lastUsedAt: true,
      },
    });

    return {
      sessions,
    };
  }
}
