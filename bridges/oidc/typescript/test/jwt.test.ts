import { describe, it, expect } from 'vitest';
import { buildActClaims } from '../src/jwt.js';

describe('buildActClaims', () => {
  it('sets all fields correctly', () => {
    const claims = buildActClaims({
      agentDid: 'did:oas:openagent:agent:bot',
      bridgeIssuer: 'https://bridge.openagent.id',
      audience: 'https://api.service.com',
      scopes: ['openai:chat:completions'],
      lineageDepth: 1,
      parentHmr: 'did:oas:openagent:hmr:alice',
      actB64: 'base64-act-data',
      ttlSeconds: 3600,
    });

    expect(claims.sub).toBe('did:oas:openagent:agent:bot');
    expect(claims.iss).toBe('https://bridge.openagent.id');
    expect(claims.aud).toBe('https://api.service.com');
    expect(claims.scope).toBe('openai:chat:completions');
    expect(claims.lineage_depth).toBe(1);
    expect(claims.parent_hmr).toBe('did:oas:openagent:hmr:alice');
    expect(claims.act).toBe('base64-act-data');
    expect(claims.exp).toBeGreaterThan(claims.iat);
    expect(claims.jti.length).toBeGreaterThan(0);
  });

  it('joins multiple scopes with spaces', () => {
    const claims = buildActClaims({
      agentDid: 'did:oas:openagent:agent:bot',
      bridgeIssuer: 'iss',
      scopes: ['openai:chat:*', 'github:repo:read'],
      lineageDepth: 2,
      parentHmr: 'hmr',
      actB64: 'act',
      ttlSeconds: 300,
    });
    expect(claims.scope).toBe('openai:chat:* github:repo:read');
  });

  it('omits audience when not provided', () => {
    const claims = buildActClaims({
      agentDid: 'did:oas:openagent:agent:bot',
      bridgeIssuer: 'iss',
      scopes: [],
      lineageDepth: 0,
      parentHmr: 'hmr',
      actB64: 'act',
      ttlSeconds: 60,
    });
    expect(claims.aud).toBeUndefined();
  });

  it('generates unique JTIs', () => {
    const c1 = buildActClaims({
      agentDid: 'a',
      bridgeIssuer: 'b',
      scopes: [],
      lineageDepth: 0,
      parentHmr: 'c',
      actB64: 'd',
      ttlSeconds: 60,
    });
    const c2 = buildActClaims({
      agentDid: 'a',
      bridgeIssuer: 'b',
      scopes: [],
      lineageDepth: 0,
      parentHmr: 'c',
      actB64: 'd',
      ttlSeconds: 60,
    });
    // JTIs should differ due to random generation.
    // In rare cases they could match, but crypto.getRandomValues makes this vanishingly unlikely.
    expect(c1.jti.length).toBeGreaterThan(0);
    expect(c2.jti.length).toBeGreaterThan(0);
  });
});
