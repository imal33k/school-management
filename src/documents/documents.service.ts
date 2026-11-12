import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { UserRole } from '@prisma/client';
import { randomUUID } from 'crypto';

import { PrismaService } from '../prisma/prisma.service';
import { RequestUser } from '../auth/decorator/current-user.decorator';
import type { UploadedFileLike } from '../common/uploaded-file';
import { StudentAccessService } from '../student-access/student-access.service';

import { UploadDocumentDto } from './dto/document.dto';
import { cleanFileName, detectFileType, MAX_DOCUMENT_BYTES } from './file-type';
import { FileStorage } from './file-storage';

const MAX_PER_STUDENT = 30;

const PUBLIC_FIELDS = {
  id: true,
  studentId: true,
  kind: true,
  name: true,
  mimeType: true,
  size: true,
  createdAt: true,
} as const;

@Injectable()
export class DocumentsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly access: StudentAccessService,
    private readonly storage: FileStorage,
  ) {}

  private requireAdmin(user: RequestUser): string {
    if (!user.schoolId) {
      throw new ForbiddenException('You are not part of a school');
    }

    if (user.role !== UserRole.SCHOOL_ADMIN) {
      throw new ForbiddenException('Only a school admin can do this');
    }

    return user.schoolId;
  }

  async upload(
    studentId: string,
    file: UploadedFileLike | undefined,
    dto: UploadDocumentDto,
    user: RequestUser,
  ) {
    const schoolId = this.requireAdmin(user);

    await this.access.assertCanView(user, studentId, [UserRole.SCHOOL_ADMIN]);

    if (!file || file.size === 0) {
      throw new BadRequestException('Attach a file in the "file" field');
    }

    if (file.size > MAX_DOCUMENT_BYTES) {
      throw new BadRequestException('The file is too big. The limit is 5 MB.');
    }

    // Trust the file's content, not its name or the type the browser claimed
    const type = detectFileType(file.buffer);

    if (!type) {
      throw new BadRequestException('Only PDF, PNG, JPG and WEBP files are allowed');
    }

    const count = await this.prisma.document.count({ where: { studentId, schoolId } });

    if (count >= MAX_PER_STUDENT) {
      throw new ConflictException(`A student can have at most ${MAX_PER_STUDENT} documents`);
    }

    const storageKey = `${schoolId}/${randomUUID()}.${type.ext}`;

    await this.storage.save(storageKey, file.buffer);

    try {
      return await this.prisma.document.create({
        data: {
          schoolId,
          studentId,
          kind: dto.kind ?? 'OTHER',
          name: cleanFileName(dto.name ?? file.originalname, `document.${type.ext}`),
          originalName: cleanFileName(file.originalname, `document.${type.ext}`),
          mimeType: type.mime,
          size: file.buffer.length,
          storageKey,
          uploadedById: user.id,
        },
        select: PUBLIC_FIELDS,
      });
    } catch (error) {
      // do not leave a file behind that nothing points to
      await this.storage.delete(storageKey).catch(() => undefined);
      throw error;
    }
  }

  async list(studentId: string, user: RequestUser) {
    const { schoolId } = await this.access.assertCanView(user, studentId, [
      UserRole.SCHOOL_ADMIN,
      UserRole.TEACHER,
    ]);

    return this.prisma.document.findMany({
      where: { studentId, schoolId },
      select: PUBLIC_FIELDS,
      orderBy: { createdAt: 'desc' },
    });
  }

  async download(id: string, user: RequestUser) {
    if (!user.schoolId) {
      throw new ForbiddenException('You are not part of a school');
    }

    const document = await this.prisma.document.findFirst({
      where: { id, schoolId: user.schoolId },
    });

    if (!document) {
      throw new NotFoundException('Document not found');
    }

    await this.access.assertCanView(user, document.studentId, [UserRole.SCHOOL_ADMIN, UserRole.TEACHER]);

    return {
      buffer: await this.storage.read(document.storageKey),
      mimeType: document.mimeType,
      filename: document.name,
    };
  }

  async remove(id: string, user: RequestUser) {
    const schoolId = this.requireAdmin(user);

    const document = await this.prisma.document.findFirst({ where: { id, schoolId } });

    if (!document) {
      throw new NotFoundException('Document not found');
    }

    await this.prisma.document.delete({ where: { id } });
    await this.storage.delete(document.storageKey).catch(() => undefined);

    return { deleted: true };
  }
}
