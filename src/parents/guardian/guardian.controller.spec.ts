import { RequestMethod } from '@nestjs/common';
import { METHOD_METADATA, PATH_METADATA } from '@nestjs/common/constants';
import { describe, expect, it } from '@jest/globals';
import { UserRole } from '@prisma/client';
import { ROLES_KEY } from '../../auth/decorator/roles.decorator';
import { GuardianController } from './guardian.controller';

describe('GuardianController parent attendance routes', () => {
  it('maps the parent overview to the parent-only attendance route', () => {
    const handler = GuardianController.prototype.findMyAttendance;

    expect(Reflect.getMetadata(PATH_METADATA, handler)).toBe(
      'me/attendance',
    );
    expect(Reflect.getMetadata(METHOD_METADATA, handler)).toBe(
      RequestMethod.GET,
    );
    expect(Reflect.getMetadata(ROLES_KEY, handler)).toEqual([
      UserRole.PARENT,
    ]);
  });

  it('maps the child history handler to the parent-only child attendance route', () => {
    const handler = GuardianController.prototype.findChildAttendance;

    expect(Reflect.getMetadata(PATH_METADATA, handler)).toBe(
      'me/children/:studentId/attendance',
    );
    expect(Reflect.getMetadata(METHOD_METADATA, handler)).toBe(
      RequestMethod.GET,
    );
    expect(Reflect.getMetadata(ROLES_KEY, handler)).toEqual([
      UserRole.PARENT,
    ]);
  });
});
