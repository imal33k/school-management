import {
  ConflictException,
  Injectable,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';

import { RegisterDto } from './dto/register.dto';
import { LoginDto } from './dto/login.dto';
import { ChangePasswordDto } from './dto/change-password.dto';
import { RequestUser } from './decorator/current-user.decorator';

import { PrismaService } from '../prisma/prisma.service';

import * as bcrypt from 'bcrypt';

import { JwtService } from '@nestjs/jwt';
import { UserRole } from '@prisma/client';
import { createHash, randomBytes } from 'crypto';
import { EmailService } from '../common/email.service';
import { ForgotPasswordDto } from './dto/forgot-password.dto';
import { ResetPasswordDto } from './dto/reset-password.dto';

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jwtService: JwtService,
    private readonly email: EmailService,
  ) {}

  private buildAccessTokenPayload(user: { id: string; email: string; role: UserRole }) {
    return {
      sub: user.id,
      email: user.email,
      role: user.role,
      tokenType: 'access',
    };
  }

  private hashToken(token: string) {
    return createHash('sha256').update(token).digest('hex');
  }

  private resolveLoginEmail(dto: LoginDto) {
    return dto.email ?? dto.schoolemail;
  }

  private normalizeRegisterDto(dto: RegisterDto) {
    const email = dto.email ?? dto.schoolemail;
    const schoolName = dto.schoolName?.trim() || dto.schooladdress?.trim() || 'School';
    const nameParts = schoolName.split(/\s+/).filter(Boolean);
    const firstName = dto.firstName?.trim() || nameParts[0] || 'School';
    const lastName =
      dto.lastName?.trim() ||
      nameParts.slice(1).join(' ') ||
      'Admin';

    return {
      email,
      firstName,
      lastName,
      phone: dto.phone,
    };
  }

  private async issueRefreshToken(userId: string) {
    const refreshToken = randomBytes(32).toString('hex');
    const tokenHash = this.hashToken(refreshToken);
    const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);

    await this.prisma.refreshToken.create({
      data: {
        userId,
        tokenHash,
        expiresAt,
      },
    });

    return {
      refreshToken,
      expiresAt,
    };
  }

  async register(registerDto: RegisterDto) {
    const normalized = this.normalizeRegisterDto(registerDto);

    const existingUser = await this.prisma.user.findUnique({
      where: {
        email: normalized.email,
      },
    });

    if (existingUser) {
      throw new ConflictException('This email already exists');
    }

    const hashedPassword = await bcrypt.hash(registerDto.password, 10);

    const user = await this.prisma.user.create({
      data: {
        email: normalized.email,
        password: hashedPassword,
        firstName: normalized.firstName,
        lastName: normalized.lastName,
        phone: normalized.phone,
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
        data: { password: await bcrypt.hash(dto.newPassword, 10) },
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
    const appUrl = process.env.APP_URL;
    if (!appUrl) {
      throw new ServiceUnavailableException('APP_URL is not configured');
    }

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
          `Use this link within one hour to reset your password: ${appUrl.replace(/\/$/, '')}/reset-password?token=${token}`,
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
        data: { password },
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

    const passwordMatch = await bcrypt.compare(
      loginDto.password,
      existingUser.password,
    );

    if (!passwordMatch) {
      throw new UnauthorizedException('Invalid email or password');
    }

    const accessToken = await this.jwtService.signAsync(
      this.buildAccessTokenPayload(existingUser),
    );
    const { refreshToken } = await this.issueRefreshToken(existingUser.id);

    return {
      access_token: accessToken,
      refresh_token: refreshToken,
      token_type: 'bearer',
      expires_in: 24 * 60 * 60,
    };
  }

  async refresh(refreshToken: string) {
    const tokenHash = this.hashToken(refreshToken);
    const now = new Date();

    const activeSession = await this.prisma.refreshToken.findFirst({
      where: {
        tokenHash,
        revokedAt: null,
        expiresAt: { gt: now },
      },
      include: {
        user: true,
      },
    });

    if (!activeSession || !activeSession.user) {
      throw new UnauthorizedException('Refresh token is invalid or expired');
    }

    if (activeSession.user.status !== 'ACTIVE') {
      throw new UnauthorizedException('This account is not active');
    }

    const newRefresh = await this.prisma.$transaction(async (tx) => {
      const newRefreshToken = randomBytes(32).toString('hex');
      const newTokenHash = this.hashToken(newRefreshToken);
      const nextRefresh = await tx.refreshToken.create({
        data: {
          userId: activeSession.userId,
          tokenHash: newTokenHash,
          expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
        },
      });

      await tx.refreshToken.update({
        where: { id: activeSession.id },
        data: {
          revokedAt: now,
          replacedById: nextRefresh.id,
          lastUsedAt: now,
        },
      });

      return newRefreshToken;
    });

    const accessToken = await this.jwtService.signAsync(
      this.buildAccessTokenPayload(activeSession.user),
    );

    return {
      access_token: accessToken,
      refresh_token: newRefresh,
      token_type: 'bearer',
      expires_in: 24 * 60 * 60,
    };
  }

  async logout(user: RequestUser, refreshToken?: string) {
    const now = new Date();

    if (refreshToken) {
      const tokenHash = this.hashToken(refreshToken);
      await this.prisma.refreshToken.updateMany({
        where: {
          userId: user.id,
          tokenHash,
          revokedAt: null,
        },
        data: {
          revokedAt: now,
          lastUsedAt: now,
        },
      });

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
