import { createParamDecorator, type ExecutionContext } from '@nestjs/common';
import { UserRole } from '@prisma/client';

export interface RequestUser {
  id: string;
  supabaseUserId: string;
  sub: string;
  email: string;
  firstName?: string;
  lastName?: string;
  name?: string;
  displayName?: string;
  role: UserRole;
  schoolId?: string;
  mustChangePassword?: boolean;
}

export const CurrentUser = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): RequestUser => {
    const request = ctx.switchToHttp().getRequest();
    return request.user as RequestUser;
  },
);
