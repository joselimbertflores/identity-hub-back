import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common';

import { ApplicationClientAuthService } from '../services';
import { ApplicationClientRequest } from '../interfaces';

@Injectable()
export class ApplicationClientAuthGuard implements CanActivate {
  constructor(private readonly applicationClientAuthService: ApplicationClientAuthService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<ApplicationClientRequest>();
    const { clientId, clientSecret } = this.parseBasicAuthorization(request.headers.authorization);

    request.application = await this.applicationClientAuthService.authenticate(clientId, clientSecret);

    return true;
  }

  private parseBasicAuthorization(authorization: string | undefined): { clientId: string; clientSecret: string } {
    const [scheme, encodedCredentials] = authorization?.split(' ') ?? [];
    if (scheme?.toLowerCase() !== 'basic' || !encodedCredentials) {
      throw new UnauthorizedException('Basic client credentials are required.');
    }

    const credentials = Buffer.from(encodedCredentials, 'base64').toString('utf8');
    const separatorIndex = credentials.indexOf(':');

    if (separatorIndex <= 0 || separatorIndex === credentials.length - 1) {
      throw new UnauthorizedException('Invalid client credentials.');
    }

    return {
      clientId: credentials.slice(0, separatorIndex),
      clientSecret: credentials.slice(separatorIndex + 1),
    };
  }
}
