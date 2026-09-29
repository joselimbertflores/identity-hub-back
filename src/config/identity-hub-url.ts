import { ConfigService } from '@nestjs/config';

import { EnvironmentVariables } from './env.validation';

export function getIdentityHubFrontendUrl(configService: ConfigService<EnvironmentVariables, true>): string {
  return (
    configService.get('IDENTITY_HUB_UI_URL', { infer: true }) ??
    configService.getOrThrow('IDENTITY_HUB_PUBLIC_URL', { infer: true })
  );
}
