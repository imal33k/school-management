import {Body,Controller,Delete,Get,Param,Patch,Post} from '@nestjs/common';
import { AcademicSessionService } from './academic-session.service';
import { CreateAcademicSessionDto } from './dto/create-academic-session.dto';
import { UpdateAcademicSessionDto } from './dto/update-academic-session.dto';

import {
  CurrentUser,
  type RequestUser,
} from '../auth/decorator/current-user.decorator';

@Controller('academic-sessions')
export class AcademicSessionController {
  constructor(
    private readonly academicSessionService: AcademicSessionService,
  ) {}

  @Post()
  create(
    @CurrentUser() user: RequestUser,
    @Body() dto: CreateAcademicSessionDto,
  ) {
    return this.academicSessionService.create(
      user,
      dto,
    );
  }

  @Get()
  findAll(
    @CurrentUser() user: RequestUser,
  ) {
    return this.academicSessionService.findAll(user);
  }

  @Get(':id')
  findOne(
    @CurrentUser() user: RequestUser,
    @Param('id') id: string,
  ) {
    return this.academicSessionService.findOne(
      id,
      user,
    );
  }

  @Patch(':id')
  update(
    @CurrentUser() user: RequestUser,
    @Param('id') id: string,
    @Body() dto: UpdateAcademicSessionDto,
  ) {
    return this.academicSessionService.update(
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
    return this.academicSessionService.remove(
      user,
      id,
    );
  }

  @Post(':id/activate')
  activate(
    @CurrentUser() user: RequestUser,
    @Param('id') id: string,
  ) {
    return this.academicSessionService.activate(
      user,
      id,
    );
  }

  @Post(':id/rollover')
  rollover(
    @CurrentUser() user: RequestUser,
    @Param('id') id: string,
  ) {
    return this.academicSessionService.rollover(user, id);
  }
}