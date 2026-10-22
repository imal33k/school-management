import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
} from '@nestjs/common';

import { TermService } from './term.service';

import { CreateTermDto } from './dto/create-term.dto';
import { UpdateTermDto } from './dto/update-term.dto';

import {
  CurrentUser,
  type RequestUser,
} from '../auth/decorator/current-user.decorator';

@Controller()
export class TermController {
  constructor(
    private readonly termService: TermService,
  ) {}

  @Post('academic-sessions/:sessionId/terms')
  create(
    @CurrentUser() user: RequestUser,
    @Param('sessionId') sessionId: string,
    @Body() dto: CreateTermDto,
  ) {
    return this.termService.create(
      user,
      sessionId,
      dto,
    );
  }

  @Get('academic-sessions/:sessionId/terms')
  findAll(
    @CurrentUser() user: RequestUser,
    @Param('sessionId') sessionId: string,
  ) {
    return this.termService.findAll(
      user,
      sessionId,
    );
  }

  @Get('terms/:id')
  findOne(
    @CurrentUser() user: RequestUser,
    @Param('id') id: string,
  ) {
    return this.termService.findOne(
      user,
      id,
    );
  }

  @Patch('terms/:id')
  update(
    @CurrentUser() user: RequestUser,
    @Param('id') id: string,
    @Body() dto: UpdateTermDto,
  ) {
    return this.termService.update(
      user,
      id,
      dto,
    );
  }

  @Delete('terms/:id')
  remove(
    @CurrentUser() user: RequestUser,
    @Param('id') id: string,
  ) {
    return this.termService.remove(
      user,
      id,
    );
  }

  @Post('terms/:id/activate')
  activate(
    @CurrentUser() user: RequestUser,
    @Param('id') id: string,
  ) {
    return this.termService.activate(
      user,
      id,
    );
  }
}