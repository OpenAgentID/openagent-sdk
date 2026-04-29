import { describe, it, expect } from 'vitest';
import { extractOasToken, buildOasHeader, OAS_AUTH_SCHEME } from '../src/headers.js';

describe('headers', () => {
  describe('extractOasToken', () => {
    it('extracts token from valid OAS header', () => {
      expect(extractOasToken('OAS abc123')).toBe('abc123');
    });

    it('is case-insensitive for scheme', () => {
      expect(extractOasToken('oas abc123')).toBe('abc123');
      expect(extractOasToken('Oas abc123')).toBe('abc123');
    });

    it('trims whitespace', () => {
      expect(extractOasToken('OAS  abc123')).toBe('abc123');
      expect(extractOasToken(' OAS abc123 ')).toBe('abc123');
    });

    it('returns undefined for Bearer scheme', () => {
      expect(extractOasToken('Bearer abc123')).toBeUndefined();
    });

    it('returns undefined for empty token', () => {
      expect(extractOasToken('OAS ')).toBeUndefined();
      expect(extractOasToken('OAS')).toBeUndefined();
    });

    it('returns undefined for empty string', () => {
      expect(extractOasToken('')).toBeUndefined();
    });
  });

  describe('buildOasHeader', () => {
    it('builds correct header format', () => {
      expect(buildOasHeader('tok123')).toBe('OAS tok123');
    });

    it('uses the OAS_AUTH_SCHEME constant', () => {
      expect(buildOasHeader('x')).toContain(OAS_AUTH_SCHEME);
    });
  });
});
