import { Expose } from 'class-transformer';
import { IsEnum, IsString, IsNotEmpty, IsOptional, IsUrl, ValidateIf, Length, Matches } from 'class-validator';

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
  @IsUrl({ require_tld: false })
  @Expose({ name: 'redirect_uri' })
  redirectUri?: string;

  @ValidateIf((o: TokenRequestDto) => o.grantType === GrantType.AUTHORIZATION_CODE)
  @IsString()
  @IsNotEmpty()
  @Length(43, 128)
  @Matches(/^[A-Za-z0-9._~-]+$/, {
    message: 'code_verifier must contain only PKCE unreserved characters',
  })
  @Expose({ name: 'code_verifier' })
  codeVerifier?: string;

  @ValidateIf((o: TokenRequestDto) => o.grantType === GrantType.REFRESH_TOKEN)
  @IsString()
  @IsNotEmpty()
  @Expose({ name: 'refresh_token' })
  refreshToken?: string;
}
