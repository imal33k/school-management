import { describe, expect, it, jest, beforeAll, afterAll, beforeEach } from '@jest/globals';
import { Test } from '@nestjs/testing';
import { APP_GUARD } from '@nestjs/core';
import { BadRequestException, ConflictException, ForbiddenException, NotFoundException, ValidationPipe, type INestApplication } from '@nestjs/common';
import request from 'supertest';
import { ClassLevelsService, DEFAULT_LEVELS } from './class-levels.service';
import { ClassLevelsController } from './class-levels.controller';
import { RolesGuard } from '../auth/guards/roles.guard';

type Fn = (...args: any[]) => Promise<any>;
const mk = () => jest.fn<Fn>();
const prisma: any = {
  classLevel: { findFirst: mk(), findMany: mk(), count: mk(), create: mk(), update: mk(), delete: mk() },
  schoolClass: { count: mk(), findMany: mk(), updateMany: mk() }, feeStructure: { count: mk() },
};
prisma.$transaction = jest.fn(async (fn: (tx: any) => Promise<any>) => fn(prisma));
const service = new ClassLevelsService(prisma);
const admin = { id: 'u1', role: 'SCHOOL_ADMIN', schoolId: 'school-1' } as any;

beforeEach(() => {
  jest.clearAllMocks();
  prisma.classLevel.findFirst.mockResolvedValue(null);
  prisma.classLevel.findMany.mockResolvedValue([]);
  prisma.classLevel.count.mockResolvedValue(0);
  prisma.classLevel.create.mockImplementation(async (a: any) => ({ id: 'new' + prisma.classLevel.create.mock.calls.length, ...a.data }));
  prisma.classLevel.update.mockImplementation(async (a: any) => ({ id: a.where.id, ...a.data }));
  prisma.schoolClass.count.mockResolvedValue(0); prisma.feeStructure.count.mockResolvedValue(0);
});

describe('create / update', () => {
  it('creates a trimmed, unique level', async () => { expect(await service.create({ name: '  JSS 1 ', sortOrder: 7 } as any, admin)).toMatchObject({ schoolId: 'school-1', name: 'JSS 1', sortOrder: 7, nextLevelId: null, isFinal: false }); });
  it('duplicate name -> 409', async () => { prisma.classLevel.findFirst.mockResolvedValueOnce({ id: 'x' }); await expect(service.create({ name: 'JSS 1' } as any, admin)).rejects.toThrow(ConflictException); });
  it('blank name -> 400', async () => { await expect(service.create({ name: '  ' } as any, admin)).rejects.toThrow(BadRequestException); });
  it('the final level cannot have a next level', async () => { await expect(service.create({ name: 'SS 3', isFinal: true, nextLevelId: 'x' } as any, admin)).rejects.toThrow(/final level/); });
  it('next level must exist in this school', async () => { prisma.classLevel.findFirst.mockResolvedValueOnce(null).mockResolvedValueOnce(null); await expect(service.create({ name: 'A', nextLevelId: 'ghost' } as any, admin)).rejects.toThrow(NotFoundException); });
  it('a level cannot lead to itself', async () => { prisma.classLevel.findFirst.mockResolvedValue({ id: 'a', schoolId: 'school-1', nextLevelId: null, isFinal: false }); await expect(service.update('a', { nextLevelId: 'a' } as any, admin)).rejects.toThrow(/lead to itself/); });
  it('levels cannot loop around (A -> B -> A)', async () => {
    const rows: Record<string, any> = { a: { id: 'a', nextLevelId: null, isFinal: false }, b: { id: 'b', nextLevelId: 'a' } };
    prisma.classLevel.findFirst.mockImplementation(async (q: any) => (q.where.NOT ? null : rows[q.where.id] ?? null));
    await expect(service.update('a', { nextLevelId: 'b' } as any, admin)).rejects.toThrow(/loop/);
  });
  it('clearing the next level works (null)', async () => {
    prisma.classLevel.findFirst.mockResolvedValue({ id: 'a', nextLevelId: 'b', isFinal: false });
    expect(await service.update('a', { nextLevelId: null } as any, admin)).toMatchObject({ nextLevelId: null });
  });
  it('another school\'s level -> 404', async () => { await expect(service.update('x', { name: 'N' } as any, admin)).rejects.toThrow(NotFoundException); expect(prisma.classLevel.findFirst.mock.calls[0][0].where).toEqual({ id: 'x', schoolId: 'school-1' }); });
});

