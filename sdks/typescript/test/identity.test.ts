import { describe, it, expect } from 'vitest';
import { StubIdentityProvider } from '@openagent/sdk-testing';
import {
  parseIdentityDocument,
  toIdentityProvider,
  identityDocumentSchema,
} from '../src/identity.js';
import { IdentityError, OpenAgentError } from '../src/errors.js';

describe('StubIdentityProvider', () => {
  it('creates agent identities with valid DIDs and lineage', async () => {
    const provider = new StubIdentityProvider('l1fe');
    const doc = await provider.createAgentIdentity({
      parent: 'did:oas:l1fe:hmr:alice',
      name: 'bot',
      scopes: ['openai:chat:completions'],
    });
    expect(doc.did.startsWith('did:oas:l1fe:agent:')).toBe(true);
    expect(doc.parent).toBe('did:oas:l1fe:hmr:alice');
    expect(doc.scopes).toEqual(['openai:chat:completions']);
    expect(doc.kind).toBe('agent');
    identityDocumentSchema.parse(doc);
  });

  it('resolves previously created DIDs', async () => {
    const provider = new StubIdentityProvider();
    const doc = await provider.createAgentIdentity({
      parent: 'did:oas:l1fe:hmr:alice',
      name: 'a',
      scopes: ['openai:chat:completions'],
    });
    const resolved = await provider.resolve(doc.did);
    expect(resolved).toEqual(doc);
  });

  it('throws IdentityError on unknown DID', async () => {
    const provider = new StubIdentityProvider();
    await expect(provider.resolve('did:oas:l1fe:agent:nope')).rejects.toBeInstanceOf(
      IdentityError,
    );
  });

  it('signs challenges only for known DIDs', async () => {
    const provider = new StubIdentityProvider();
    const doc = await provider.createAgentIdentity({
      parent: 'did:oas:l1fe:hmr:alice',
      name: 'a',
      scopes: ['openai:chat:completions'],
    });
    const sig = await provider.signChallenge(doc.did, new Uint8Array([1, 2, 3]));
    expect(sig.signer).toBe(doc.did);
    expect(sig.expiresAt).toBeGreaterThan(sig.issuedAt);

    await expect(
      provider.signChallenge('did:oas:l1fe:agent:unknown', new Uint8Array()),
    ).rejects.toBeInstanceOf(IdentityError);
  });

  it('exposes public key via publicKey()', async () => {
    const provider = new StubIdentityProvider();
    const doc = await provider.createAgentIdentity({
      parent: 'did:oas:l1fe:hmr:alice',
      name: 'a',
      scopes: ['openai:chat:completions'],
    });
    const pk = await provider.publicKey(doc.did);
    expect(pk).toBe(doc.publicKeyMultibase);
  });
});

describe('parseIdentityDocument', () => {
  it('accepts valid documents', () => {
    const doc = parseIdentityDocument({
      did: 'did:oas:l1fe:agent:bot',
      parent: 'did:oas:l1fe:hmr:alice',
      publicKeyMultibase: 'z123',
      kind: 'agent',
      scopes: ['openai:chat:completions'],
      createdAt: new Date().toISOString(),
    });
    expect(doc.did).toBe('did:oas:l1fe:agent:bot');
  });

  it('throws IdentityError on invalid payload', () => {
    expect(() => parseIdentityDocument({ bad: 'payload' })).toThrow(IdentityError);
  });
});

describe('toIdentityProvider', () => {
  it('accepts a duck-typed provider', () => {
    const provider = new StubIdentityProvider();
    expect(toIdentityProvider(provider)).toBe(provider);
  });

  it('rejects invalid clients', () => {
    expect(() => toIdentityProvider({})).toThrow(OpenAgentError);
    expect(() => toIdentityProvider(null)).toThrow(OpenAgentError);
  });
});
