import { Injectable, Logger } from '@nestjs/common';
import { EnquiryStatus, EnquiryType } from '@prisma/client';

import { EmailService } from '../common/email.service';
import { PrismaService } from '../prisma/prisma.service';
import { CreateEnquiryDto } from './dto/create-enquiry.dto';

@Injectable()
export class EnquiriesService {
  private readonly logger = new Logger(EnquiriesService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly email: EmailService,
  ) {}

  async create(
    dto: CreateEnquiryDto,
    meta: { ipAddress?: string; userAgent?: string },
  ) {
    // Honeypot tripped: pretend it worked so bots learn nothing, store nothing.
    if (dto.website) {
      return { received: true };
    }

    const enquiry = await this.prisma.enquiry.create({
      data: {
        type: dto.type ?? EnquiryType.CONTACT,
        name: dto.name,
        email: dto.email.toLowerCase(),
        schoolName: dto.schoolName || null,
        message: dto.message,
        ipAddress: meta.ipAddress ?? null,
        userAgent: meta.userAgent?.slice(0, 300) ?? null,
      },
    });

    // The enquiry is already safely stored. A mail problem must never make the
    // visitor think their message was lost, so notification failures are only logged.
    await this.notifyTeam(enquiry.id).catch((error: unknown) => {
      this.logger.warn(
        `Enquiry ${enquiry.id} saved but the notification email failed: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    });

    return { received: true };
  }

  private async notifyTeam(id: string) {
    const to = process.env.ENQUIRY_NOTIFY_EMAIL;
    if (!to) return;
    const e = await this.prisma.enquiry.findUnique({ where: { id } });
    if (!e) return;
    const label = e.type === EnquiryType.DEMO ? 'Demo request' : 'Enquiry';
    await this.email.send(
      to,
      `[SchoolHouse] ${label} from ${e.name}`,
      [
        `Type: ${label}`,
        `Name: ${e.name}`,
        `Email: ${e.email}`,
        `School: ${e.schoolName ?? '-'}`,
        '',
        e.message,
      ].join('\n'),
    );
    await this.prisma.enquiry.update({
      where: { id },
      data: { notifiedAt: new Date() },
    });
  }

  findAll(status?: EnquiryStatus) {
    return this.prisma.enquiry.findMany({
      where: status ? { status } : undefined,
      orderBy: { createdAt: 'desc' },
      take: 200,
    });
  }

  updateStatus(id: string, status: EnquiryStatus) {
    return this.prisma.enquiry.update({ where: { id }, data: { status } });
  }
}
