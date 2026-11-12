import { describe, expect, it, jest, beforeAll, afterAll, beforeEach } from '@jest/globals';
import { Test } from '@nestjs/testing';
import { APP_GUARD } from '@nestjs/core';
import { BadRequestException, ConflictException, ForbiddenException, NotFoundException, ValidationPipe, type INestApplication } from '@nestjs/common';
import { mkdtempSync, rmSync, existsSync, readdirSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import request from 'supertest';
import { DocumentsService } from './documents.service';
import { DocumentsController } from './documents.controller';
import { DocumentsModule } from './documents.module';
import { FileStorage, LocalDiskStorage } from './file-storage';
import { cleanFileName, detectFileType, MAX_DOCUMENT_BYTES } from './file-type';
import { StudentAccessService } from '../student-access/student-access.service';
import { PrismaService } from '../prisma/prisma.service';
import { RolesGuard } from '../auth/guards/roles.guard';

// ---- little files that really start like the real thing ----
const pdf = (extra = 20) => Buffer.concat([Buffer.from('%PDF-1.7\n'), Buffer.alloc(extra, 32)]);
const png = () => Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(20)]);
const jpg = () => Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(20)]);
const webp = () => Buffer.concat([Buffer.from('RIFF'), Buffer.alloc(4), Buffer.from('WEBP'), Buffer.alloc(10)]);

describe('detectFileType', () => {
  it.each([['PDF', pdf(), 'application/pdf', 'pdf'], ['PNG', png(), 'image/png', 'png'], ['JPEG', jpg(), 'image/jpeg', 'jpg'], ['WEBP', webp(), 'image/webp', 'webp']])('%s', (_n, buf, mime, ext) => {
    expect(detectFileType(buf)).toEqual({ mime, ext });
  });
  it.each([
    ['a Windows program', Buffer.concat([Buffer.from('MZ'), Buffer.alloc(30)])],
    ['a web page', Buffer.from('<html><script>alert(1)</script></html>')],
    ['a zip / Word / Excel file', Buffer.concat([Buffer.from('PK'), Buffer.from([3, 4]), Buffer.alloc(30)])],
    ['a shell script', Buffer.from('#!/bin/sh\nrm -rf /\n...........')],
    ['a GIF', Buffer.concat([Buffer.from('GIF89a'), Buffer.alloc(30)])],
    ['an SVG image (can hold scripts)', Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"></svg>')],
    ['a tiny file', Buffer.from('%PDF-')],
    ['an empty file', Buffer.alloc(0)],
  ])('refuses %s', (_n, buf) => { expect(detectFileType(buf)).toBeNull(); });
});

describe('cleanFileName', () => {
  it('keeps a normal name', () => { expect(cleanFileName('Birth Certificate.pdf', 'x')).toBe('Birth Certificate.pdf'); });
  it('removes folder tricks, quotes and control characters', () => { expect(cleanFileName('..\\..\\etc/passwd"<x>\n.pdf', 'x')).toBe('.. .. etc passwdx.pdf'); });
  it('limits the length and falls back when nothing is left', () => { expect(cleanFileName('a'.repeat(300), 'x')).toHaveLength(100); expect(cleanFileName('"<>', 'document.pdf')).toBe('document.pdf'); });
});

describe('LocalDiskStorage (real files in a temporary folder)', () => {
  let dir: string;
  let storage: LocalDiskStorage;
  beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'uploads-')); process.env.UPLOAD_DIR = dir; storage = new LocalDiskStorage(); });
  afterAll(() => { delete process.env.UPLOAD_DIR; });

  it('saves a file, reads back exactly the same bytes, then deletes it', async () => {
    await storage.save('school-1/a.pdf', pdf(100));
    expect(existsSync(join(dir, 'school-1', 'a.pdf'))).toBe(true);
    expect((await storage.read('school-1/a.pdf')).equals(pdf(100))).toBe(true);
    await storage.delete('school-1/a.pdf');
    expect(existsSync(join(dir, 'school-1', 'a.pdf'))).toBe(false);
    rmSync(dir, { recursive: true, force: true });
  });
  it('never overwrites an existing file', async () => {
    await storage.save('s/a.pdf', pdf());
    await expect(storage.save('s/a.pdf', png())).rejects.toThrow();
    expect((await storage.read('s/a.pdf')).equals(pdf())).toBe(true);
    rmSync(dir, { recursive: true, force: true });
  });
  it.each(['../outside.txt', '../../etc/passwd', 'a/../../outside.txt', '/etc/passwd'])('refuses a key that escapes the uploads folder: %s', async (key) => {
    await expect(storage.save(key, pdf())).rejects.toThrow('Invalid storage key');
    await expect(storage.read(key)).rejects.toThrow('Invalid storage key');
    rmSync(dir, { recursive: true, force: true });
  });
  it('reading a missing file -> 404 with a clear message', async () => { await expect(storage.read('s/nope.pdf')).rejects.toThrow(NotFoundException); rmSync(dir, { recursive: true, force: true }); });
  it('deleting a missing file is fine', async () => { await expect(storage.delete('s/nope.pdf')).resolves.toBeUndefined(); rmSync(dir, { recursive: true, force: true }); });
  it('writes nothing outside the folder', async () => { await storage.save('s/a.pdf', pdf()); expect(readdirSync(dir)).toEqual(['s']); rmSync(dir, { recursive: true, force: true }); });
});

