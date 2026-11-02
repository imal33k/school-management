import { UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { UserRole } from '@prisma/client';
import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import * as bcrypt from 'bcrypt';
import { EmailService } from '../common/email.service';
import { PrismaService } from '../prisma/prisma.service';
import { AuthService } from './auth.service';

describe('AuthService login lockout', () => {
  const prismaMock = {
    user: {
      findUnique: jest.fn<(...args: unknown[]) => Promise<unknown>>(),
      update: jest.fn<(...args: unknown[]) => Promise<unknown>>(),
      updateMany: jest.fn<(...args: unknown[]) => Promise<unknown>>(),
    },
    refreshToken: {
      create: jest.fn<(...args: unknown[]) => Promise<unknown>>(),
    },
  };
  const jwtMock = {
    signAsync: jest.fn<(...args: unknown[]) => Promise<string>>(),
  };
  const service = new AuthService(
    prismaMock as unknown as PrismaService,
    jwtMock as unknown as JwtService,
    {} as EmailService,
  );
  let passwordHash: string;

  beforeEach(async () => {
    jest.clearAllMocks();
    delete process.env.SKIP_EMAIL_VERIFICATION;
    process.env.NODE_ENV = 'test';
    passwordHash = await bcrypt.hash('correct-password', 4);
    const activeUser = {
      id: 'user-1',
      email: 'user@example.test',
      role: UserRole.STUDENT,
      status: 'ACTIVE',
      password: passwordHash,
      emailVerifiedAt: new Date(),
      failedLoginAttempts: 0,
      lockedUntil: null,
      mustChangePassword: false,
    };
    for (let attempt = 1; attempt <= 5; attempt += 1) {
      prismaMock.user.findUnique.mockResolvedValueOnce(activeUser);
      prismaMock.user.update.mockResolvedValueOnce({
        failedLoginAttempts: attempt,
      });
    }
    prismaMock.user.findUnique.mockResolvedValueOnce({
      ...activeUser,
      failedLoginAttempts: 5,
      lockedUntil: new Date(Date.now() + 15 * 60 * 1000),
    });
    prismaMock.user.updateMany.mockResolvedValue({ count: 1 });
    prismaMock.refreshToken.create.mockResolvedValue({ id: 'refresh-1' });
    jwtMock.signAsync.mockResolvedValue('access-token');
  });

  it('allows an unverified account to sign in only when development bypass is enabled', async () => {
    process.env.NODE_ENV = 'development';
    process.env.SKIP_EMAIL_VERIFICATION = 'true';
    prismaMock.user.findUnique.mockReset().mockResolvedValue({
      id: 'user-unverified',
      email: 'tester@example.test',
      role: UserRole.STUDENT,
      status: 'ACTIVE',
      password: passwordHash,
      emailVerifiedAt: null,
      failedLoginAttempts: 0,
      lockedUntil: null,
      mustChangePassword: false,
    });

    await expect(
      service.login({
        email: 'tester@example.test',
        password: 'correct-password',
      }),
    ).resolves.toEqual(
      expect.objectContaining({ access_token: 'access-token' }),
    );
  });

  it('does not bypass verification in production', async () => {
    process.env.NODE_ENV = 'production';
    process.env.SKIP_EMAIL_VERIFICATION = 'true';
    prismaMock.user.findUnique.mockReset().mockResolvedValue({
      id: 'user-unverified',
      email: 'tester@example.test',
      role: UserRole.STUDENT,
      status: 'ACTIVE',
      password: passwordHash,
      emailVerifiedAt: null,
      failedLoginAttempts: 0,
      lockedUntil: null,
      mustChangePassword: false,
    });

    await expect(
      service.login({
        email: 'tester@example.test',
        password: 'correct-password',
      }),
    ).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('locks the account on the fifth failure and blocks the next login attempt', async () => {
    for (let attempt = 0; attempt < 5; attempt += 1) {
      await expect(
        service.login({
          email: 'user@example.test',
          password: 'wrong-password',
        }),
      ).rejects.toBeInstanceOf(UnauthorizedException);
    }

    expect(prismaMock.user.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          id: 'user-1',
          failedLoginAttempts: { gte: 5 },
        }),
        data: { lockedUntil: expect.any(Date) },
      }),
    );

    await expect(
      service.login({
        email: 'user@example.test',
        password: 'correct-password',
      }),
    ).rejects.toBeInstanceOf(UnauthorizedException);
    expect(prismaMock.user.update).toHaveBeenCalledTimes(5);
  });
});
