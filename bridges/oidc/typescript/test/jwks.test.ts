import { describe, it, expect } from 'vitest';
import { JwksClient } from '../src/jwks.js';
import type { JSONWebKeySet, JWK } from 'jose';

function makeTestJwks(kid?: string): JSONWebKeySet {
  const jwk: JWK = {
    kty: 'RSA',
    alg: 'RS256',
    n: 'test-n-value',
    e: 'AQAB',
    ...(kid ? { kid } : {}),
  };
  return { keys: [jwk] };
}

describe('JwksClient.selectKey', () => {
  it('selects key by kid', () => {
    const jwks = makeTestJwks('key-1');
    const key = JwksClient.selectKey(jwks, 'key-1', undefined);
    expect(key.kid).toBe('key-1');
  });

  it('throws when kid not found', () => {
    const jwks = makeTestJwks('key-1');
    expect(() => JwksClient.selectKey(jwks, 'nonexistent', undefined)).toThrow(
      /nonexistent/,
    );
  });

  it('falls back to alg matching', () => {
    const jwks = makeTestJwks(); // no kid
    const key = JwksClient.selectKey(jwks, undefined, 'RS256');
    expect(key.alg).toBe('RS256');
  });

  it('throws on no matching alg', () => {
    const jwks = makeTestJwks();
    expect(() => JwksClient.selectKey(jwks, undefined, 'ES256')).toThrow(
      /ES256/,
    );
  });

  it('selects sole key when no kid and no alg', () => {
    const jwks = makeTestJwks();
    const key = JwksClient.selectKey(jwks, undefined, undefined);
    expect(key.kty).toBe('RSA');
  });

  it('throws on multiple keys with no kid and no alg', () => {
    const jwks: JSONWebKeySet = {
      keys: [
        { kty: 'RSA', alg: 'RS256', n: 'a', e: 'AQAB' },
        { kty: 'RSA', alg: 'RS256', n: 'b', e: 'AQAB' },
      ],
    };
    expect(() =>
      JwksClient.selectKey(jwks, undefined, undefined),
    ).toThrow(/Cannot select key/);
  });

  it('throws on ambiguous alg match', () => {
    const jwks: JSONWebKeySet = {
      keys: [
        { kty: 'RSA', alg: 'RS256', n: 'a', e: 'AQAB' },
        { kty: 'RSA', alg: 'RS256', n: 'b', e: 'AQAB' },
      ],
    };
    expect(() => JwksClient.selectKey(jwks, undefined, 'RS256')).toThrow(
      /Ambiguous/,
    );
  });
});

describe('JwksClient instance', () => {
  it('creates with custom fetch', () => {
    const mockFetch = async () => new Response('{}');
    const client = new JwksClient(mockFetch as typeof fetch);
    expect(client).toBeDefined();
  });

  it('invalidate is no-op on empty cache', () => {
    const mockFetch = async () => new Response('{}');
    const client = new JwksClient(mockFetch as typeof fetch);
    // Should not throw.
    client.invalidate('https://example.com/jwks');
  });
});
