import { Expose } from 'class-transformer';
import { Equals, IsNotEmpty, IsOptional, IsString, IsUUID } from 'class-validator';

export class AuthorizeParamsDto {
  @IsString()
  @IsNotEmpty()
  @Expose({ name: 'client_id' })
  clientId: string;

  @IsString()
  @IsNotEmpty()
  @Expose({ name: 'redirect_uri' })
  redirectUri: string;

  @IsString()
  @Equals('code', { message: 'response type must be "code"' })
  @Expose({ name: 'response_type' })
  responseType?: string;

  @IsString()
  @IsNotEmpty()
  @IsOptional()
  scope?: string;

  @IsString()
  @IsNotEmpty()
  @IsOptional()
  state: string;
}
export class LoginDto {
  @IsNotEmpty()
  login: string;

  @IsNotEmpty()
  password: string;

  @IsString()
  @IsOptional()
  redirectUrl?: string;
}

export class LoginParamsDto {
  @IsOptional()
  @IsUUID()
  @Expose({ name: 'auth_request_id' })
  authRequestId?: string;
}
