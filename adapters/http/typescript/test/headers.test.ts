import { describe, it, expect } from 'vitest';
import { extractOpenAgentToken, buildOpenAgentHeader, OPENAGENT_AUTH_SCHEME } from '../src/headers.js';

describe('headers', () => {
  describe('extractOpenAgentToken', () => {
    it('extracts token from valid OpenAgent header', () => {
      expect(extractOpenAgentToken('OpenAgent abc123')).toBe('abc123');
    });

    it('is case-insensitive for scheme', () => {
      expect(extractOpenAgentToken('openagent abc123')).toBe('abc123');
      expect(extractOpenAgentToken('Openagent abc123')).toBe('abc123');
    });

    it('trims whitespace', () => {
      expect(extractOpenAgentToken('OpenAgent  abc123')).toBe('abc123');
      expect(extractOpenAgentToken(' OpenAgent abc123 ')).toBe('abc123');
    });

    it('returns undefined for other schemes', () => {
      expect(extractOpenAgentToken('Bearer abc123')).toBeUndefined();
      expect(extractOpenAgentToken('OAS abc123')).toBeUndefined();
    });

    it('returns undefined for empty token', () => {
      expect(extractOpenAgentToken('OpenAgent ')).toBeUndefined();
      expect(extractOpenAgentToken('OpenAgent')).toBeUndefined();
    });

    it('returns undefined for empty string', () => {
      expect(extractOpenAgentToken('')).toBeUndefined();
    });
  });

  describe('buildOpenAgentHeader', () => {
    it('builds correct header format', () => {
      expect(buildOpenAgentHeader('tok123')).toBe('OpenAgent tok123');
    });

    it('uses the OPENAGENT_AUTH_SCHEME constant', () => {
      expect(buildOpenAgentHeader('x')).toContain(OPENAGENT_AUTH_SCHEME);
    });
  });
});