type Fn = (...args: any[]) => Promise<any>;
const mk = () => jest.fn<Fn>();
const prisma: any = { document: { count: mk(), create: mk(), findMany: mk(), findFirst: mk(), delete: mk() } };
const access = { assertCanView: jest.fn<Fn>() };
class MemoryStorage extends FileStorage {
  files = new Map<string, Buffer>();
  async save(key: string, data: Buffer) { this.files.set(key, data); }
  async read(key: string) { const f = this.files.get(key); if (!f) throw new NotFoundException('The file is missing from storage'); return f; }
  async delete(key: string) { this.files.delete(key); }
}
let storage: MemoryStorage;
let service: DocumentsService;
const as = (role: string, id = 'u1') => ({ id, role, schoolId: 'school-1' }) as any;
const admin = as('SCHOOL_ADMIN', 'u-admin');
const file = (buffer: Buffer, originalname = 'birth.pdf') => ({ originalname, mimetype: 'application/octet-stream', size: buffer.length, buffer });

beforeEach(() => {
  jest.clearAllMocks();
  storage = new MemoryStorage();
  service = new DocumentsService(prisma, access as unknown as StudentAccessService, storage);
  access.assertCanView.mockReset().mockResolvedValue({ schoolId: 'school-1' });
  prisma.document.count.mockResolvedValue(0);
  prisma.document.create.mockImplementation(async (a: any) => ({ id: 'd1', ...a.data }));
});

describe('upload', () => {
  it('stores the file under the school, saves its details, and does not reveal the storage path', async () => {
    const out: any = await service.upload('s1', file(pdf(50)), { kind: 'BIRTH_CERTIFICATE' } as any, admin);
    const data = prisma.document.create.mock.calls[0][0].data;
    expect(data).toMatchObject({ schoolId: 'school-1', studentId: 's1', kind: 'BIRTH_CERTIFICATE', name: 'birth.pdf', originalName: 'birth.pdf', mimeType: 'application/pdf', size: pdf(50).length, uploadedById: 'u-admin' });
    expect(data.storageKey).toMatch(/^school-1\/[0-9a-f-]{36}\.pdf$/);
    expect(storage.files.get(data.storageKey)?.equals(pdf(50))).toBe(true);
    expect(prisma.document.create.mock.calls[0][0].select.storageKey).toBeUndefined();
    expect(out.id).toBe('d1');
  });
  it('the kind defaults to OTHER and a custom name replaces the file name', async () => {
    await service.upload('s1', file(png(), 'IMG_0042.png'), { name: 'Passport photo' } as any, admin);
    expect(prisma.document.create.mock.calls[0][0].data).toMatchObject({ kind: 'OTHER', name: 'Passport photo', originalName: 'IMG_0042.png', mimeType: 'image/png' });
  });
  it('trusts the file\'s CONTENT, not its name: a PNG called .pdf is stored as a PNG', async () => {
    await service.upload('s1', file(png(), 'scan.pdf'), {} as any, admin);
    expect(prisma.document.create.mock.calls[0][0].data.mimeType).toBe('image/png');
    expect(prisma.document.create.mock.calls[0][0].data.storageKey).toMatch(/\.png$/);
  });
  it('a program or web page renamed to .pdf is refused and nothing is stored', async () => {
    await expect(service.upload('s1', file(Buffer.from('<html><script>x</script></html>'), 'cert.pdf'), {} as any, admin)).rejects.toThrow('Only PDF, PNG, JPG and WEBP');
    expect(storage.files.size).toBe(0);
    expect(prisma.document.create).not.toHaveBeenCalled();
  });
  it('no file, an empty file, or a file over 5 MB -> 400', async () => {
    await expect(service.upload('s1', undefined, {} as any, admin)).rejects.toThrow(BadRequestException);
    await expect(service.upload('s1', file(Buffer.alloc(0)), {} as any, admin)).rejects.toThrow(BadRequestException);
    await expect(service.upload('s1', { ...file(pdf()), size: MAX_DOCUMENT_BYTES + 1 }, {} as any, admin)).rejects.toThrow('5 MB');
    expect(storage.files.size).toBe(0);
  });
  it('at most 30 documents per student -> 409', async () => { prisma.document.count.mockResolvedValue(30); await expect(service.upload('s1', file(pdf()), {} as any, admin)).rejects.toThrow(ConflictException); expect(storage.files.size).toBe(0); });
  it('if saving the details fails, the stored file is removed (no orphan files)', async () => {
    prisma.document.create.mockRejectedValue(new Error('database down'));
    await expect(service.upload('s1', file(pdf()), {} as any, admin)).rejects.toThrow('database down');
    expect(storage.files.size).toBe(0);
  });
  it('only a school admin can upload (a parent or student of that child is not enough)', async () => {
    for (const r of ['PARENT', 'STUDENT', 'TEACHER', 'ACCOUNTANT']) await expect(service.upload('s1', file(pdf()), {} as any, as(r))).rejects.toThrow(ForbiddenException);
    expect(storage.files.size).toBe(0);
  });
  it('the student must belong to the admin\'s school', async () => {
    access.assertCanView.mockRejectedValue(new NotFoundException('Student not found'));
    await expect(service.upload('foreign', file(pdf()), {} as any, admin)).rejects.toThrow(NotFoundException);
    expect(storage.files.size).toBe(0);
  });
  it('a user with no school is refused', async () => { await expect(service.upload('s1', file(pdf()), {} as any, { id: 'x', role: 'SCHOOL_ADMIN' } as any)).rejects.toThrow(ForbiddenException); });
});

