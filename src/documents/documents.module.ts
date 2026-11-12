import { Module } from '@nestjs/common';

import { StudentAccessModule } from '../student-access/student-access.module';
import { DocumentsController } from './documents.controller';
import { DocumentsService } from './documents.service';
import { FileStorage, LocalDiskStorage } from './file-storage';

@Module({
  imports: [StudentAccessModule],
  controllers: [DocumentsController],
  providers: [DocumentsService, { provide: FileStorage, useClass: LocalDiskStorage }],
})
export class DocumentsModule {}
