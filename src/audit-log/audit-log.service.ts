import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';

import { PrismaService } from '../prisma/prisma.service';
import { AuditLogQueryDto } from './dto/audit-log-query.dto';

@Injectable()
export class AuditLogService {
  constructor(
    private readonly prisma: PrismaService,
  ) {}

  async create(data: {
    schoolId?: string;
    userId?: string;
    action: string;
    resource: string;
    resourceId?: string;
    metadata?: Record<string, unknown>;
    ipAddress?: string;
  }) {
    return this.prisma.auditLog.create({
      data: {
        schoolId: data.schoolId,
        userId: data.userId,
        action: data.action,
        resource: data.resource,
        resourceId: data.resourceId,
        metadata: data.metadata as Prisma.InputJsonValue | undefined,
        ipAddress: data.ipAddress,
      },
    });
  }

  async findAll(schoolId: string, query: AuditLogQueryDto = new AuditLogQueryDto()) {
    const page = Number(query.page ?? 1);
    const limit = Number(query.limit ?? 25);
    const where: Prisma.AuditLogWhereInput = { schoolId, ...(query.action ? { action: { contains: query.action, mode: 'insensitive' } } : {}), ...(query.resource ? { resource: { contains: query.resource, mode: 'insensitive' } } : {}), ...(query.userId ? { userId: query.userId } : {}) };
    const [data, total] = await Promise.all([
      this.prisma.auditLog.findMany({ where, include: { user: { select: { id: true, firstName: true, lastName: true, email: true, role: true } } }, orderBy: { createdAt: 'desc' }, skip: (page - 1) * limit, take: limit }),
      this.prisma.auditLog.count({ where }),
    ]);
    return { data, meta: { page, limit, total, totalPages: Math.ceil(total / limit) } };
  }

  async findOne(
    schoolId: string,
    id: string,
  ) {
    return this.prisma.auditLog.findFirst({
      where: {
        id,
        schoolId,
      },
      include: {
        user: {
          select: {
            id: true,
            firstName: true,
            lastName: true,
            email: true,
            role: true,
          },
        },
      },
    });
  }
}