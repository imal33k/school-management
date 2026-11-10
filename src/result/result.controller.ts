import { Controller, Put, Query, Get, Post, Body, Patch, Param, Delete } from '@nestjs/common';
import { ResultsService } from './result.service';
import { CreateResultDto } from './dto/create-result.dto';
import { UpdateResultDto } from './dto/update-result.dto';
import { CurrentUser, type RequestUser } from '../auth/decorator/current-user.decorator';
import { Roles } from '../auth/decorator/roles.decorator';
import { UserRole } from '@prisma/client';
import { ResultBulkService } from './result-bulk.service';
import { BulkResultDto, ResultSheetQueryDto } from './dto/bulk-result.dto';

@Controller('result')
export class ResultController {
  constructor(private readonly resultService: ResultsService, private readonly resultBulkService: ResultBulkService
  ) {}

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

    // The class list for one subject, with any marks already saved
  @Get('sheet')
  @Roles(UserRole.SCHOOL_ADMIN, UserRole.TEACHER)
  getSheet(
    @Query() query: ResultSheetQueryDto,
    @CurrentUser() user: RequestUser,
  ) {
    return this.resultBulkService.getSheet(query, user);
  }

  // Save a whole class's marks for one subject in one go
  @Put('bulk')
  @Roles(UserRole.SCHOOL_ADMIN, UserRole.TEACHER)
  saveBulk(@Body() dto: BulkResultDto, @CurrentUser() user: RequestUser) {
    return this.resultBulkService.saveBulk(dto, user);
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
