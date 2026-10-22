import { PaginationQueryDto } from '../../common/dto/pagination-query.dto';
import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Query,
} from '@nestjs/common';

import { GuardianService } from './guardian.service';

import { CreateParentDto } from './dto/create-guardian.dto';
import { UpdateParentDto } from './dto/update-guardian.dto';
import { LinkStudentDto } from './dto/link-student.dto';

import {
  CurrentUser,
  type RequestUser,
} from '../../auth/decorator/current-user.decorator';

@Controller('parents')
export class GuardianController {
  constructor(
    private readonly parentService: GuardianService,
  ) {}

  @Post()
  create(
    @CurrentUser() user: RequestUser,
    @Body() dto: CreateParentDto,
  ) {
    return this.parentService.create(
      user,
      dto,
    );
  }

  @Get('me')
  me(@CurrentUser() user: RequestUser) { return this.parentService.findMe(user); }

  @Get()
  findAll(

    @CurrentUser() user: RequestUser,
    @Query() query: PaginationQueryDto,
  ) {
    return this.parentService.findAll(user, query);
  }

  @Get(':id')
  findOne(
    @CurrentUser() user: RequestUser,
    @Param('id') id: string,
  ) {
    return this.parentService.findOne(
      user,
      id,
    );
  }

  @Patch(':id')
  update(
    @CurrentUser() user: RequestUser,
    @Param('id') id: string,
    @Body() dto: UpdateParentDto,
  ) {
    return this.parentService.update(
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
    return this.parentService.remove(
      user,
      id,
    );
  }

  @Post(':id/students')
  linkStudent(
    @CurrentUser() user: RequestUser,
    @Param('id') parentId: string,
    @Body() dto: LinkStudentDto,
  ) {
    return this.parentService.linkStudent(
      user,
      parentId,
      dto,
    );
  }

  @Delete(':id/students/:studentId')
  unlinkStudent(
    @CurrentUser() user: RequestUser,
    @Param('id') parentId: string,
    @Param('studentId') studentId: string,
  ) {
    return this.parentService.unlinkStudent(
      user,
      parentId,
      studentId,
    );
  }
}