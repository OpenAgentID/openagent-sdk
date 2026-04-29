import { describe, it, expect } from 'vitest';
import {
  createJwtToActRequest,
  validateExchangeRequest,
  parseScopes,
  successResponse,
  exchangeErrors,
  GRANT_TYPE_TOKEN_EXCHANGE,
  TOKEN_TYPE_JWT,
  TOKEN_TYPE_ACT,
} from '../src/exchange.js';

describe('createJwtToActRequest', () => {
  it('sets correct grant type', () => {
    const req = createJwtToActRequest('eyJ...', ['openai:chat']);
    expect(req.grantType).toBe(GRANT_TYPE_TOKEN_EXCHANGE);
    expect(req.subjectTokenType).toBe(TOKEN_TYPE_JWT);
    expect(req.requestedTokenType).toBe(TOKEN_TYPE_ACT);
    expect(req.scope).toBe('openai:chat');
  });

  it('omits scope when no scopes provided', () => {
    const req = createJwtToActRequest('eyJ...');
    expect(req.scope).toBeUndefined();
  });

  it('joins multiple scopes with spaces', () => {
    const req = createJwtToActRequest('eyJ...', ['openai:chat', 'github:repo:read']);
    expect(req.scope).toBe('openai:chat github:repo:read');
  });
});

describe('validateExchangeRequest', () => {
  it('accepts valid request', () => {
    const req = createJwtToActRequest('eyJ...', ['openai:chat']);
    expect(() => validateExchangeRequest(req)).not.toThrow();
  });

  it('rejects empty subject token', () => {
    const req = {
      ...createJwtToActRequest('eyJ...'),
      subjectToken: '',
    };
    expect(() => validateExchangeRequest(req)).toThrow();
  });
});

describe('parseScopes', () => {
  it('parses space-delimited scopes', () => {
    expect(parseScopes('openai:chat github:repo:read')).toEqual([
      'openai:chat',
      'github:repo:read',
    ]);
  });

  it('returns empty array for undefined', () => {
    expect(parseScopes(undefined)).toEqual([]);
  });

  it('returns empty array for empty string', () => {
    expect(parseScopes('')).toEqual([]);
  });
});

describe('successResponse', () => {
  it('builds correct response', () => {
    const resp = successResponse('tok', TOKEN_TYPE_ACT, 3600, 'openai:chat');
    expect(resp.accessToken).toBe('tok');
    expect(resp.issuedTokenType).toBe(TOKEN_TYPE_ACT);
    expect(resp.tokenType).toBe('Bearer');
    expect(resp.expiresIn).toBe(3600);
    expect(resp.scope).toBe('openai:chat');
  });
});

describe('exchangeErrors', () => {
  it('creates invalid_request error', () => {
    const err = exchangeErrors.invalidRequest('bad');
    expect(err.error).toBe('invalid_request');
    expect(err.errorDescription).toBe('bad');
  });

  it('creates invalid_grant error', () => {
    const err = exchangeErrors.invalidGrant('expired');
    expect(err.error).toBe('invalid_grant');
  });

  it('creates unsupported_token_type error', () => {
    const err = exchangeErrors.unsupportedTokenType('unknown');
    expect(err.error).toBe('unsupported_token_type');
  });

  it('creates invalid_target error', () => {
    const err = exchangeErrors.invalidTarget('no target');
    expect(err.error).toBe('invalid_target');
  });
});

describe('constants', () => {
  it('matches RFC 8693 grant type', () => {
    expect(GRANT_TYPE_TOKEN_EXCHANGE).toBe(
      'urn:ietf:params:oauth:grant-type:token-exchange',
    );
  });

  it('matches standard JWT token type', () => {
    expect(TOKEN_TYPE_JWT).toBe('urn:ietf:params:oauth:token-type:jwt');
  });

  it('defines OpenAgent ACT token type', () => {
    expect(TOKEN_TYPE_ACT).toBe('urn:openagent:token-type:act');
  });
});
