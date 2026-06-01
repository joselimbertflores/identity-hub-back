import { IsOptional, IsString, MaxLength } from 'class-validator';

export class AssignableUserQueryDto {
  @IsOptional()
  @IsString()
  @MaxLength(100)
  term?: string;
}
