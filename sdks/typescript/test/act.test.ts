import { describe, it, expect, beforeEach } from 'vitest';
import { act, setActCryptoBinding } from '../src/act.js';
import { OpenAgentError, VerificationError } from '../src/errors.js';

// A mock of the crypto-wasm binding: captures the call and returns canned
// claims. The REAL binding is exercised against the canonical crate by the
// crypto-wasm smoke test in CI; these tests pin the builder's behavior.
interface RecordedCall {
  token: Uint8Array;
  keys: Uint8Array;
  issuer: string;
  audience: string;
  scopes: string[];
  leeway: bigint;
  now: bigint;
}

const fixtureClaims = {
  jti: 'act-1',
  sub: 'did:oas:l1fe:agent:bot',
  iss: 'arsenal:broker:test-1',
  aud: ['omerta'],
  iat: 1800000000,
  nbf: 1800000000,
  exp: 1800000600,
  tenant_id: 'tenant-a',
  scope: ['tools:calendar:invoke'],
};

let recorded: RecordedCall | undefined;
let bindingError: Error | undefined;

function installMock(): void {
  recorded = undefined;
  bindingError = undefined;
  setActCryptoBinding({
    act_verify(token, keys, issuer, audience, scopes, leeway, now) {
      recorded = { token, keys, issuer, audience, scopes, leeway, now };
      if (bindingError) throw bindingError;
      return JSON.stringify(fixtureClaims);
    },
  });
}

const key32 = (fill: number) => new Uint8Array(32).fill(fill);

describe('act.verify() builder', () => {
  beforeEach(installMock);

  it('verifies with full policy and forwards every binding', async () => {
    const token = new Uint8Array([1, 2, 3]);
    const claims = await act
      .verify(token)
      .issuer('arsenal:broker:test-1')
      .forAudience('omerta')
      .requireScope('tools:calendar:invoke')
      .requireScopes(['tools:email:send'])
      .trustedKeys([key32(1), key32(2)])
      .withLeeway(30)
      .atTime(1800000300)
      .run();

    expect(claims.sub).toBe('did:oas:l1fe:agent:bot');
    expect(recorded?.issuer).toBe('arsenal:broker:test-1');
    expect(recorded?.audience).toBe('omerta');
    expect(recorded?.scopes).toEqual(['tools:calendar:invoke', 'tools:email:send']);
    expect(recorded?.keys.length).toBe(64);
    expect(recorded?.leeway).toBe(30n);
    expect(recorded?.now).toBe(1800000300n);
  });

  it('requires issuer', async () => {
    await expect(
      act.verify(new Uint8Array([1])).forAudience('omerta').trustedKeys([key32(1)]).run(),
    ).rejects.toBeInstanceOf(OpenAgentError);
  });

  it('requires audience', async () => {
    await expect(
      act.verify(new Uint8Array([1])).issuer('iss').trustedKeys([key32(1)]).run(),
    ).rejects.toBeInstanceOf(OpenAgentError);
  });

  it('requires at least one trusted key', async () => {
    await expect(
      act.verify(new Uint8Array([1])).issuer('iss').forAudience('aud').trustedKeys([]).run(),
    ).rejects.toBeInstanceOf(OpenAgentError);
  });

  it('rejects a key that is not 32 bytes', async () => {
    await expect(
      act
        .verify(new Uint8Array([1]))
        .issuer('iss')
        .forAudience('aud')
        .trustedKeys([new Uint8Array(16)])
        .run(),
    ).rejects.toBeInstanceOf(OpenAgentError);
  });

  it('maps binding failures to VerificationError with the canonical reason', async () => {
    bindingError = new Error('signature invalid against all 1 trusted keys');
    await expect(
      act.verify(new Uint8Array([1])).issuer('iss').forAudience('aud').trustedKeys([key32(1)]).run(),
    ).rejects.toThrow(VerificationError);
  });

  it('fails closed when no binding was injected', async () => {
    setActCryptoBinding(undefined as never);
    await expect(
      act.verify(new Uint8Array([1])).issuer('iss').forAudience('aud').trustedKeys([key32(1)]).run(),
    ).rejects.toBeInstanceOf(OpenAgentError);
  });
});
