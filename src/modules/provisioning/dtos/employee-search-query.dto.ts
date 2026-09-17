import { Transform, Type } from 'class-transformer';
import type { TransformFnParams } from 'class-transformer';
import { IsInt, IsNotEmpty, IsOptional, IsString, Max, Min } from 'class-validator';

export class EmployeeSearchQueryDto {
  @Transform(({ value }: TransformFnParams) => (typeof value === 'string' ? value.trim() : (value as unknown)))
  @IsString()
  @IsNotEmpty()
  q: string;

  @Type(() => Number)
  @IsOptional()
  @IsInt()
  @Min(1)
  page: number = 1;

  @Type(() => Number)
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(50)
  limit: number = 10;
}
