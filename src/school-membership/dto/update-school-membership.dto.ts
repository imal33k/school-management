import { PartialType } from '@nestjs/mapped-types';
import { CreateSchoolMembershipDto } from './create-school-membership.dto';

export class UpdateSchoolMembershipDto extends PartialType(CreateSchoolMembershipDto) {}
