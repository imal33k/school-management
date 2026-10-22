import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
} from '@nestjs/common';

import { TimetableService } from './timetable-entry.module';

import {
  CurrentUser,
  type RequestUser,
} from '../auth/decorator/current-user.decorator';

import { CreateTimetableEntryDto } from './dto/create-timetable-entry.dto';
import { UpdateTimetableEntryDto } from './dto/update-timetable-entry.dto';

@Controller('timetable')
export class TimetableController {
  constructor(
    private readonly timetableService: TimetableService,
  ) {}

  @Post()
  create(
    @CurrentUser() user: RequestUser,
    @Body() dto: CreateTimetableEntryDto,
  ) {
    return this.timetableService.create(user, dto);
  }

  @Get()
  findAll(
    @CurrentUser() user: RequestUser,
  ) {
    return this.timetableService.findAll(user);
  }

  @Get(':id')
  findOne(
    @CurrentUser() user: RequestUser,
    @Param('id') id: string,
  ) {
    return this.timetableService.findOne(user, id);
  }

  @Patch(':id')
  update(
    @CurrentUser() user: RequestUser,
    @Param('id') id: string,
    @Body() dto: UpdateTimetableEntryDto,
  ) {
    return this.timetableService.update(
      user,
      id,
      dto,
    );
  }

  @Delete(':id')
  remove(
    @CurrentUser() user: RequestUser,
    @Param('id') id: string,
  ) {
    return this.timetableService.remove(user, id);
  }
}