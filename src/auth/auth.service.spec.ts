import { UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import { PrismaService } from '../prisma/prisma.service';
import { EmailService } from '../common/email.service';
import { AuthService } from './auth.service';

describe('AuthService refresh token rotation', () => {
  const now = new Date();
  const tx = {
    refreshToken: {
      updateMany: jest.fn<(...args: unknown[]) => Promise<unknown>>(),
      create: jest.fn<(...args: unknown[]) => Promise<unknown>>(),
      update: jest.fn<(...args: unknown[]) => Promise<unknown>>(),
    },
  };
  const prismaMock = {
    refreshToken: {
      findUnique: jest.fn<(...args: unknown[]) => Promise<unknown>>(),
      findFirst: jest.fn<(...args: unknown[]) => Promise<unknown>>(),
      updateMany: jest.fn<(...args: unknown[]) => Promise<unknown>>(),
    },
    $transaction: jest.fn(
      (operation: (client: typeof tx) => Promise<unknown>) => operation(tx),
    ),
  };
  const jwtMock = {
    signAsync: jest.fn<(...args: unknown[]) => Promise<unknown>>(),
  };
  const authService = new AuthService(
    prismaMock as unknown as PrismaService,
    jwtMock as unknown as JwtService,
    {} as EmailService,
  );
  const storedToken = {
    id: 'refresh-1',
    userId: 'user-1',
    familyId: 'family-1',
    tokenHash: '',
    expiresAt: new Date(now.getTime() + 60_000),
    revokedAt: null,
    replacedById: null,
    user: {
      id: 'user-1',
      email: 'user@example.test',
      role: 'STUDENT',
      status: 'ACTIVE',
    },
  };

  beforeEach(() => {
    jest.clearAllMocks();
    prismaMock.refreshToken.findUnique.mockResolvedValue(storedToken);
    prismaMock.refreshToken.updateMany.mockResolvedValue({ count: 1 });
    tx.refreshToken.updateMany.mockResolvedValue({ count: 1 });
    tx.refreshToken.create.mockResolvedValue({ id: 'refresh-2' });
    tx.refreshToken.update.mockResolvedValue({});
    jwtMock.signAsync.mockResolvedValue('new-access-token');
  });

  it('rotates an active refresh token atomically', async () => {
    const result = await authService.refresh('presented-refresh-token');

    expect(tx.refreshToken.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          id: 'refresh-1',
          revokedAt: null,
        }),
      }),
    );
    expect(tx.refreshToken.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          userId: 'user-1',
          familyId: 'family-1',
        }),
      }),
    );
    expect(result).toEqual(
      expect.objectContaining({
        access_token: 'new-access-token',
        token_type: 'bearer',
        expires_in: 900,
      }),
    );
  });

  it('revokes the active family when a rotated token is reused', async () => {
    prismaMock.refreshToken.findUnique.mockResolvedValue({
      ...storedToken,
      revokedAt: now,
      replacedById: 'refresh-2',
    });

    await expect(
      authService.refresh('replayed-refresh-token'),
    ).rejects.toBeInstanceOf(UnauthorizedException);

    expect(prismaMock.refreshToken.updateMany).toHaveBeenCalledWith({
      where: { familyId: 'family-1', revokedAt: null },
      data: { revokedAt: expect.any(Date) },
    });
  });

  it('rejects a concurrent second rotation and revokes the family', async () => {
    tx.refreshToken.updateMany.mockResolvedValue({ count: 0 });
    prismaMock.refreshToken.findUnique
      .mockResolvedValueOnce(storedToken)
      .mockResolvedValueOnce({
        ...storedToken,
        revokedAt: now,
        replacedById: 'refresh-2',
      });

    await expect(
      authService.refresh('concurrently-reused-token'),
    ).rejects.toBeInstanceOf(UnauthorizedException);

    expect(tx.refreshToken.create).not.toHaveBeenCalled();
    expect(prismaMock.refreshToken.updateMany).toHaveBeenCalledWith({
      where: { familyId: 'family-1', revokedAt: null },
      data: { revokedAt: expect.any(Date) },
    });
  });
});
