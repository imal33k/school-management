import { FileInterceptor } from '@nestjs/platform-express';
import { memoryStorage } from 'multer';

// What we use from an uploaded file (multer keeps it in memory)
export interface UploadedFileLike {
  originalname: string;
  mimetype: string;
  size: number;
  buffer: Buffer;
}

// Use as: @UseInterceptors(uploadInterceptor('file', 5 * 1024 * 1024))
// A file bigger than maxBytes is refused with 413 before it reaches our code.
export function uploadInterceptor(field: string, maxBytes: number) {
  return FileInterceptor(field, {
    storage: memoryStorage(),
    limits: { fileSize: maxBytes, files: 1 },
  });
}
