import { PartialType } from '@nestjs/mapped-types';

import { CreateParentDto } from './create-guardian.dto';

export class UpdateParentDto extends PartialType(
  CreateParentDto,
) {}