describe('list / download / remove', () => {
  const doc = { id: 'd1', schoolId: 'school-1', studentId: 's1', name: 'Birth cert.pdf', mimeType: 'application/pdf', storageKey: 'school-1/abc.pdf' };
  beforeEach(() => { prisma.document.findFirst.mockResolvedValue(doc); prisma.document.findMany.mockResolvedValue([{ id: 'd1' }]); prisma.document.delete.mockResolvedValue({}); storage.files.set('school-1/abc.pdf', pdf(5)); });

  it('list: checks the person may see this student, and only lists documents inside the school', async () => {
    await service.list('s1', as('PARENT'));
    expect(access.assertCanView).toHaveBeenCalledWith(as('PARENT'), 's1', ['SCHOOL_ADMIN', 'TEACHER']);
    expect(prisma.document.findMany.mock.calls[0][0].where).toEqual({ studentId: 's1', schoolId: 'school-1' });
    expect(prisma.document.findMany.mock.calls[0][0].select.storageKey).toBeUndefined();
  });
  it('list: a parent of a DIFFERENT child gets nothing', async () => {
    access.assertCanView.mockRejectedValue(new NotFoundException('Student not found'));
    await expect(service.list('s1', as('PARENT'))).rejects.toThrow(NotFoundException);
    expect(prisma.document.findMany).not.toHaveBeenCalled();
  });
  it('download: returns the file bytes with its type and name', async () => {
    const out = await service.download('d1', as('PARENT'));
    expect(out).toMatchObject({ mimeType: 'application/pdf', filename: 'Birth cert.pdf' });
    expect(out.buffer.equals(pdf(5))).toBe(true);
    expect(access.assertCanView).toHaveBeenCalledWith(as('PARENT'), 's1', ['SCHOOL_ADMIN', 'TEACHER']);
  });
  it('download: another school\'s document looks like it does not exist', async () => {
    prisma.document.findFirst.mockResolvedValue(null);
    await expect(service.download('d9', admin)).rejects.toThrow(NotFoundException);
    expect(prisma.document.findFirst.mock.calls[0][0].where).toEqual({ id: 'd9', schoolId: 'school-1' });
  });
  it('download: someone who may not see that student cannot get the file', async () => {
    access.assertCanView.mockRejectedValue(new NotFoundException('Student not found'));
    await expect(service.download('d1', as('STUDENT'))).rejects.toThrow(NotFoundException);
  });
  it('download: a record whose file has gone missing -> 404', async () => { storage.files.clear(); await expect(service.download('d1', admin)).rejects.toThrow('missing from storage'); });
  it('remove: deletes the record and the file', async () => {
    await expect(service.remove('d1', admin)).resolves.toEqual({ deleted: true });
    expect(prisma.document.delete).toHaveBeenCalledWith({ where: { id: 'd1' } });
    expect(storage.files.has('school-1/abc.pdf')).toBe(false);
  });
  it('remove: admin only, and only inside their school', async () => {
    for (const r of ['PARENT', 'STUDENT', 'TEACHER']) await expect(service.remove('d1', as(r))).rejects.toThrow(ForbiddenException);
    prisma.document.findFirst.mockResolvedValue(null);
    await expect(service.remove('d1', admin)).rejects.toThrow(NotFoundException);
    expect(prisma.document.delete).not.toHaveBeenCalled();
  });
});

