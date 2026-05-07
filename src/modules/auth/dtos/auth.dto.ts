import { Expose } from 'class-transformer';
import { Equals, IsNotEmpty, IsOptional, IsString, IsUUID, IsUrl } from 'class-validator';

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

  @IsString()
  @IsNotEmpty()
  @IsOptional()
  scope?: string;

  @IsString()
  @IsNotEmpty()
  @IsOptional()
  state?: string;
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
