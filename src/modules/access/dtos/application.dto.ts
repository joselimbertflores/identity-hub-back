import { OmitType, PartialType } from '@nestjs/mapped-types';
import { ArrayNotEmpty, ArrayUnique, IsArray, IsBoolean, IsNotEmpty, IsOptional, IsString, IsUrl, Matches, MaxLength } from 'class-validator';

export class CreateApplicationDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  @Matches(/^[a-zA-Z0-9_-]+$/, {
    message: 'clientId solo puede contener letras, números, guion y guion bajo',
  })
  clientId: string;

  @IsString()
  @MaxLength(150)
  @IsNotEmpty()
  name: string;

  @IsString()
  @IsOptional()
  description?: string;

  @IsUrl({ require_tld: false, require_protocol: true })
  launchUrl: string;

  @IsString()
  @IsOptional()
  color?: string;

  @IsBoolean()
  @IsOptional()
  isConfidential?: boolean;

  @IsArray()
  @ArrayNotEmpty()
  @ArrayUnique()
  @IsUrl(
    {
      require_tld: false,
      require_protocol: true,
    },
    { each: true },
  )
  redirectUris: string[];

  @IsBoolean()
  @IsOptional()
  isActive?: boolean;
}

export class UpdateClientDto extends PartialType(OmitType(CreateApplicationDto, ['clientId'])) {}
