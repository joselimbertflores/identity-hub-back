import { PartialType } from '@nestjs/mapped-types';
import { IsArray, IsEnum, IsNotEmpty, IsOptional, IsString } from 'class-validator';
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

  @IsOptional()
  @IsArray()
  @IsEnum(UserRole, {
    each: true,
    message: 'Each value must be a valid transaction type.',
  })
  roles?: UserRole[];
}

export class UpdateUserDto extends PartialType(CreateUserDto) {}
