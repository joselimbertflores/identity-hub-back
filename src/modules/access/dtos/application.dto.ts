import { OmitType, PartialType } from '@nestjs/mapped-types';
import { IsArray, IsBoolean, IsNotEmpty, IsOptional, IsString, IsUrl, MaxLength } from 'class-validator';

export class CreateApplicationDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  clientId: string;

  @IsString()
  @IsNotEmpty()
  name: string;

  @IsString()
  @IsOptional()
  description?: string;

  @IsUrl({ require_tld: false })
  launchUrl: string;

  @IsString()
  @IsOptional()
  color?: string;

  @IsBoolean()
  @IsOptional()
  isConfidential?: boolean;

  @IsString({ each: true })
  @IsArray()
  redirectUris: string[];

  @IsBoolean()
  @IsOptional()
  isActive?: boolean;
}

export class UpdateClientDto extends PartialType(OmitType(CreateApplicationDto, ['clientId'])) {}
