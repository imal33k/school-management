import { createParamDecorator, type ExecutionContext } from '@nestjs/common';
import { UserRole } from '@prisma/client';


export interface RequestUser {
  id: any;
  supabaseUserId: string;
  sub: string;
  email: string;
  role: UserRole;
}


export const CurrentUser = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): RequestUser => {
    const request = ctx.switchToHttp().getRequest();
    return request.user as RequestUser;
  },
);
