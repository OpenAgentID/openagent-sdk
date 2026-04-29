import { describe, it, expect } from 'vitest';
import {
  providerConfigSchema,
  oidcConfigSchema,
  singleProviderConfig,
  findProvider,
} from '../src/config.js';

describe('ProviderConfig', () => {
  it('validates a minimal provider', () => {
    const result = providerConfigSchema.safeParse({
      name: 'okta',
      issuer: 'https://dev-123.okta.com/oauth2/default',
    });
    expect(result.success).toBe(true);
  });

  it('rejects empty name', () => {
    const result = providerConfigSchema.safeParse({
      name: '',
      issuer: 'https://example.com',
    });
    expect(result.success).toBe(false);
  });

  it('rejects invalid issuer URL', () => {
    const result = providerConfigSchema.safeParse({
      name: 'bad',
      issuer: 'not a url',
    });
    expect(result.success).toBe(false);
  });

  it('defaults hmrClaim to sub', () => {
    const result = providerConfigSchema.parse({
      name: 'test',
      issuer: 'https://example.com',
    });
    expect(result.hmrClaim).toBe('sub');
  });

  it('accepts scope mapping', () => {
    const result = providerConfigSchema.parse({
      name: 'auth0',
      issuer: 'https://test.auth0.com/',
      scopeMapping: {
        admin: ['*:*:*'],
        viewer: ['openai:chat:read'],
      },
    });
    expect(Object.keys(result.scopeMapping)).toHaveLength(2);
  });
});

describe('OidcConfig', () => {
  it('validates a single-provider config', () => {
    const result = oidcConfigSchema.safeParse({
      providers: [
        { name: 'okta', issuer: 'https://dev-123.okta.com/oauth2/default' },
      ],
    });
    expect(result.success).toBe(true);
  });

  it('rejects empty providers array', () => {
    const result = oidcConfigSchema.safeParse({ providers: [] });
    expect(result.success).toBe(false);
  });

  it('defaults namespace and ttl', () => {
    const config = oidcConfigSchema.parse({
      providers: [{ name: 'test', issuer: 'https://example.com' }],
    });
    expect(config.namespace).toBe('openagent');
    expect(config.jwtTtlSeconds).toBe(3600);
    expect(config.httpTimeoutMs).toBe(10_000);
  });

  it('accepts multi-provider setup', () => {
    const config = oidcConfigSchema.parse({
      providers: [
        { name: 'okta', issuer: 'https://dev-123.okta.com/oauth2/default' },
        { name: 'azure', issuer: 'https://login.microsoftonline.com/tenant/v2.0' },
        { name: 'google', issuer: 'https://accounts.google.com' },
      ],
    });
    expect(config.providers).toHaveLength(3);
  });
});

describe('singleProviderConfig', () => {
  it('builds config from shorthand', () => {
    const config = singleProviderConfig({
      issuer: 'https://dev-123.okta.com/oauth2/default',
      audience: 'my-app',
    });
    expect(config.providers).toHaveLength(1);
    expect(config.providers[0].audience).toBe('my-app');
    expect(config.namespace).toBe('openagent');
  });

  it('allows namespace override', () => {
    const config = singleProviderConfig({
      issuer: 'https://example.com',
      namespace: 'custom',
    });
    expect(config.namespace).toBe('custom');
  });
});

describe('findProvider', () => {
  const config = oidcConfigSchema.parse({
    providers: [
      { name: 'okta', issuer: 'https://dev-123.okta.com/oauth2/default' },
      { name: 'google', issuer: 'https://accounts.google.com' },
    ],
  });

  it('finds matching provider', () => {
    const found = findProvider(config, 'https://accounts.google.com');
    expect(found).toBeDefined();
    expect(found?.name).toBe('google');
  });

  it('returns undefined for unknown issuer', () => {
    const found = findProvider(config, 'https://unknown.com');
    expect(found).toBeUndefined();
  });
});
