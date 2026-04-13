import { PartialType } from '@nestjs/mapped-types';
import { Type } from 'class-transformer';
import {
  ArrayMinSize,
  ArrayNotEmpty,
  ArrayUnique,
  IsArray,
  IsInt,
  IsNotEmpty,
  IsNumber,
  IsString,
} from 'class-validator';
import { CreateUserDto } from 'src/modules/users/dtos';

export class CreateAssigmentDto {
  @IsString()
  @IsNotEmpty()
  userId: string;

  @IsArray()
  @Type(() => Number)
  @IsNumber({}, { each: true })
  @ArrayMinSize(1)
  applicationIds: number[];
}

export class CreateUserWithAccessDto extends CreateUserDto {
  @IsArray()
  @ArrayUnique()
  @ArrayNotEmpty()
  @Type(() => Number)
  @IsInt({ each: true })
  applicationIds: number[];
}

export class UpdateUserWithAccessDto extends PartialType(CreateUserWithAccessDto) {}
