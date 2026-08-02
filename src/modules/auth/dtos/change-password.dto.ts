import { Transform } from 'class-transformer';
import type { TransformFnParams } from 'class-transformer';
import { IsNotEmpty, IsString, MaxLength, MinLength } from 'class-validator';

export class ChangePasswordDto {
  @IsString()
  @IsNotEmpty()
  currentPassword: string;

  @IsString()
  @IsNotEmpty()
  @MinLength(8)
  newPassword: string;

  @IsString()
  @IsNotEmpty()
  passwordConfirmation: string;
}

export class CompletePasswordActionDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  code: string;

  @IsString()
  @IsNotEmpty()
  @MinLength(8)
  newPassword: string;

  @IsString()
  @IsNotEmpty()
  passwordConfirmation: string;
}

export class ForgotPasswordDto {
  @Transform(({ value }: TransformFnParams) => {
    const input = value as unknown;
    return typeof input === 'string' ? input.trim() : input;
  })
  @IsString()
  @IsNotEmpty()
  @MaxLength(320)
  identifier: string;
}
