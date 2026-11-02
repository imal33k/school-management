import { UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import { EmailService } from '../common/email.service';
import { PrismaService } from '../prisma/prisma.service';
import { AuthService } from './auth.service';

describe('AuthService email verification', () => {
  const tx = {
    emailVerificationToken: {
      updateMany: jest.fn<(...args: unknown[]) => Promise<unknown>>(),
      deleteMany: jest.fn<(...args: unknown[]) => Promise<unknown>>(),
    },
    user: {
      update: jest.fn<(...args: unknown[]) => Promise<unknown>>(),
    },
  };
  const prismaMock = {
    emailVerificationToken: {
      findFirst: jest.fn<(...args: unknown[]) => Promise<unknown>>(),
    },
    $transaction: jest.fn(
      (operation: (client: typeof tx) => Promise<unknown>) => operation(tx),
    ),
  };
  const authService = new AuthService(
    prismaMock as unknown as PrismaService,
    {} as JwtService,
    {} as EmailService,
  );

  beforeEach(() => {
    jest.clearAllMocks();
    prismaMock.emailVerificationToken.findFirst.mockResolvedValue({
      id: 'verification-token',
      userId: 'user-1',
    });
    tx.emailVerificationToken.updateMany.mockResolvedValue({ count: 1 });
    tx.emailVerificationToken.deleteMany.mockResolvedValue({ count: 0 });
    tx.user.update.mockResolvedValue({});
  });

  it('consumes a valid token and marks the account verified', async () => {
    await expect(
      authService.verifyEmail({ token: 'valid-token' }),
    ).resolves.toEqual({
      message: 'Email verified. You can now sign in.',
    });

    expect(tx.emailVerificationToken.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          id: 'verification-token',
          usedAt: null,
        }),
      }),
    );
    expect(tx.user.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'user-1' },
        data: expect.objectContaining({
          emailVerifiedAt: expect.any(Date),
        }),
      }),
    );
  });

  it('rejects a token that was consumed concurrently', async () => {
    tx.emailVerificationToken.updateMany.mockResolvedValue({ count: 0 });

    await expect(
      authService.verifyEmail({ token: 'used-token' }),
    ).rejects.toBeInstanceOf(UnauthorizedException);
    expect(tx.user.update).not.toHaveBeenCalled();
  });

  it('rejects an expired or unknown token', async () => {
    prismaMock.emailVerificationToken.findFirst.mockResolvedValue(null);

    await expect(
      authService.verifyEmail({ token: 'expired-token' }),
    ).rejects.toBeInstanceOf(UnauthorizedException);
    expect(prismaMock.$transaction).not.toHaveBeenCalled();
  });
});
