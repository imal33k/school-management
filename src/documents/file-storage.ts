import { Injectable, NotFoundException } from '@nestjs/common';
import { mkdir, readFile, unlink, writeFile } from 'fs/promises';
import { dirname, resolve, sep } from 'path';

// Where uploaded files live. Today that is a folder on the server's disk.
// To use cloud storage (S3 and so on) later, write another class with the
// same three methods and swap it in the module. Nothing else changes.
export abstract class FileStorage {
  abstract save(key: string, data: Buffer): Promise<void>;
  abstract read(key: string): Promise<Buffer>;
  abstract delete(key: string): Promise<void>;
}

@Injectable()
export class LocalDiskStorage extends FileStorage {
  private readonly root = resolve(process.env.UPLOAD_DIR || './uploads');

  // Refuses any key that would escape the uploads folder (like ../../etc)
  private pathFor(key: string): string {
    const full = resolve(this.root, key);

    if (!full.startsWith(this.root + sep)) {
      throw new Error('Invalid storage key');
    }

    return full;
  }

  async save(key: string, data: Buffer): Promise<void> {
    const full = this.pathFor(key);

    await mkdir(dirname(full), { recursive: true });
    await writeFile(full, data, { flag: 'wx' }); // never overwrite an existing file
  }

  async read(key: string): Promise<Buffer> {
    try {
      return await readFile(this.pathFor(key));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        throw new NotFoundException('The file is missing from storage');
      }

      throw error;
    }
  }

  async delete(key: string): Promise<void> {
    try {
      await unlink(this.pathFor(key));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
        throw error;
      }
    }
  }
}
