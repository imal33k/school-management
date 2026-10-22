import { UserRole } from "@prisma/client";
import { IsString, IsEnum } from "class-validator"
export class CreateSchoolMembershipDto {

    @IsString()
    userId!: string;

    @IsString()
    schoolId!: string;

    
    @IsEnum(UserRole)
    role!: UserRole;

}
