import { describe, it, expect } from 'vitest';
import { OidcBridgeError } from '../src/errors.js';

describe('OidcBridgeError', () => {
  it('creates config error', () => {
    const err = OidcBridgeError.config('missing issuer');
    expect(err.code).toBe('CONFIG_ERROR');
    expect(err.message).toBe('missing issuer');
    expect(err.name).toBe('OidcBridgeError');
  });

  it('creates discovery error', () => {
    const err = OidcBridgeError.discovery('timeout');
    expect(err.code).toBe('DISCOVERY_ERROR');
  });

  it('creates jwks error', () => {
    const err = OidcBridgeError.jwks('no keys');
    expect(err.code).toBe('JWKS_ERROR');
  });

  it('creates jwt validation error', () => {
    const err = OidcBridgeError.jwtValidation('expired');
    expect(err.code).toBe('JWT_VALIDATION_ERROR');
  });

  it('creates unknown issuer error', () => {
    const err = OidcBridgeError.unknownIssuer('https://evil.com');
    expect(err.code).toBe('UNKNOWN_ISSUER');
    expect(err.message).toContain('https://evil.com');
  });

  it('creates mapping error', () => {
    const err = OidcBridgeError.mapping('bad DID');
    expect(err.code).toBe('MAPPING_ERROR');
  });

  it('creates exchange error', () => {
    const err = OidcBridgeError.exchange('invalid grant');
    expect(err.code).toBe('EXCHANGE_ERROR');
  });

  it('creates signing error', () => {
    const err = OidcBridgeError.signing('key error');
    expect(err.code).toBe('SIGNING_ERROR');
  });

  it('creates transport error', () => {
    const err = OidcBridgeError.transport('network down');
    expect(err.code).toBe('TRANSPORT_ERROR');
  });

  it('is instanceof Error', () => {
    const err = OidcBridgeError.config('test');
    expect(err).toBeInstanceOf(Error);
    expect(err).toBeInstanceOf(OidcBridgeError);
  });
});
