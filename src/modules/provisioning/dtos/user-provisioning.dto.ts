import { OmitType, PartialType } from '@nestjs/mapped-types';
import { ArrayUnique, IsArray, IsDefined, IsEmail, IsInt, IsNotEmpty, IsString } from 'class-validator';
import { Transform, Type } from 'class-transformer';
import type { TransformFnParams } from 'class-transformer';

import { CreateUserDto } from '../../users/dtos';

export class CreateUserWithAccessDto extends CreateUserDto {
  @IsArray()
  @ArrayUnique()
  @Type(() => Number)
  @IsInt({ each: true })
  applicationIds: number[];
}

export class UpdateUserWithAccessDto extends PartialType(CreateUserWithAccessDto) {}

export class CreateAdministrativeUserDto extends OmitType(CreateUserWithAccessDto, [
  'fullName',
  'relationKey',
  'email',
] as const) {
  @Transform(({ value }: TransformFnParams) => (typeof value === 'string' ? value.trim() : (value as unknown)))
  @IsString()
  @IsNotEmpty()
  relationKey: string;

  @Transform(({ value }: TransformFnParams) =>
    typeof value === 'string' ? value.trim().toLowerCase() || null : (value as unknown),
  )
  @IsDefined({ message: 'USER_EMAIL_REQUIRED' })
  @IsEmail()
  email: string;
}
