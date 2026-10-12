import { describe, it, expect } from 'vitest';
import {
  didRecipient,
  encodeAnchorData,
  EasAnchorResolver,
  SCHEMA_STRING,
} from '../src/index.js';
import { SchemaEncoder } from '@ethereum-attestation-service/eas-sdk';

const DID = 'did:oas:l1fe:hmr:alice';
const ATTESTER = '0x' + '12'.repeat(20);
const row = (data: string, revocationTime: number | string = 0) => ({
  id: '0x' + '34'.repeat(32), data, attester: ATTESTER, revocationTime, expirationTime: 0,
});

function fixtureData(status = 'active') {
  return {
    did: DID,
    kind: 'hmr',
    status,
    metadataCommitment: 'blake3:0123456789abcdef',
    anchoredAtBlock: 18_000_000n,
  };
}

function encodedFixture(status = 'active'): string {
  const encoder = new SchemaEncoder(SCHEMA_STRING);
  const d = fixtureData(status);
  return encoder.encodeData([
    { name: 'did', value: d.did, type: 'string' },
    { name: 'kind', value: d.kind, type: 'string' },
    { name: 'status', value: d.status, type: 'string' },
    { name: 'metadataCommitment', value: d.metadataCommitment, type: 'string' },
    { name: 'anchoredAtBlock', value: d.anchoredAtBlock, type: 'uint64' },
  ]);
}

