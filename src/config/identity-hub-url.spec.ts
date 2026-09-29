import { ConfigService } from '@nestjs/config';

import { EnvironmentVariables, environmentValidationSchema } from './env.validation';
import { getIdentityHubFrontendUrl } from './identity-hub-url';

describe('Identity Hub URL configuration', () => {
  const createConfigService = (uiUrl?: string) => {
    return {
      get: jest.fn().mockReturnValue(uiUrl),
      getOrThrow: jest.fn().mockReturnValue('https://siau.example'),
    } as unknown as ConfigService<EnvironmentVariables, true>;
  };

  it('uses the optional UI URL override when configured', () => {
    const configService = createConfigService('http://localhost:4200');

    expect(getIdentityHubFrontendUrl(configService)).toBe('http://localhost:4200');
    expect(configService.get).toHaveBeenCalledWith('IDENTITY_HUB_UI_URL', { infer: true });
    expect(configService.getOrThrow).not.toHaveBeenCalled();
  });

  it('falls back to the required public URL when the UI URL is omitted', () => {
    const configService = createConfigService();

    expect(getIdentityHubFrontendUrl(configService)).toBe('https://siau.example');
    expect(configService.getOrThrow).toHaveBeenCalledWith('IDENTITY_HUB_PUBLIC_URL', {
      infer: true,
    });
  });

  it('requires the public URL', () => {
    const result = environmentValidationSchema.extract('IDENTITY_HUB_PUBLIC_URL').validate(undefined);

    expect(result.error).toBeDefined();
  });

  it('allows the UI URL to be omitted', () => {
    const result = environmentValidationSchema.extract('IDENTITY_HUB_UI_URL').validate(undefined);

    expect(result.error).toBeUndefined();
  });
});
