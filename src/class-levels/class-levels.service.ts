import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';

import { PrismaService } from '../prisma/prisma.service';
import { RequestUser } from '../auth/decorator/current-user.decorator';

import {
  AssignLevelDto,
  CreateClassLevelDto,
  UpdateClassLevelDto,
} from './dto/class-level.dto';

// The usual Nigerian school ladder, used by the one-click setup
export const DEFAULT_LEVELS = [
  'Primary 1', 'Primary 2', 'Primary 3', 'Primary 4', 'Primary 5', 'Primary 6',
  'JSS 1', 'JSS 2', 'JSS 3', 'SS 1', 'SS 2', 'SS 3',
];

@Injectable()
export class ClassLevelsService {
  constructor(private readonly prisma: PrismaService) {}

  private requireSchoolId(user: RequestUser): string {
    if (!user.schoolId) {
      throw new ForbiddenException('You are not part of a school');
    }

    return user.schoolId;
  }

  private cleanName(name: string): string {
    const trimmed = name.trim();

    if (!trimmed) {
      throw new BadRequestException('Name is required');
    }

    return trimmed;
  }

  private async getOwned(id: string, schoolId: string) {
    const level = await this.prisma.classLevel.findFirst({ where: { id, schoolId } });

    if (!level) {
      throw new NotFoundException('Class level not found');
    }

    return level;
  }

  // "next level" must be in this school, must not be itself, and the chain must not loop
  private async assertValidNext(
    schoolId: string,
    nextLevelId: string,
    selfId?: string,
  ) {
    if (selfId && nextLevelId === selfId) {
      throw new BadRequestException('A level cannot lead to itself');
    }

    let currentId: string | null = nextLevelId;

    for (let step = 0; step < 50 && currentId; step++) {
      if (selfId && currentId === selfId) {
        throw new BadRequestException('That would make the levels loop around');
      }

      const level: { nextLevelId: string | null } | null =
        await this.prisma.classLevel.findFirst({
          where: { id: currentId, schoolId },
          select: { nextLevelId: true },
        });

      if (!level) {
        throw new NotFoundException('Next level not found in this school');
      }

      currentId = level.nextLevelId;
    }
  }

  async findAll(user: RequestUser) {
    const schoolId = this.requireSchoolId(user);

    const levels = await this.prisma.classLevel.findMany({
      where: { schoolId },
      include: {
        nextLevel: { select: { id: true, name: true } },
        _count: { select: { classes: true } },
      },
      orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
    });

    return levels.map((level) => ({
      id: level.id,
      name: level.name,
      sortOrder: level.sortOrder,
      isFinal: level.isFinal,
      nextLevel: level.nextLevel,
      classCount: level._count.classes,
    }));
  }

  async create(dto: CreateClassLevelDto, user: RequestUser) {
    const schoolId = this.requireSchoolId(user);
    const name = this.cleanName(dto.name);

    if (dto.isFinal && dto.nextLevelId) {
      throw new BadRequestException('The final level cannot have a next level');
    }

    if (await this.prisma.classLevel.findFirst({ where: { schoolId, name }, select: { id: true } })) {
      throw new ConflictException('A level with this name already exists');
    }

    if (dto.nextLevelId) {
      await this.assertValidNext(schoolId, dto.nextLevelId);
    }

    return this.prisma.classLevel.create({
      data: {
        schoolId,
        name,
        sortOrder: dto.sortOrder ?? 0,
        nextLevelId: dto.nextLevelId ?? null,
        isFinal: dto.isFinal ?? false,
      },
    });
  }

  async update(id: string, dto: UpdateClassLevelDto, user: RequestUser) {
    const schoolId = this.requireSchoolId(user);
    const current = await this.getOwned(id, schoolId);

    const name = dto.name === undefined ? undefined : this.cleanName(dto.name);

    if (name !== undefined) {
      const clash = await this.prisma.classLevel.findFirst({
        where: { schoolId, name, NOT: { id } },
        select: { id: true },
      });

      if (clash) {
        throw new ConflictException('A level with this name already exists');
      }
    }

    const nextLevelId = dto.nextLevelId === undefined ? current.nextLevelId : dto.nextLevelId;
    const isFinal = dto.isFinal ?? current.isFinal;

    if (isFinal && nextLevelId) {
      throw new BadRequestException('The final level cannot have a next level');
    }

    if (dto.nextLevelId) {
      await this.assertValidNext(schoolId, dto.nextLevelId, id);
    }

    return this.prisma.classLevel.update({
      where: { id },
      data: { name, sortOrder: dto.sortOrder, nextLevelId, isFinal },
    });
  }

  async remove(id: string, user: RequestUser) {
    const schoolId = this.requireSchoolId(user);

    await this.getOwned(id, schoolId);

    const classes = await this.prisma.schoolClass.count({ where: { levelId: id } });
    const fees = await this.prisma.feeStructure.count({ where: { levelId: id } });

    if (classes > 0 || fees > 0) {
      throw new ConflictException(
        'This level is still used by classes or fees. Move or remove them first.',
      );
    }

    await this.prisma.classLevel.delete({ where: { id } });

    return { deleted: true };
  }

  // Put a group of classes into a level (or take them out with levelId: null)
  async assign(dto: AssignLevelDto, user: RequestUser) {
    const schoolId = this.requireSchoolId(user);

    if (dto.levelId) {
      await this.getOwned(dto.levelId, schoolId);
    }

    const classIds = [...new Set(dto.classIds)];
    const found = await this.prisma.schoolClass.findMany({
      where: { id: { in: classIds }, schoolId },
      select: { id: true },
    });

    if (found.length !== classIds.length) {
      throw new NotFoundException('One or more classes were not found in this school');
    }

    await this.prisma.schoolClass.updateMany({
      where: { id: { in: classIds }, schoolId },
      data: { levelId: dto.levelId ?? null },
    });

    return { updated: classIds.length, levelId: dto.levelId ?? null };
  }

  // One-click setup: Primary 1 ... SS 3, each leading to the next
  async createDefaults(user: RequestUser) {
    const schoolId = this.requireSchoolId(user);

    if ((await this.prisma.classLevel.count({ where: { schoolId } })) > 0) {
      throw new ConflictException('This school already has levels');
    }

    await this.prisma.$transaction(async (tx) => {
      const ids: string[] = [];

      for (let i = 0; i < DEFAULT_LEVELS.length; i++) {
        const created = await tx.classLevel.create({
          data: {
            schoolId,
            name: DEFAULT_LEVELS[i],
            sortOrder: i + 1,
            isFinal: i === DEFAULT_LEVELS.length - 1,
          },
        });
        ids.push(created.id);
      }

      for (let i = 0; i < ids.length - 1; i++) {
        await tx.classLevel.update({ where: { id: ids[i] }, data: { nextLevelId: ids[i + 1] } });
      }
    });

    return this.findAll(user);
  }
}
