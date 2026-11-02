import { Controller, Get, Param, Query } from '@nestjs/common';
import { AuditLogService } from './audit-log.service';
import { CurrentUser, type RequestUser } from '../auth/decorator/current-user.decorator';
import { PrismaService } from '../prisma/prisma.service';
import { ForbiddenException } from '@nestjs/common';
import { AuditLogQueryDto } from './dto/audit-log-query.dto';
import { Roles } from '../auth/decorator/roles.decorator';
import { UserRole } from '@prisma/client';

@Controller('audit-logs')
export class AuditLogController {
  constructor(private readonly auditLogService: AuditLogService, private readonly prisma: PrismaService) {}
  @Get()
  @Roles(UserRole.SCHOOL_ADMIN, UserRole.SUPER_ADMIN)
  async findAll(@CurrentUser() user: RequestUser, @Query() query: AuditLogQueryDto) {
    const membership = await this.getMembership(user);
    return this.auditLogService.findAll(membership.schoolId, query);
  }
  @Get(':id')
  @Roles(UserRole.SCHOOL_ADMIN, UserRole.SUPER_ADMIN)
  async findOne(@CurrentUser() user: RequestUser, @Param('id') id: string) {
    const membership = await this.getMembership(user);
    return this.auditLogService.findOne(membership.schoolId, id);
  }
  private async getMembership(user: RequestUser) {
    const membership = await this.prisma.schoolMembership.findFirst({
      where: {
        userId: user.id,
        ...(user.schoolId ? { schoolId: user.schoolId } : {}),
      },
    });
    if (!membership) throw new ForbiddenException('You do not belong to a school');
    return membership;
  }
}