function mockFetch(handlers: Record<string, (body: string) => unknown>) {
  return async (url: string | URL, init?: RequestInit): Promise<Response> => {
    const key = String(url);
    const handler = Object.entries(handlers).find(([prefix]) => key.startsWith(prefix));
    if (!handler) throw new Error(`no mock for ${key}`);
    const result = handler[1](String(init?.body ?? ''));
    return new Response(JSON.stringify(result), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  };
}

describe('didRecipient', () => {
  it('is deterministic and 20 bytes', () => {
    const a = didRecipient(DID);
    expect(a).toBe(didRecipient(DID));
    expect(a.startsWith('0x')).toBe(true);
    expect(a.length).toBe(42);
    expect(a).not.toBe(didRecipient('did:oas:l1fe:hmr:bob'));
  });
});

describe('encodeAnchorData', () => {
  it('matches the EAS SchemaEncoder layout exactly', () => {
    const data = fixtureData();
    const ours = encodeAnchorData(data);
    const encoder = new SchemaEncoder(SCHEMA_STRING);
    const theirs = encoder.encodeData([
      { name: 'did', value: data.did, type: 'string' },
      { name: 'kind', value: data.kind, type: 'string' },
      { name: 'status', value: data.status, type: 'string' },
      { name: 'metadataCommitment', value: data.metadataCommitment, type: 'string' },
      { name: 'anchoredAtBlock', value: data.anchoredAtBlock, type: 'uint64' },
    ]);
    expect('0x' + Buffer.from(ours).toString('hex')).toBe(theirs);
  });
});

describe('EasAnchorResolver', () => {
  const config = {
    schemaUid: '0x' + '56'.repeat(32),
    trustedAttesters: [ATTESTER],
    graphqlUrl: 'http://mock/graphql',
    rpcUrl: 'http://mock/rpc',
  };

  it('resolves a typed root anchor', async () => {
    const fetchImpl = mockFetch({
      'http://mock/graphql': () => ({
        data: {
          attestations: [row(encodedFixture())],
        },
      }),
    });
    const resolver = new EasAnchorResolver({ ...config, fetch: fetchImpl as typeof fetch });
    const record = await resolver.getRoot(DID, 'hmr');
    expect(record?.did).toBe(DID);
    expect(record?.status).toBe('active');
    expect(record?.anchoredAtBlock).toBe(18_000_000);
    expect(record?.metadataCommitment).toBe('blake3:0123456789abcdef');
  });

  it('returns undefined for a different kind', async () => {
    const fetchImpl = mockFetch({
      'http://mock/graphql': () => ({
        data: {
          attestations: [row(encodedFixture())],
        },
      }),
    });
    const resolver = new EasAnchorResolver({ ...config, fetch: fetchImpl as typeof fetch });
    expect(await resolver.getRoot(DID, 'mhr')).toBeUndefined();
  });

  it('reports revocation from the latest status', async () => {
    const fetchImpl = mockFetch({
      'http://mock/graphql': () => ({
        data: {
          attestations: [row(encodedFixture('revoked'))],
        },
      }),
    });
    const resolver = new EasAnchorResolver({ ...config, fetch: fetchImpl as typeof fetch });
    const status = await resolver.checkRevocation(DID);
    expect(status.revoked).toBe(true);
    expect(status.reasonCommitment).toContain('eas:');
  });

  it('newer attestation supersedes older status', async () => {
    const fetchImpl = mockFetch({
      'http://mock/graphql': () => ({
        data: {
          attestations: [
            row(encodedFixture('active')),
            row(encodedFixture('revoked')),
          ],
        },
      }),
    });
    const resolver = new EasAnchorResolver({ ...config, fetch: fetchImpl as typeof fetch });
    const status = await resolver.checkRevocation(DID);
    expect(status.revoked).toBe(false);
  });

  it('finalized block subtracts confirmation depth', async () => {
    const fetchImpl = mockFetch({
      'http://mock/rpc': () => ({ jsonrpc: '2.0', id: 1, result: '0x112a880' }),
    });
    const resolver = new EasAnchorResolver({ ...config, fetch: fetchImpl as typeof fetch });
    expect(await resolver.currentFinalizedBlock()).toBe(18_000_000 - 64);
  });

  it('maps graphql failures to errors', async () => {
    const resolver = new EasAnchorResolver({
      ...config,
      graphqlUrl: 'http://mock/other',
      fetch: mockFetch({}) as typeof fetch,
    });
    await expect(resolver.checkRevocation(DID)).rejects.toThrow();
  });

  it('recognizes native EAS revocation without rewriting the signed data', async () => {
    const resolver = new EasAnchorResolver({ ...config, fetch: mockFetch({
      'http://mock/graphql': () => ({ data: { attestations: [row(encodedFixture('active'), '1770000000')] } }),
    }) as typeof fetch });
    expect((await resolver.checkRevocation(DID)).revoked).toBe(true);
    expect((await resolver.getRoot(DID, 'hmr'))?.status).toBe('revoked');
  });

  it('refuses untrusted attesters and mismatched subjects even if GraphQL returns them', async () => {
    for (const record of [
      { ...row(encodedFixture()), attester: '0x' + 'aa'.repeat(20) },
      row('0x' + Array.from(encodeAnchorData({ ...fixtureData(), did: 'did:oas:example:hmr:other' }), byte => byte.toString(16).padStart(2, '0')).join('')),
    ]) {
      const resolver = new EasAnchorResolver({ ...config, fetch: mockFetch({
        'http://mock/graphql': () => ({ data: { attestations: [record] } }),
      }) as typeof fetch });
      await expect(resolver.getRoot(DID, 'hmr')).rejects.toThrow();
      await expect(resolver.checkRevocation(DID)).rejects.toThrow();
    }
  });

  it('requires trust configuration and rejects invalid block/clock inputs', async () => {
    expect(() => new EasAnchorResolver({ ...config, trustedAttesters: [] })).toThrow();
    for (const confirmationDepth of [-1, NaN, 1.5]) {
      expect(() => new EasAnchorResolver({ ...config, confirmationDepth })).toThrow();
    }
    for (const result of ['garbage', '0x1garbage', '0x20000000000000']) {
      const resolver = new EasAnchorResolver({ ...config, fetch: mockFetch({
        'http://mock/rpc': () => ({ result }),
      }) as typeof fetch });
      await expect(resolver.currentFinalizedBlock()).rejects.toThrow();
    }
  });
});
