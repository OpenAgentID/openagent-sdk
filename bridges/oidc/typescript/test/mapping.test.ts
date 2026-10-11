import { generateKeyPairSync, sign } from 'node:crypto';
import { describe, it, expect } from 'vitest';
import {
  hmrIdentifierFromClaims,
  deriveAgentFromClaims,
  type IdentityDeriver,
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

const rootKeys = generateKeyPairSync('ed25519');
const agentKeys = generateKeyPairSync('ed25519');
const publicJwk = agentKeys.publicKey.export({ format: 'jwk' });
const privateJwk = agentKeys.privateKey.export({ format: 'jwk' });
const realDeriver: IdentityDeriver = (namespace, claims, name) => {
  const parent = `did:oas:${namespace}:hmr:${hmrIdentifierFromClaims(claims.issuer, claims.subject)}`;
  const agentDid = `did:oas:${namespace}:agent:${name}`;
  const body = { parent, child: agentDid, depth: 1 };
  return {
    agentDid, parentHmrDid: parent, lineageDepth: 1,
    agentKeypair: { publicKey: Buffer.from(publicJwk.x!, 'base64url'), privateKey: Buffer.from(privateJwk.d!, 'base64url') },
    lineageProof: { ...body, proofValue: sign(null, Buffer.from(JSON.stringify(body)), rootKeys.privateKey).toString('base64url') },
  };
};

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
  it('fails closed without a real custody callback', () => {
    expect(() => deriveAgentFromClaims('test', testClaims(), 'bot')).toThrow('callback');
  });

  it('uses real matching Ed25519 key material and signed lineage', () => {
    const agent = deriveAgentFromClaims('test', testClaims(), 'my-bot', realDeriver);
    expect(agent.agentDid).toBe('did:oas:test:agent:my-bot');
    expect(agent.agentKeypair.publicKey).toEqual(Buffer.from(publicJwk.x!, 'base64url'));
    expect(agent.lineageProof?.proofValue).toBeTruthy();
    expect(agent.parentHmrDid).toMatch(/^did:oas:test:hmr:/);
  });

  it('rejects mismatched public/private keys', () => {
    expect(() => deriveAgentFromClaims('test', testClaims(), 'bot', (...args) => {
      const derived = realDeriver(...args);
      return { ...derived, agentKeypair: { ...derived.agentKeypair, publicKey: new Uint8Array(32) } };
    })).toThrow('matching Ed25519');
  });

  it('rejects absent owner lineage and empty identifiers', () => {
    expect(() => deriveAgentFromClaims('test', testClaims(), 'bot', (...args) => ({ ...realDeriver(...args), lineageProof: null }))).toThrow();
    expect(() => deriveAgentFromClaims('test', testClaims(), '', realDeriver)).toThrow();
    expect(() => deriveAgentFromClaims('', testClaims(), 'bot', realDeriver)).toThrow();
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