describe('remove / assign / defaults', () => {
  it('a level in use cannot be removed (classes or fees)', async () => {
    prisma.classLevel.findFirst.mockResolvedValue({ id: 'a' });
    prisma.schoolClass.count.mockResolvedValue(2);
    await expect(service.remove('a', admin)).rejects.toThrow(ConflictException);
    prisma.schoolClass.count.mockResolvedValue(0); prisma.feeStructure.count.mockResolvedValue(1);
    await expect(service.remove('a', admin)).rejects.toThrow(ConflictException);
    expect(prisma.classLevel.delete).not.toHaveBeenCalled();
  });
  it('an unused level can be removed', async () => { prisma.classLevel.findFirst.mockResolvedValue({ id: 'a' }); await expect(service.remove('a', admin)).resolves.toEqual({ deleted: true }); });
  it('assigns classes to a level, de-duplicating the list', async () => {
    prisma.classLevel.findFirst.mockResolvedValue({ id: 'L1' });
    prisma.schoolClass.findMany.mockResolvedValue([{ id: 'c1' }, { id: 'c2' }]);
    expect(await service.assign({ classIds: ['c1', 'c2', 'c1'], levelId: 'L1' }, admin)).toEqual({ updated: 2, levelId: 'L1' });
    expect(prisma.schoolClass.updateMany).toHaveBeenCalledWith({ where: { id: { in: ['c1', 'c2'] }, schoolId: 'school-1' }, data: { levelId: 'L1' } });
  });
  it('null removes the level from the classes', async () => {
    prisma.schoolClass.findMany.mockResolvedValue([{ id: 'c1' }]);
    await service.assign({ classIds: ['c1'], levelId: null }, admin);
    expect(prisma.schoolClass.updateMany.mock.calls[0][0].data).toEqual({ levelId: null });
  });
  it('a class from another school -> 404 and nothing changes', async () => {
    prisma.classLevel.findFirst.mockResolvedValue({ id: 'L1' });
    prisma.schoolClass.findMany.mockResolvedValue([{ id: 'c1' }]);
    await expect(service.assign({ classIds: ['c1', 'foreign'], levelId: 'L1' }, admin)).rejects.toThrow(NotFoundException);
    expect(prisma.schoolClass.updateMany).not.toHaveBeenCalled();
  });
  it('one-click setup builds Primary 1 ... SS 3, each leading to the next, SS 3 final', async () => {
    await service.createDefaults(admin);
    expect(prisma.classLevel.create).toHaveBeenCalledTimes(DEFAULT_LEVELS.length);
    const created = prisma.classLevel.create.mock.calls.map((c: any[]) => c[0].data);
    expect(created.map((d: any) => d.name)).toEqual(DEFAULT_LEVELS);
    expect(created.map((d: any) => d.isFinal)).toEqual([...Array(DEFAULT_LEVELS.length - 1).fill(false), true]);
    expect(prisma.classLevel.update).toHaveBeenCalledTimes(DEFAULT_LEVELS.length - 1); // links
  });
  it('one-click setup refuses if the school already has levels', async () => { prisma.classLevel.count.mockResolvedValue(3); await expect(service.createDefaults(admin)).rejects.toThrow(ConflictException); });
  it('a user with no school -> 403', async () => { await expect(service.findAll({ id: 'x', role: 'SCHOOL_ADMIN' } as any)).rejects.toThrow(ForbiddenException); });
});

describe('HTTP routes', () => {
  const svc = Object.fromEntries(['findAll', 'create', 'createDefaults', 'assign', 'update', 'remove'].map((k) => [k, jest.fn<Fn>().mockResolvedValue({ ok: 1 })]));
  let role = 'SCHOOL_ADMIN';
  let app: INestApplication;
  beforeAll(async () => {
    const m = await Test.createTestingModule({ controllers: [ClassLevelsController], providers: [{ provide: ClassLevelsService, useValue: svc }, { provide: APP_GUARD, useClass: RolesGuard }] }).compile();
    app = m.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
    app.use((req: any, _r: unknown, next: () => void) => { req.user = { id: 'u', role, schoolId: 'school-1' }; next(); });
    await app.init();
  });
  afterAll(async () => { await app.close(); });
  const status = async (r: string, method: 'get' | 'post' | 'put' | 'patch' | 'delete', url: string, body?: object) => { role = r; const q = request(app.getHttpServer())[method](url); return (body ? q.send(body) : q).then((x) => x.status); };
  it('admin, teacher and accountant can read; students and parents cannot', async () => {
    for (const r of ['SCHOOL_ADMIN', 'TEACHER', 'ACCOUNTANT']) expect(await status(r, 'get', '/class-levels')).toBe(200);
    for (const r of ['STUDENT', 'PARENT']) expect(await status(r, 'get', '/class-levels')).toBe(403);
  });
  it('only the admin can change things; "assign" and "defaults" are not read as ids', async () => {
    expect(await status('TEACHER', 'post', '/class-levels', { name: 'X' })).toBe(403);
    expect(await status('SCHOOL_ADMIN', 'post', '/class-levels', { name: 'X' })).toBe(201);
    expect(await status('SCHOOL_ADMIN', 'post', '/class-levels/defaults')).toBe(201);
    expect(await status('SCHOOL_ADMIN', 'put', '/class-levels/assign', { classIds: ['c1'], levelId: 'L1' })).toBe(200);
    expect(svc.assign).toHaveBeenCalledTimes(1); expect(svc.update).not.toHaveBeenCalled();
    expect(await status('TEACHER', 'delete', '/class-levels/L1')).toBe(403);
  });
  it('bad bodies are rejected', async () => {
    expect(await status('SCHOOL_ADMIN', 'post', '/class-levels', {})).toBe(400);
    expect(await status('SCHOOL_ADMIN', 'put', '/class-levels/assign', { classIds: [] })).toBe(400);
    expect(await status('SCHOOL_ADMIN', 'post', '/class-levels', { name: 'X', isFinal: 'yes' })).toBe(400);
  });
});
