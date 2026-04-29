import { describe, it, expect } from 'vitest';
import { OidcBridge } from '../src/bridge.js';

describe('OidcBridge', () => {
  describe('constructor', () => {
    it('accepts single-provider shorthand', () => {
      const bridge = new OidcBridge({
        issuer: 'https://dev-123.okta.com/oauth2/default',
        audience: 'my-app',
      });
      expect(bridge.getConfig().providers).toHaveLength(1);
      expect(bridge.getConfig().namespace).toBe('openagent');
    });

    it('accepts full multi-provider config', () => {
      const bridge = new OidcBridge({
        providers: [
          { name: 'okta', issuer: 'https://dev-123.okta.com/oauth2/default' },
          { name: 'google', issuer: 'https://accounts.google.com' },
        ],
      });
      expect(bridge.getConfig().providers).toHaveLength(2);
    });

    it('rejects empty providers', () => {
      expect(() => new OidcBridge({ providers: [] })).toThrow();
    });

    it('applies default namespace and ttl', () => {
      const bridge = new OidcBridge({
        issuer: 'https://example.com',
      });
      expect(bridge.getConfig().namespace).toBe('openagent');
      expect(bridge.getConfig().jwtTtlSeconds).toBe(3600);
    });

    it('allows namespace override via shorthand', () => {
      const bridge = new OidcBridge({
        issuer: 'https://example.com',
        namespace: 'custom-ns',
      });
      expect(bridge.getConfig().namespace).toBe('custom-ns');
    });

    it('allows ttl override', () => {
      const bridge = new OidcBridge({
        issuer: 'https://example.com',
        jwtTtlSeconds: 1800,
      });
      expect(bridge.getConfig().jwtTtlSeconds).toBe(1800);
    });
  });

  describe('getConfig', () => {
    it('returns the resolved config', () => {
      const bridge = new OidcBridge({
        issuer: 'https://example.com',
        audience: 'my-app',
        scopeMapping: { admin: ['*:*:*'] },
      });
      const config = bridge.getConfig();
      expect(config.providers[0].audience).toBe('my-app');
      expect(config.providers[0].scopeMapping).toEqual({ admin: ['*:*:*'] });
    });
  });
});
