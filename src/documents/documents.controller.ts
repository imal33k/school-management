import {
  Body,
  Controller,
  Delete,
  Get,
  Header,
  Param,
  Post,
  StreamableFile,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { UserRole } from '@prisma/client';

import { CurrentUser, type RequestUser } from '../auth/decorator/current-user.decorator';
import { Roles } from '../auth/decorator/roles.decorator';
import { uploadInterceptor, type UploadedFileLike } from '../common/uploaded-file';

import { UploadDocumentDto } from './dto/document.dto';
import { DocumentsService } from './documents.service';
import { MAX_DOCUMENT_BYTES } from './file-type';

@Controller('documents')
export class DocumentsController {
  constructor(private readonly service: DocumentsService) {}

  // multipart/form-data with a "file" field (and optional "kind" and "name")
  @Post('student/:studentId')
  @Roles(UserRole.SCHOOL_ADMIN)
  @UseInterceptors(uploadInterceptor('file', MAX_DOCUMENT_BYTES))
  upload(
    @Param('studentId') studentId: string,
    @UploadedFile() file: UploadedFileLike | undefined,
    @Body() dto: UploadDocumentDto,
    @CurrentUser() user: RequestUser,
  ) {
    return this.service.upload(studentId, file, dto, user);
  }

  @Get('student/:studentId')
  @Roles(UserRole.SCHOOL_ADMIN, UserRole.TEACHER, UserRole.STUDENT, UserRole.PARENT)
  list(@Param('studentId') studentId: string, @CurrentUser() user: RequestUser) {
    return this.service.list(studentId, user);
  }

  @Get(':id/download')
  @Roles(UserRole.SCHOOL_ADMIN, UserRole.TEACHER, UserRole.STUDENT, UserRole.PARENT)
  @Header('X-Content-Type-Options', 'nosniff')
  async download(@Param('id') id: string, @CurrentUser() user: RequestUser) {
    const file = await this.service.download(id, user);

    return new StreamableFile(file.buffer, {
      type: file.mimeType,
      disposition: `attachment; filename="${encodeURIComponent(file.filename)}"`,
    });
  }

  @Delete(':id')
  @Roles(UserRole.SCHOOL_ADMIN)
  remove(@Param('id') id: string, @CurrentUser() user: RequestUser) {
    return this.service.remove(id, user);
  }
}
