import { Expose } from 'class-transformer';
import { IsEnum, IsString, IsNotEmpty, IsOptional, ValidateIf } from 'class-validator';

export enum GrantType {
  AUTHORIZATION_CODE = 'authorization_code',
  REFRESH_TOKEN = 'refresh_token',
}
export class TokenRequestDto {
  @IsEnum(GrantType)
  @Expose({ name: 'grant_type' })
  grantType: GrantType;

  @IsString()
  @IsNotEmpty()
  @Expose({ name: 'client_id' })
  clientId: string;

  @IsOptional()
  @IsString()
  @Expose({ name: 'client_secret' })
  clientSecret?: string;

  @ValidateIf((o: TokenRequestDto) => o.grantType === GrantType.AUTHORIZATION_CODE)
  @IsString()
  @IsNotEmpty()
  code?: string;

  @ValidateIf((o: TokenRequestDto) => o.grantType === GrantType.AUTHORIZATION_CODE)
  @IsString()
  @IsNotEmpty()
  @Expose({ name: 'redirect_uri' })
  redirectUri?: string;

  @ValidateIf((o: TokenRequestDto) => o.grantType === GrantType.AUTHORIZATION_CODE)
  @IsOptional()
  @IsString()
  @Expose({ name: 'code_verifier' })
  codeVerifier?: string;

  @ValidateIf((o: TokenRequestDto) => o.grantType === GrantType.REFRESH_TOKEN)
  @IsString()
  @IsNotEmpty()
  @Expose({ name: 'refresh_token' })
  refreshToken: string;
}
