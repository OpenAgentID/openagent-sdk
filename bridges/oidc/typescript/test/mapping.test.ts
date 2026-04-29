import { describe, it, expect } from 'vitest';
import {
  hmrIdentifierFromClaims,
  deriveAgentFromClaims,
  mapScopes,
} from '../src/mapping.js';
import type { ValidatedClaims } from '../src/jwt.js';

function testClaims(): ValidatedClaims {
  return {
    issuer: 'https://dev-123.okta.com/oauth2/default',
    subject: 'user-12345',
    audience: ['my-app'],
    exp: 9999999999,
    iat: 1000000000,
    hmrValue: 'user-12345',
    scopes: ['admin', 'openai:chat'],
    rawClaims: {},
  };
}

describe('hmrIdentifierFromClaims', () => {
  it('is deterministic', () => {
    const id1 = hmrIdentifierFromClaims('https://example.com', 'user-1');
    const id2 = hmrIdentifierFromClaims('https://example.com', 'user-1');
    expect(id1).toBe(id2);
  });

  it('differs for different subjects', () => {
    const id1 = hmrIdentifierFromClaims('https://example.com', 'user-1');
    const id2 = hmrIdentifierFromClaims('https://example.com', 'user-2');
    expect(id1).not.toBe(id2);
  });

  it('differs for different issuers', () => {
    const id1 = hmrIdentifierFromClaims('https://a.com', 'user-1');
    const id2 = hmrIdentifierFromClaims('https://b.com', 'user-1');
    expect(id1).not.toBe(id2);
  });

  it('returns non-empty string', () => {
    const id = hmrIdentifierFromClaims('https://example.com', 'user');
    expect(id.length).toBeGreaterThan(0);
  });
});

describe('deriveAgentFromClaims', () => {
  it('produces correct DID format', () => {
    const agent = deriveAgentFromClaims('test', testClaims(), 'my-bot');
    expect(agent.agentDid).toBe('did:oas:test:agent:my-bot');
    expect(agent.parentHmrDid).toMatch(/^did:oas:test:hmr:/);
  });

  it('includes lineage proof', () => {
    const agent = deriveAgentFromClaims('test', testClaims(), 'my-bot');
    expect(agent.lineageProof).not.toBeNull();
    expect(agent.lineageProof?.parent).toBe(agent.parentHmrDid);
    expect(agent.lineageProof?.depth).toBe(1);
  });

  it('sets lineage depth to 1', () => {
    const agent = deriveAgentFromClaims('test', testClaims(), 'my-bot');
    expect(agent.lineageDepth).toBe(1);
  });

  it('produces keypair bytes', () => {
    const agent = deriveAgentFromClaims('test', testClaims(), 'my-bot');
    expect(agent.agentKeypair.publicKey).toBeInstanceOf(Uint8Array);
    expect(agent.agentKeypair.publicKey.length).toBe(32);
  });

  it('throws on empty agent name', () => {
    expect(() => deriveAgentFromClaims('test', testClaims(), '')).toThrow();
  });

  it('throws on empty namespace', () => {
    expect(() => deriveAgentFromClaims('', testClaims(), 'bot')).toThrow();
  });

  it('produces same parent for same claims', () => {
    const a1 = deriveAgentFromClaims('test', testClaims(), 'bot-a');
    const a2 = deriveAgentFromClaims('test', testClaims(), 'bot-b');
    expect(a1.parentHmrDid).toBe(a2.parentHmrDid);
  });
});

describe('mapScopes', () => {
  it('maps roles to arsenal scopes', () => {
    const mapping = {
      admin: ['*:*:*'],
      'agent-user': ['openai:chat:*', 'github:repo:read'],
    };
    const result = mapScopes(['admin'], mapping);
    expect(result).toEqual(['*:*:*']);
  });

  it('passes through unmapped scopes', () => {
    const result = mapScopes(['openai:chat:completions'], {});
    expect(result).toEqual(['openai:chat:completions']);
  });

  it('deduplicates', () => {
    const mapping = {
      a: ['x:y:z'],
      b: ['x:y:z'],
    };
    const result = mapScopes(['a', 'b'], mapping);
    expect(result).toEqual(['x:y:z']);
  });

  it('handles empty input', () => {
    expect(mapScopes([], {})).toEqual([]);
  });

  it('handles mixed mapped and unmapped', () => {
    const mapping = { admin: ['*:*:*'] };
    const result = mapScopes(['admin', 'custom:scope'], mapping);
    expect(result).toEqual(['*:*:*', 'custom:scope']);
  });
});
