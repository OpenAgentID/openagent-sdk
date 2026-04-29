import { describe, it, expect } from 'vitest';
import {
  resolveAuthEndpoint,
  resolveProveEndpoint,
  discoveryDocumentSchema,
  WELL_KNOWN_PATH,
  AUTH_ENDPOINT_PATH,
  type DiscoveryDocument,
} from '../src/discovery.js';

describe('discovery', () => {
  const testDoc: DiscoveryDocument = {
    auth_endpoint: '/.well-known/openagent/auth',
    supported_versions: [1],
    server_did: 'did:oas:l1fe:service:api',
    required_conformance_level: 'L2',
  };

  describe('resolveAuthEndpoint', () => {
    it('trims trailing slash from base URL', () => {
      expect(resolveAuthEndpoint('https://api.example.com/', testDoc)).toBe(
        'https://api.example.com/.well-known/openagent/auth',
      );
    });

    it('handles base URL without trailing slash', () => {
      expect(resolveAuthEndpoint('https://api.example.com', testDoc)).toBe(
        'https://api.example.com/.well-known/openagent/auth',
      );
    });
  });

  describe('resolveProveEndpoint', () => {
    it('appends /prove to auth endpoint', () => {
      expect(resolveProveEndpoint('https://api.example.com', testDoc)).toBe(
        'https://api.example.com/.well-known/openagent/auth/prove',
      );
    });
  });

  describe('discoveryDocumentSchema', () => {
    it('validates a correct discovery document', () => {
      const result = discoveryDocumentSchema.safeParse(testDoc);
      expect(result.success).toBe(true);
    });

    it('rejects missing fields', () => {
      const result = discoveryDocumentSchema.safeParse({});
      expect(result.success).toBe(false);
    });

    it('rejects invalid conformance level', () => {
      const result = discoveryDocumentSchema.safeParse({
        ...testDoc,
        required_conformance_level: 'L3',
      });
      expect(result.success).toBe(false);
    });

    it('accepts all conformance levels', () => {
      for (const level of ['L0', 'L1', 'L2'] as const) {
        const result = discoveryDocumentSchema.safeParse({
          ...testDoc,
          required_conformance_level: level,
        });
        expect(result.success).toBe(true);
      }
    });
  });

  it('WELL_KNOWN_PATH is correct', () => {
    expect(WELL_KNOWN_PATH).toBe('/.well-known/openagent');
  });

  it('AUTH_ENDPOINT_PATH is correct', () => {
    expect(AUTH_ENDPOINT_PATH).toBe('/.well-known/openagent/auth');
  });
});