describe('HTTP routes (real multipart uploads)', () => {
  const svc = Object.fromEntries(['upload', 'list', 'download', 'remove'].map((k) => [k, jest.fn<Fn>().mockResolvedValue({ ok: 1 })]));
  let role = 'SCHOOL_ADMIN';
  let app: INestApplication;
  beforeAll(async () => {
    const m = await Test.createTestingModule({ controllers: [DocumentsController], providers: [{ provide: DocumentsService, useValue: svc }, { provide: APP_GUARD, useClass: RolesGuard }] }).compile();
    app = m.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
    app.use((req: any, _r: unknown, next: () => void) => { req.user = { id: 'u', role, schoolId: 'school-1' }; next(); });
    await app.init();
  });
  afterAll(async () => { await app.close(); });
  beforeEach(() => { Object.values(svc).forEach((f) => f.mockClear()); svc.download.mockResolvedValue({ buffer: pdf(5), mimeType: 'application/pdf', filename: 'Birth cert.pdf' }); role = 'SCHOOL_ADMIN'; });
  const http = () => request(app.getHttpServer());

  it('an admin uploads a file with a kind and name; the service receives the file and the fields', async () => {
    const res = await http().post('/documents/student/s1').field('kind', 'MEDICAL').field('name', 'Allergy note').attach('file', pdf(), 'note.pdf');
    expect(res.status).toBe(201);
    const [studentId, f, dto] = svc.upload.mock.calls[0] as any[];
    expect(studentId).toBe('s1');
    expect(f).toMatchObject({ originalname: 'note.pdf' }); expect(f.buffer.equals(pdf())).toBe(true);
    expect(dto).toMatchObject({ kind: 'MEDICAL', name: 'Allergy note' });
  });
  it('only the admin can upload or delete', async () => {
    for (const r of ['TEACHER', 'STUDENT', 'PARENT', 'ACCOUNTANT']) { role = r; expect((await http().post('/documents/student/s1').attach('file', pdf(), 'a.pdf')).status).toBe(403); expect((await http().delete('/documents/d1')).status).toBe(403); }
    expect(svc.upload).not.toHaveBeenCalled(); expect(svc.remove).not.toHaveBeenCalled();
    role = 'SCHOOL_ADMIN'; expect((await http().delete('/documents/d1')).status).toBe(200);
  });
  it('staff, students and parents can list and download (the service checks whose it is); accountants cannot', async () => {
    for (const r of ['SCHOOL_ADMIN', 'TEACHER', 'STUDENT', 'PARENT']) { role = r; expect((await http().get('/documents/student/s1')).status).toBe(200); expect((await http().get('/documents/d1/download')).status).toBe(200); }
    role = 'ACCOUNTANT'; expect((await http().get('/documents/d1/download')).status).toBe(403);
  });
  it('a download comes with the right type, "attachment", and the no-sniffing header', async () => {
    const res = await http().get('/documents/d1/download').buffer(true).parse((r, cb) => { const c: Buffer[] = []; r.on('data', (d: Buffer) => c.push(d)); r.on('end', () => cb(null, Buffer.concat(c))); });
    expect(res.headers['content-type']).toContain('application/pdf');
    expect(res.headers['content-disposition']).toBe('attachment; filename="Birth%20cert.pdf"');
    expect(res.headers['x-content-type-options']).toBe('nosniff');
    expect((res.body as Buffer).equals(pdf(5))).toBe(true);
  });
  it('a file over 5 MB -> 413 and never reaches the service', async () => {
    expect((await http().post('/documents/student/s1').attach('file', Buffer.alloc(MAX_DOCUMENT_BYTES + 10, 65), 'big.pdf')).status).toBe(413);
    expect(svc.upload).not.toHaveBeenCalled();
  });
  it('a wrong "kind" or an unknown field -> 400', async () => {
    expect((await http().post('/documents/student/s1').field('kind', 'SELFIE').attach('file', pdf(), 'a.pdf')).status).toBe(400);
    expect((await http().post('/documents/student/s1').field('hack', '1').attach('file', pdf(), 'a.pdf')).status).toBe(400);
    expect(svc.upload).not.toHaveBeenCalled();
  });
  it('a missing file reaches the service, which says "attach a file"', async () => {
    await http().post('/documents/student/s1').field('kind', 'OTHER');
    expect((svc.upload.mock.calls[0] as any[])[1]).toBeUndefined();
  });
  it('module wiring builds, using the disk storage', async () => {
    const mod = await Test.createTestingModule({ imports: [DocumentsModule] }).useMocker((t) => (t === PrismaService ? {} : undefined)).compile();
    expect(mod.get(DocumentsService)).toBeInstanceOf(DocumentsService);
    expect(mod.get(FileStorage)).toBeInstanceOf(LocalDiskStorage);
  });
});
