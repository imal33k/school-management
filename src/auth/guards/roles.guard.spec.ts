import {
  ExecutionContext,
  ForbiddenException,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { UserRole } from '@prisma/client';
import { beforeEach, describe, expect, it, jest } from '@jest/globals';

import { RolesGuard } from './roles.guard';

describe('RolesGuard', () => {
  const reflector = {
    getAllAndOverride: jest.fn(),
  };

  const guard = new RolesGuard(reflector as unknown as Reflector);

  const context = {
    getHandler: jest.fn(),
    getClass: jest.fn(),
    switchToHttp: () => ({
      getRequest: () => request,
    }),
  } as unknown as ExecutionContext;

  const request = {
    user: {
      id: 'user-1',
      email: 'teacher@example.com',
      role: UserRole.TEACHER,
      schoolId: 'school-1',
    },
  };

  beforeEach(() => {
    jest.clearAllMocks();
    request.user = {
      id: 'user-1',
      email: 'teacher@example.com',
      role: UserRole.TEACHER,
      schoolId: 'school-1',
    };
  });

  it('allows access to matching roles', () => {
    reflector.getAllAndOverride.mockReturnValue([UserRole.TEACHER]);

    expect(guard.canActivate(context)).toBe(true);
  });

  it('blocks access when the role is missing', () => {
    reflector.getAllAndOverride.mockReturnValue([UserRole.SCHOOL_ADMIN]);

    expect(() => guard.canActivate(context)).toThrow(ForbiddenException);
  });

  it('requires an authenticated user', () => {
    reflector.getAllAndOverride.mockReturnValue([UserRole.SUPER_ADMIN]);
    request.user = undefined;

    expect(() => guard.canActivate(context)).toThrow(UnauthorizedException);
  });
});
