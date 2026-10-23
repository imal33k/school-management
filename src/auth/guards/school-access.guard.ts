import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';

import { SCHOOL_ACCESS_KEY } from '../decorator/school-access.decorator';
import { RequestUser } from '../decorator/current-user.decorator';

@Injectable()
export class SchoolAccessGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const requireSchoolAccess = this.reflector.getAllAndOverride<boolean>(
      SCHOOL_ACCESS_KEY,
      [context.getHandler(), context.getClass()],
    );

    if (!requireSchoolAccess) {
      return true;
    }

    const request = context.switchToHttp().getRequest();
    const user = request.user as RequestUser | undefined;

    if (!user) {
      throw new UnauthorizedException('Authentication required');
    }

    if (!user.schoolId) {
      throw new ForbiddenException(
        'This resource requires an active school membership',
      );
    }

    return true;
  }
}
