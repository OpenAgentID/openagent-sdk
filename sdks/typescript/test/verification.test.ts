import { describe, it, expect } from 'vitest';
import { StubVerificationClient } from '@openagent/sdk-testing';
import {
  PrivilegedAuthorityVerificationClient,
  extractBearerToken,
  assertScopes,
  assertAncestor,
  toVerificationClient,
  type AuthContext,
} from '../src/verification.js';
import { ErrorCode, VerificationError, OpenAgentError } from '../src/errors.js';

describe('extractBearerToken', () => {
  it('reads Authorization: Bearer', () => {
    const req = new Request('https://example.com/', {
      headers: { Authorization: 'Bearer abc.def' },
    });
    expect(extractBearerToken(req)).toBe('abc.def');
  });

  it('reads Authorization: OpenAgent', () => {
    const req = new Request('https://example.com/', {
      headers: { Authorization: 'OpenAgent sig.pub' },
    });
    expect(extractBearerToken(req)).toBe('sig.pub');
  });

  it('reads X-OpenAgent-Token fallback', () => {
    const req = new Request('https://example.com/', {
      headers: { 'X-OpenAgent-Token': 'xyz' },
    });
    expect(extractBearerToken(req)).toBe('xyz');
  });

  it('reads oa_token query fallback', () => {
    const req = new Request('https://example.com/?oa_token=qqq');
    expect(extractBearerToken(req)).toBe('qqq');
  });

  it('returns null when missing', () => {
    const req = new Request('https://example.com/');
    expect(extractBearerToken(req)).toBe(null);
  });
});

describe('assertScopes / assertAncestor', () => {
  const baseCtx: AuthContext = {
    did: 'did:oas:l1fe:agent:bot',
    root: 'did:oas:l1fe:hmr:alice',
    lineage: ['did:oas:l1fe:hmr:alice', 'did:oas:l1fe:agent:bot'],
    scopes: ['openai:chat:completions', 'github:repo:read'],
    expiresAt: Math.floor(Date.now() / 1000) + 300,
  };

  it('passes when all scopes are present', () => {
    expect(() => assertScopes(baseCtx, ['openai:chat:completions'])).not.toThrow();
  });

  it('throws VerificationError when a scope is missing', () => {
    expect(() => assertScopes(baseCtx, ['stripe:payments:create'])).toThrow(
      VerificationError,
    );
  });

  it('passes when ancestor is in lineage', () => {
    expect(() => assertAncestor(baseCtx, 'did:oas:l1fe:hmr:alice')).not.toThrow();
  });

  it('throws when ancestor is not in lineage', () => {
    expect(() => assertAncestor(baseCtx, 'did:oas:l1fe:hmr:bob')).toThrow(
      VerificationError,
    );
  });
});

