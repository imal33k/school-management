import { Module } from '@nestjs/common';

import { FeeStructureController } from './fee-structure.controller';
import { FeeStructuresService } from './fee-structure.service';

@Module({
  controllers: [FeeStructureController],
  providers: [FeeStructuresService],
  exports: [FeeStructuresService],
})
export class FeeStructureModule {}