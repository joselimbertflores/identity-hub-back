import { PartialType } from '@nestjs/mapped-types';
import { ArrayUnique, IsArray, IsInt } from 'class-validator';
import { Type } from 'class-transformer';

import { CreateUserDto } from 'src/modules/users/dtos';

export class CreateUserWithAccessDto extends CreateUserDto {
  @IsArray()
  @ArrayUnique()
  @Type(() => Number)
  @IsInt({ each: true })
  applicationIds: number[];
}

export class UpdateUserWithAccessDto extends PartialType(CreateUserWithAccessDto) {}
