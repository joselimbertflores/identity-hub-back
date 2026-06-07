import { Expose } from 'class-transformer';
import { Equals, IsEmpty, IsNotEmpty, IsOptional, IsString, IsUUID, IsUrl, Length, Matches } from 'class-validator';

export class AuthorizeParamsDto {
  @IsString()
  @IsNotEmpty()
  @Expose({ name: 'client_id' })
  clientId: string;

  @IsString()
  @IsNotEmpty()
  @IsUrl({ require_tld: false })
  @Expose({ name: 'redirect_uri' })
  redirectUri: string;

  @IsString()
  @Equals('code', { message: 'response type must be "code"' })
  @Expose({ name: 'response_type' })
  responseType: string;

  @IsOptional()
  @IsEmpty({ message: 'scope is not supported' })
  scope?: string;

  @IsString()
  @IsNotEmpty()
  state: string;

  @IsString()
  @IsNotEmpty()
  @Length(43, 128)
  @Matches(/^[A-Za-z0-9._~-]+$/, {
    message: 'code_challenge must contain only PKCE unreserved characters',
  })
  @Expose({ name: 'code_challenge' })
  codeChallenge: string;

  @IsString()
  @Equals('S256', { message: 'code_challenge_method must be "S256"' })
  @Expose({ name: 'code_challenge_method' })
  codeChallengeMethod: 'S256';
}
export class LoginDto {
  @IsString()
  @IsNotEmpty()
  login: string;

  @IsString()
  @IsNotEmpty()
  password: string;
}

export class LoginParamsDto {
  @IsOptional()
  @IsUUID()
  @Expose({ name: 'auth_request_id' })
  authRequestId?: string;
}
