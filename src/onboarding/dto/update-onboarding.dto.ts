import { PartialType } from '@nestjs/mapped-types';
import { CreateSchoolOnboardingDto } from './create-onboarding.dto';

export class UpdateOnboardingDto extends PartialType(CreateSchoolOnboardingDto) {}
