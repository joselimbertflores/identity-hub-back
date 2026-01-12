import { IsNotEmpty, IsString, MinLength } from 'class-validator';

export class UpdateUserProfileDto {
  @IsString()
  @IsNotEmpty()
  @MinLength(8)
  password: string;
}
