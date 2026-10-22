import { Controller, Get, Post, Body, Patch, Param, Delete, Query } from '@nestjs/common';
import { SchoolMembershipService } from './school-membership.service';
import { CreateSchoolMembershipDto } from './dto/create-school-membership.dto';
import { UpdateSchoolMembershipDto } from './dto/update-school-membership.dto';
import { CreateSchoolUserDto } from './dto/create-school-user.dto';
import { MembershipQueryDto } from './dto/membership-query.dto';
import * as currentUserDecorator from '../auth/decorator/current-user.decorator';
import { CurrentUser, type RequestUser } from '../auth/decorator/current-user.decorator';

@Controller('school-membership')
export class SchoolMembershipController {
  constructor(private readonly schoolMembershipService: SchoolMembershipService) {}

  @Post()
  create(
    @CurrentUser() user: RequestUser,
    @Body() dto: CreateSchoolMembershipDto) {
    return this.schoolMembershipService.create(user,dto);
  }

  @Get('user/:userId')
  findByUser(
    @CurrentUser() user: RequestUser,
    @Param('userId') userId: string) {
    return this.schoolMembershipService.findByUser(user, userId);
  }

  @Post('users')
  createUser(@CurrentUser() user: RequestUser, @Body() dto: CreateSchoolUserDto) {
    return this.schoolMembershipService.createUser(user, dto);
  }

  @Get('school/:schoolId')
  findBySchool( @CurrentUser() user: RequestUser,@Param('schoolId') schoolId: string, @Query() query: MembershipQueryDto){
    return this.schoolMembershipService.findBySchool(user,schoolId, query)
  }

  @Get(':id')
  findOne( @CurrentUser() user: RequestUser,
  @Param('id') id:string){
    return this.schoolMembershipService.findOne(user,id)
  }

  @Patch(':id/role')
  updateRole(@CurrentUser() user: RequestUser,
  @Param('id') id: string, @Body() dto: UpdateSchoolMembershipDto) {
    return this.schoolMembershipService.updateRole(user,id, dto);
  }

  @Delete(':id/schoolmembership')
  remove(  @CurrentUser() user: RequestUser,@Param('id') id: string) {
    return this.schoolMembershipService.remove(user, id);
  }
}
