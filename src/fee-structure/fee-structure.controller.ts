import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
} from '@nestjs/common';

import { FeeStructuresService } from './fee-structure.service';

import {
  CurrentUser,
  type RequestUser,
} from '../auth/decorator/current-user.decorator';

import { CreateFeeStructureDto } from './dto/create-fee-structure.dto';
import { UpdateFeeStructureDto } from './dto/update-fee-structure.dto';

@Controller('fee-structures')
export class FeeStructureController {
  constructor(
    private readonly feeStructureService: FeeStructuresService,
  ) {}

  @Post()
  create(
    @CurrentUser() user: RequestUser,
    @Body() dto: CreateFeeStructureDto,
  ) {
    return this.feeStructureService.create( dto,user);
  }

  @Get()
  findAll(@CurrentUser() user: RequestUser) {
    return this.feeStructureService.findAll(user);
  }

  @Get(':id')
  findOne(
    @CurrentUser() user: RequestUser,
    @Param('id') id: string,
  ) {
    return this.feeStructureService.findOne( id, user);
  }

  @Patch(':id')
  update(
    @CurrentUser() user: RequestUser,
    @Param('id') id: string,
    @Body() dto: UpdateFeeStructureDto,
  ) {
    return this.feeStructureService.update(
      id,
      dto,
      user,
    );
  }

  @Delete(':id')
  remove(
    @CurrentUser() user: RequestUser,
    @Param('id') id: string,
  ) {
    return this.feeStructureService.remove( id, user,);
  }
}