import { ExecutionContext, ForbiddenException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import {
  SchoolStatus,
  SubscriptionStatus,
  UserRole,
  UserStatus,
} from '@prisma/client';
import { JwtService } from '@nestjs/jwt';
import { PrismaService } from '../../../prisma/prisma.service';
import { JwtAuthGuard } from './jwt-auth.guard';
import { beforeEach, describe, expect, it, jest } from '@jest/globals';

describe('JwtAuthGuard tenant access', () => {
  const now = new Date();
  const request = {
    headers: { authorization: 'Bearer token' },
    path: '/students',
    method: 'GET',
    user: undefined as unknown,
  };
  const jwt = {
    verifyAsync: jest
      .fn<(...args: unknown[]) => Promise<unknown>>()
      .mockResolvedValue({
        sub: 'user-1',
        tokenType: 'access',
        sessionId: 'session-1',
      }),
  };
  const reflector = {
    getAllAndOverride: jest
      .fn<(...args: unknown[]) => unknown>()
      .mockReturnValue(false),
  };
  const prisma = {
    user: {
      findUnique: jest.fn<(...args: unknown[]) => Promise<unknown>>(),
    },
    refreshToken: {
      findFirst: jest.fn<(...args: unknown[]) => Promise<unknown>>(),
    },
    subscription: {
      updateMany: jest.fn<(...args: unknown[]) => Promise<unknown>>(),
    },
  };
  const guard = new JwtAuthGuard(
    jwt as unknown as JwtService,
    reflector as unknown as Reflector,
    prisma as unknown as PrismaService,
  );
  const context = {
    getHandler: jest.fn(),
    getClass: jest.fn(),
    switchToHttp: () => ({ getRequest: () => request }),
  } as unknown as ExecutionContext;

  beforeEach(() => {
    jest.clearAllMocks();
    reflector.getAllAndOverride.mockReturnValue(false);
    jwt.verifyAsync.mockResolvedValue({
      sub: 'user-1',
      tokenType: 'access',
      sessionId: 'session-1',
    });
    prisma.refreshToken.findFirst.mockResolvedValue({ id: 'token-1' });
    prisma.subscription.updateMany.mockResolvedValue({ count: 1 });
    request.path = '/students';
    request.method = 'GET';
    request.user = undefined;
  });

  function setUser(
    schoolStatus: SchoolStatus,
    role: UserRole,
    status: SubscriptionStatus | null,
    endDate = new Date(now.getTime() + 86_400_000),
    startDate = new Date(now.getTime() - 86_400_000),
    mustChangePassword = false,
  ) {
    prisma.user.findUnique.mockResolvedValue({
      id: 'user-1',
      email: 'admin@example.test',
      role: UserRole.SCHOOL_ADMIN,
      status: UserStatus.ACTIVE,
      mustChangePassword,
      memberships: [
        {
          schoolId: 'school-1',
          role,
          school: {
            status: schoolStatus,
            subscription: status
              ? { id: 'subscription-1', status, startDate, endDate }
              : null,
          },
        },
      ],
    });
  }

  it('rejects access tokens without a session id', async () => {
    jwt.verifyAsync.mockResolvedValue({
      sub: 'user-1',
      tokenType: 'access',
    });

    await expect(guard.canActivate(context)).rejects.toThrow(
      'Invalid token payload',
    );
  });

  it('rejects access tokens for revoked sessions', async () => {
    prisma.refreshToken.findFirst.mockResolvedValue(null);

    await expect(guard.canActivate(context)).rejects.toThrow(
      'This session is no longer active',
    );
  });

  it('forces a temporary-password account to change its password', async () => {
    setUser(
      SchoolStatus.ACTIVE,
      UserRole.SCHOOL_ADMIN,
      SubscriptionStatus.ACTIVE,
      undefined,
      undefined,
      true,
    );

    await expect(guard.canActivate(context)).rejects.toThrow(
      'Change your temporary password before accessing school features',
    );
  });

  it('allows a temporary-password account to reach the password-change route', async () => {
    request.path = '/auth/change-password';
    setUser(
      SchoolStatus.ACTIVE,
      UserRole.SCHOOL_ADMIN,
      SubscriptionStatus.ACTIVE,
      undefined,
      undefined,
      true,
    );

    await expect(guard.canActivate(context)).resolves.toBe(true);
  });

  it('blocks suspended schools', async () => {
    setUser(
      SchoolStatus.SUSPENDED,
      UserRole.SCHOOL_ADMIN,
      SubscriptionStatus.ACTIVE,
    );

    await expect(guard.canActivate(context)).rejects.toBeInstanceOf(
      ForbiddenException,
    );
  });

  it('expires subscriptions and blocks school features', async () => {
    setUser(
      SchoolStatus.ACTIVE,
      UserRole.SCHOOL_ADMIN,
      SubscriptionStatus.ACTIVE,
      new Date(now.getTime() - 1),
    );

    await expect(guard.canActivate(context)).rejects.toBeInstanceOf(
      ForbiddenException,
    );
    expect(prisma.subscription.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: { status: SubscriptionStatus.EXPIRED },
      }),
    );
  });

  it('allows billing recovery for expired tenants and uses the current membership role', async () => {
    request.path = '/subscriptions/me';
    setUser(
      SchoolStatus.ACTIVE,
      UserRole.ACCOUNTANT,
      SubscriptionStatus.EXPIRED,
      new Date(now.getTime() - 1),
    );

    await expect(guard.canActivate(context)).resolves.toBe(true);
    expect(request.user).toEqual(
      expect.objectContaining({ role: UserRole.ACCOUNTANT }),
    );
  });

  it('blocks tenants without a subscription from school features', async () => {
    setUser(SchoolStatus.ACTIVE, UserRole.SCHOOL_ADMIN, null);

    await expect(guard.canActivate(context)).rejects.toBeInstanceOf(
      ForbiddenException,
    );
  });

  it('bypasses subscription enforcement when temporary testing is enabled', async () => {
    const previousValue = process.env.BYPASS_SUBSCRIPTION_CHECK;
    process.env.BYPASS_SUBSCRIPTION_CHECK = 'true';
    setUser(SchoolStatus.ACTIVE, UserRole.SCHOOL_ADMIN, null);

    try {
      await expect(guard.canActivate(context)).resolves.toBe(true);
      expect(prisma.subscription.updateMany).not.toHaveBeenCalled();
    } finally {
      if (previousValue === undefined) {
        delete process.env.BYPASS_SUBSCRIPTION_CHECK;
      } else {
        process.env.BYPASS_SUBSCRIPTION_CHECK = previousValue;
      }
    }
  });

  it('blocks subscriptions that have not started yet', async () => {
    setUser(
      SchoolStatus.ACTIVE,
      UserRole.SCHOOL_ADMIN,
      SubscriptionStatus.TRIAL,
      new Date(now.getTime() + 86_400_000),
      new Date(now.getTime() + 60_000),
    );

    await expect(guard.canActivate(context)).rejects.toBeInstanceOf(
      ForbiddenException,
    );
  });
});
