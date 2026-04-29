import { describe, it, expect } from 'vitest';
import { wellKnownUrl, discoveryDocumentSchema } from '../src/discovery.js';

describe('wellKnownUrl', () => {
  it('appends well-known path', () => {
    expect(wellKnownUrl('https://example.com')).toBe(
      'https://example.com/.well-known/openid-configuration',
    );
  });

  it('strips trailing slash', () => {
    expect(wellKnownUrl('https://example.com/')).toBe(
      'https://example.com/.well-known/openid-configuration',
    );
  });

  it('handles issuer with path', () => {
    expect(wellKnownUrl('https://dev-123.okta.com/oauth2/default')).toBe(
      'https://dev-123.okta.com/oauth2/default/.well-known/openid-configuration',
    );
  });

  it('throws on empty string', () => {
    expect(() => wellKnownUrl('')).toThrow();
  });
});

describe('discoveryDocumentSchema', () => {
  it('parses a minimal discovery document', () => {
    const doc = discoveryDocumentSchema.parse({
      issuer: 'https://example.com',
      jwks_uri: 'https://example.com/jwks',
    });
    expect(doc.issuer).toBe('https://example.com');
    expect(doc.jwks_uri).toBe('https://example.com/jwks');
    expect(doc.scopes_supported).toEqual([]);
  });

  it('parses a full discovery document', () => {
    const doc = discoveryDocumentSchema.parse({
      issuer: 'https://example.com',
      authorization_endpoint: 'https://example.com/authorize',
      token_endpoint: 'https://example.com/token',
      jwks_uri: 'https://example.com/jwks',
      response_types_supported: ['code'],
      subject_types_supported: ['public'],
      id_token_signing_alg_values_supported: ['RS256'],
      scopes_supported: ['openid', 'profile'],
    });
    expect(doc.scopes_supported).toEqual(['openid', 'profile']);
  });

  it('rejects missing jwks_uri', () => {
    const result = discoveryDocumentSchema.safeParse({
      issuer: 'https://example.com',
      jwks_uri: '',
    });
    expect(result.success).toBe(false);
  });
});
