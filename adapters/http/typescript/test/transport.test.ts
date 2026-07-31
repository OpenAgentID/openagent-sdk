import { describe, it, expect } from 'vitest';
import {
  canonicalChallengeBytes,
  CHALLENGE_TYPE,
  identityChallengeSchema,
  identityVerifiedSchema,
  TransportError,
  type IdentityChallenge,
} from '../src/transport.js';

function validChallenge(): IdentityChallenge {
  return {
    type: CHALLENGE_TYPE,
    nonce: 'a3f1c9' + '0'.repeat(58),
    timestamp: '2026-03-21T12:00:00Z',
    origin: 'https://api.example.com',
  };
}

describe('identityChallengeSchema (Section 4 field constraints)', () => {
  it('validates a correct challenge', () => {
    expect(identityChallengeSchema.safeParse(validChallenge()).success).toBe(true);
  });

  it('rejects the wrong type literal', () => {
    const result = identityChallengeSchema.safeParse({
      ...validChallenge(),
      type: 'openagent-challenge-v0',
    });
    expect(result.success).toBe(false);
  });

  it('rejects a short nonce', () => {
    const result = identityChallengeSchema.safeParse({ ...validChallenge(), nonce: 'abcd' });
    expect(result.success).toBe(false);
  });

  it('rejects an uppercase nonce', () => {
    const result = identityChallengeSchema.safeParse({
      ...validChallenge(),
      nonce: 'A3F1C9' + '0'.repeat(58),
    });
    expect(result.success).toBe(false);
  });

  it('rejects fractional seconds', () => {
    const result = identityChallengeSchema.safeParse({
      ...validChallenge(),
      timestamp: '2026-03-21T12:00:00.5Z',
    });
    expect(result.success).toBe(false);
  });

  it('rejects offset timezones', () => {
    const result = identityChallengeSchema.safeParse({
      ...validChallenge(),
      timestamp: '2026-03-21T12:00:00+00:00',
    });
    expect(result.success).toBe(false);
  });

  it('rejects an empty realm when present', () => {
    const result = identityChallengeSchema.safeParse({ ...validChallenge(), realm: '' });
    expect(result.success).toBe(false);
  });

  it('accepts a realm when present', () => {
    const result = identityChallengeSchema.safeParse({ ...validChallenge(), realm: 'admin' });
    expect(result.success).toBe(true);
  });
});

describe('identityVerifiedSchema', () => {
  it('validates a correct verified message', () => {
    const result = identityVerifiedSchema.safeParse({
      did: 'did:oas:l1fe:agent:bot',
      trust_tier: 'anonymous',
      session_token: 'tok',
      session_expires: '2026-03-21T12:15:00Z',
    });
    expect(result.success).toBe(true);
  });
});

describe('canonicalChallengeBytes (JCS, RFC 8785)', () => {
  it('sorts members lexicographically with no whitespace', () => {
    const bytes = canonicalChallengeBytes(validChallenge());
    const text = new TextDecoder().decode(bytes);
    expect(text).toBe(
      '{"nonce":"a3f1c9' +
        '0'.repeat(58) +
        '","origin":"https://api.example.com","timestamp":"2026-03-21T12:00:00Z","type":"openagent-challenge-v1"}',
    );
  });

  it('places realm in sorted position when present', () => {
    const bytes = canonicalChallengeBytes({ ...validChallenge(), realm: 'admin' });
    const text = new TextDecoder().decode(bytes);
    const realmAt = text.indexOf('"realm"');
    const timestampAt = text.indexOf('"timestamp"');
    const typeAt = text.indexOf('"type"');
    expect(realmAt).toBeGreaterThan(-1);
    // JCS order: nonce < origin < realm < timestamp < type.
    expect(realmAt).toBeLessThan(timestampAt);
    expect(timestampAt).toBeLessThan(typeAt);
  });

  it('is deterministic', () => {
    const a = canonicalChallengeBytes(validChallenge());
    const b = canonicalChallengeBytes(validChallenge());
    expect(a).toEqual(b);
  });
});

describe('TransportError', () => {
  it('carries status code', () => {
    const err = new TransportError('test', 401, 'body');
    expect(err.statusCode).toBe(401);
    expect(err.responseBody).toBe('body');
    expect(err instanceof Error).toBe(true);
  });
});
