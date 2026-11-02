import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';
import {
  SchoolStatus,
  SubscriptionStatus,
  UserRole,
  UserStatus,
} from '@prisma/client';

import { IS_PUBLIC_KEY } from '../../decorator/public.decorator';
import { PrismaService } from '../../../prisma/prisma.service';

@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(
    private readonly jwtService: JwtService,
    private readonly reflector: Reflector,
    private readonly prisma: PrismaService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);

    if (isPublic) {
      return true;
    }

    const request = context.switchToHttp().getRequest();

    const authHeader = request.headers.authorization;

    if (!authHeader) {
      throw new UnauthorizedException('Authorization header is missing');
    }

    const [type, token] = authHeader.split(' ');

    if (type !== 'Bearer' || !token) {
      throw new UnauthorizedException('Invalid authorization format');
    }

    let payload: { sub?: string; tokenType?: string; sessionId?: string };
    try {
      payload = await this.jwtService.verifyAsync(token);
    } catch {
      throw new UnauthorizedException('Invalid or expired token');
    }

    if (
      !payload.sub ||
      payload.tokenType !== 'access' ||
      typeof payload.sessionId !== 'string'
    ) {
      throw new UnauthorizedException('Invalid token payload');
    }

    const activeSession = await this.prisma.refreshToken.findFirst({
      where: {
        userId: payload.sub,
        familyId: payload.sessionId,
        revokedAt: null,
        expiresAt: { gt: new Date() },
      },
      select: { id: true },
    });

    if (!activeSession) {
      throw new UnauthorizedException('This session is no longer active');
    }

    const dbUser = await this.prisma.user.findUnique({
      where: { id: payload.sub },
      include: {
        memberships: {
          include: {
            school: {
              include: {
                subscription: true,
              },
            },
          },
          orderBy: { createdAt: 'asc' },
        },
      },
    });

    if (!dbUser || dbUser.status !== UserStatus.ACTIVE) {
      throw new UnauthorizedException('This account is not active');
    }

    if (
      dbUser.mustChangePassword &&
      !['/auth/change-password', '/auth/me', '/auth/logout'].includes(
        request.path,
      )
    ) {
      throw new ForbiddenException(
        'Change your temporary password before accessing school features',
      );
    }

    const membership = dbUser.memberships[0];
    const role =
      dbUser.role === UserRole.SUPER_ADMIN
        ? UserRole.SUPER_ADMIN
        : (membership?.role ?? dbUser.role);

    request.user = {
      id: dbUser.id,
      supabaseUserId: dbUser.id,
      sub: dbUser.id,
      email: dbUser.email,
      role,
      schoolId: membership?.schoolId,
      mustChangePassword: dbUser.mustChangePassword,
    };

    if (role !== UserRole.SUPER_ADMIN && membership) {
      if (membership.school.status !== SchoolStatus.ACTIVE) {
        throw new ForbiddenException(
          'This school is not active. Contact your school administrator.',
        );
      }

      const subscription = membership.school.subscription;
      const now = new Date();
      const isTrialOrActive =
        subscription?.status === SubscriptionStatus.ACTIVE ||
        subscription?.status === SubscriptionStatus.TRIAL;
      if (subscription && isTrialOrActive && subscription.endDate <= now) {
        await this.prisma.subscription.updateMany({
          where: {
            id: subscription.id,
            status: {
              in: [SubscriptionStatus.ACTIVE, SubscriptionStatus.TRIAL],
            },
            endDate: { lte: now },
          },
          data: { status: SubscriptionStatus.EXPIRED },
        });
        subscription.status = SubscriptionStatus.EXPIRED;
      }

      const subscriptionInGoodStanding =
        subscription !== null &&
        (subscription.status === SubscriptionStatus.ACTIVE ||
          subscription.status === SubscriptionStatus.TRIAL) &&
        subscription.startDate <= now &&
        subscription.endDate > now;

      if (
        !subscriptionInGoodStanding &&
        !this.isBillingRoute(request.path, request.method)
      ) {
        throw new ForbiddenException(
          'An active subscription is required to use school features',
        );
      }
    }

    return true;
  }

  private isBillingRoute(path: string, method: string) {
    return (
      path.startsWith('/subscriptions') ||
      path === '/plans/active' ||
      path === '/auth/me' ||
      path === '/auth/change-password' ||
      path === '/auth/forgot-password' ||
      path === '/auth/reset-password' ||
      (method === 'GET' && /^\/payments\/verify\/[^/]+$/.test(path))
    );
  }
}
