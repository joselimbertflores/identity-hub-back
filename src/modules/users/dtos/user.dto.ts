import { PartialType } from '@nestjs/mapped-types';
import { Transform } from 'class-transformer';
import type { TransformFnParams } from 'class-transformer';
import { IsArray, IsBoolean, IsEmail, IsEnum, IsNotEmpty, IsOptional, IsString } from 'class-validator';
import { UserRole } from '../entities';

export class CreateUserDto {
  @IsNotEmpty()
  @IsString()
  fullName: string;

  @IsNotEmpty()
  @IsString()
  login: string;

  @IsNotEmpty()
  @IsString()
  @IsOptional()
  relationKey?: string;

  @Transform(({ value }: TransformFnParams) => {
    const input = value as unknown;
    if (input === undefined) return undefined;
    if (input === null || (typeof input === 'string' && !input.trim())) return null;
    return typeof input === 'string' ? input.trim().toLowerCase() : input;
  })
  @IsOptional()
  @IsEmail()
  email?: string | null;

  @IsOptional()
  @IsArray()
  @IsEnum(UserRole, {
    each: true,
    message: 'Each value must be a valid transaction type.',
  })
  roles?: UserRole[];

  @IsBoolean()
  @IsOptional()
  isActive?: boolean;
}

export class UpdateUserDto extends PartialType(CreateUserDto) {}
