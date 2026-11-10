import { ArrayMaxSize, ArrayMinSize, IsArray, IsBoolean, IsInt, IsOptional, IsString, Max, MaxLength, Min, MinLength } from 'class-validator';

export class CreateClassLevelDto {
  @IsString()
  @MinLength(1)
  @MaxLength(40)
  name!: string;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(1000)
  sortOrder?: number;

  // The level students move up to (e.g. JSS 1 -> JSS 2)
  @IsOptional()
  @IsString()
  nextLevelId?: string;

  // The last level: students graduate instead of moving up
  @IsOptional()
  @IsBoolean()
  isFinal?: boolean;
}

export class UpdateClassLevelDto {
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(40)
  name?: string;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(1000)
  sortOrder?: number;

  // send null to clear it
  @IsOptional()
  @IsString()
  nextLevelId?: string | null;

  @IsOptional()
  @IsBoolean()
  isFinal?: boolean;
}

export class AssignLevelDto {
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(200)
  @IsString({ each: true })
  classIds!: string[];

  // null removes the level from those classes
  @IsOptional()
  @IsString()
  levelId?: string | null;
}
