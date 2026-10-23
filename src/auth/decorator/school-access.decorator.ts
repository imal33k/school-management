import { SetMetadata } from '@nestjs/common';

export const SCHOOL_ACCESS_KEY = 'requireSchoolAccess';

export const RequireSchoolAccess = () => SetMetadata(SCHOOL_ACCESS_KEY, true);
