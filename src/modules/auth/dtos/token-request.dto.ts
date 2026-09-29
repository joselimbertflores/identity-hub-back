import { Expose } from 'class-transformer';
import { Equals, IsString, IsNotEmpty, IsUrl, Length, Matches } from 'class-validator';

export class TokenRequestDto {
  @Equals('authorization_code')
  @Expose({ name: 'grant_type' })
  grantType: 'authorization_code';

  @IsString()
  @IsNotEmpty()
  @Expose({ name: 'client_id' })
  clientId: string;

  @IsString()
  @IsNotEmpty()
  @Expose()
  code: string;

  @IsString()
  @IsNotEmpty()
  @IsUrl({ require_tld: false })
  @Expose({ name: 'redirect_uri' })
  redirectUri: string;

  @IsString()
  @IsNotEmpty()
  @Length(43, 128)
  @Matches(/^[A-Za-z0-9._~-]+$/, {
    message: 'code_verifier must contain only PKCE unreserved characters',
  })
  @Expose({ name: 'code_verifier' })
  codeVerifier: string;
}