describe('StubVerificationClient', () => {
  it('accepts valid stub: tokens', async () => {
    const client = new StubVerificationClient();
    const req = new Request('https://example.com/', {
      headers: { Authorization: 'Bearer stub:did:oas:l1fe:agent:bot' },
    });
    const ctx = await client.verifyRequest(req);
    expect(ctx.did).toBe('did:oas:l1fe:agent:bot');
  });

  it('accepts valid OpenAgent stub: tokens', async () => {
    const verifier = new StubVerificationClient();
    const req = new Request('https://example.com/', {
      headers: { Authorization: 'OpenAgent stub:did:oas:l1fe:agent:bot' },
    });
    const ctx = await verifier.verifyRequest(req);
    expect(ctx.did).toBe('did:oas:l1fe:agent:bot');
    expect(ctx.presentedToken).toBe('stub:did:oas:l1fe:agent:bot');
  });

  it('throws when no token is present', async () => {
    const client = new StubVerificationClient();
    await expect(client.verifyRequest(new Request('https://example.com/'))).rejects.toBeInstanceOf(
      VerificationError,
    );
  });

  it('rejects non-stub tokens', async () => {
    const client = new StubVerificationClient();
    const req = new Request('https://example.com/', {
      headers: { Authorization: 'Bearer jwt.real.token' },
    });
    await expect(client.verifyRequest(req)).rejects.toBeInstanceOf(VerificationError);
  });

  it('fails closed when privileged authority is required', async () => {
    const client = new StubVerificationClient();
    const req = new Request('https://example.com/', {
      headers: { Authorization: 'Bearer stub:did:oas:l1fe:agent:bot' },
    });
    await expect(
      client.verifyRequest(req, {
        requirePrivilegedAuthority: true,
        requiredAuthorityPath: 'human_to_agent',
      }),
    ).rejects.toMatchObject({
      code: ErrorCode.IDENTITY_LINEAGE_INVALID,
    });
  });

  it('issues challenges and verifies responses', async () => {
    const client = new StubVerificationClient();
    const challenge = await client.issueChallenge();
    expect(challenge.challenge).toBeInstanceOf(Uint8Array);
    expect(challenge.challenge.length).toBe(32);
    const ctx = await client.verifyChallengeResponse({
      challengeId: challenge.challengeId,
      agentDid: 'did:oas:l1fe:agent:bot',
      signatureBase64: 'xxx',
    });
    expect(ctx.did).toBe('did:oas:l1fe:agent:bot');
  });

  it('rejects unknown challenges', async () => {
    const client = new StubVerificationClient();
    await expect(
      client.verifyChallengeResponse({
        challengeId: 'nope',
        agentDid: 'did:oas:l1fe:agent:bot',
        signatureBase64: '',
      }),
    ).rejects.toBeInstanceOf(VerificationError);
  });
});

describe('PrivilegedAuthorityVerificationClient', () => {
  it('attaches resolver-backed authority context when privileged authority is required', async () => {
    const client = new PrivilegedAuthorityVerificationClient(new StubVerificationClient(), {
      async verify(ctx, options) {
        return {
          subject: ctx.did,
          root: ctx.root,
          source: 'gal-test',
          path: ctx.lineage,
          finalizedBlock: 42,
          pathKind: options.requiredAuthorityPath ?? 'human_to_agent',
          scopes: options.requiredScopes ?? [],
          generation: 0,
          rootKind: 'hmr',
        };
      },
    });
    const req = new Request('https://example.com/', {
      headers: { Authorization: 'Bearer stub:did:oas:l1fe:agent:bot' },
    });

    const ctx = await client.verifyRequest(req, {
      requirePrivilegedAuthority: true,
      requiredAuthorityPath: 'human_to_agent',
    });

    expect(ctx.lineageAuthority?.subject).toBe(ctx.did);
    expect(ctx.lineageAuthority?.source).toBe('gal-test');
    expect(ctx.lineageAuthority?.generation).toBe(0);
  });

  it('fails closed when privileged authority verifier returns malformed context', async () => {
    const client = new PrivilegedAuthorityVerificationClient(new StubVerificationClient(), {
      async verify(ctx) {
        return {
          subject: 'did:oas:l1fe:agent:other',
          root: ctx.root,
          source: 'gal-test',
          path: ctx.lineage,
          finalizedBlock: 42,
          pathKind: 'human_to_agent',
          scopes: [],
          generation: 0,
          rootKind: 'hmr',
        };
      },
    });
    const req = new Request('https://example.com/', {
      headers: { Authorization: 'Bearer stub:did:oas:l1fe:agent:bot' },
    });

    await expect(
      client.verifyRequest(req, { requirePrivilegedAuthority: true }),
    ).rejects.toMatchObject({ code: ErrorCode.IDENTITY_LINEAGE_INVALID });
  });
});

describe('toVerificationClient', () => {
  it('accepts valid clients', () => {
    const client = new StubVerificationClient();
    expect(toVerificationClient(client)).toBe(client);
  });

  it('rejects invalid clients', () => {
    expect(() => toVerificationClient({})).toThrow(OpenAgentError);
  });
});
