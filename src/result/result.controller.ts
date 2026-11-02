import { Controller, Get, Post, Body, Patch, Param, Delete } from '@nestjs/common';
import { ResultsService } from './result.service';
import { CreateResultDto } from './dto/create-result.dto';
import { UpdateResultDto } from './dto/update-result.dto';
import { CurrentUser, type RequestUser } from '../auth/decorator/current-user.decorator';
import { Roles } from '../auth/decorator/roles.decorator';
import { UserRole } from '@prisma/client';

@Controller('result')
export class ResultController {
  constructor(private readonly resultService: ResultsService) {}

  @Post()
  create( @CurrentUser() user: RequestUser,
  @Body() createResultDto: CreateResultDto) {
    return this.resultService.create(user,createResultDto);
  }

  @Get('me')
  @Roles(UserRole.STUDENT, UserRole.PARENT)
  findMine(@CurrentUser() user: RequestUser) { return this.resultService.findMine(user); }

  @Get()
  @Roles(UserRole.SCHOOL_ADMIN, UserRole.SUPER_ADMIN, UserRole.TEACHER)
  findAll( @CurrentUser() user: RequestUser,
) {
    return this.resultService.findAll(user);
  }

  @Get(':id')
  @Roles(
    UserRole.STUDENT,
    UserRole.PARENT,
    UserRole.TEACHER,
    UserRole.SCHOOL_ADMIN,
    UserRole.SUPER_ADMIN,
  )
  findOne( @CurrentUser() user: RequestUser,
  @Param('id') id: string) {
    return this.resultService.findOne(user,id);
  }

  @Patch(':id')
  update( @CurrentUser() user: RequestUser,
  @Param('id') id: string, @Body() updateResultDto: UpdateResultDto) {
    return this.resultService.update(user,id, updateResultDto);
  }

  @Delete(':id')
  remove( @CurrentUser() user: RequestUser,
  @Param('id') id: string) {
    return this.resultService.remove(user,id);
  }
}
