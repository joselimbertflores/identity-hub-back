import { ConfigService } from '@nestjs/config';

import { EnvironmentVariables, environmentValidationSchema } from './env.validation';
import { getIdentityHubFrontendUrl } from './identity-hub-url';

describe('Identity Hub URL configuration', () => {
  const createConfigService = (uiUrl?: string) => {
    const get = jest.fn().mockReturnValue(uiUrl);
    const getOrThrow = jest.fn().mockReturnValue('https://siau.example');
    const service = { get, getOrThrow } as unknown as ConfigService<EnvironmentVariables, true>;
    return { service, get, getOrThrow };
  };

  it('uses the optional UI URL override when configured', () => {
    const { service, get, getOrThrow } = createConfigService('http://localhost:4200');

    expect(getIdentityHubFrontendUrl(service)).toBe('http://localhost:4200');
    expect(get).toHaveBeenCalledWith('IDENTITY_HUB_UI_URL', { infer: true });
    expect(getOrThrow).not.toHaveBeenCalled();
  });

  it('falls back to the required public URL when the UI URL is omitted', () => {
    const { service, getOrThrow } = createConfigService();

    expect(getIdentityHubFrontendUrl(service)).toBe('https://siau.example');
    expect(getOrThrow).toHaveBeenCalledWith('IDENTITY_HUB_PUBLIC_URL', {
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
