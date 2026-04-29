import { describe, it, expect } from 'vitest';
import {
  resolveConfig,
  createAgentInputSchema,
  didSchema,
  scopeSchema,
  providerSchema,
  DEFAULT_NAMESPACE,
  DEFAULT_REQUEST_TIMEOUT_MS,
  silentLogger,
} from '../src/config.js';

describe('config', () => {
  describe('resolveConfig', () => {
    it('applies defaults with no arguments', () => {
      const resolved = resolveConfig();
      expect(resolved.namespace).toBe(DEFAULT_NAMESPACE);
      expect(resolved.requestTimeoutMs).toBe(DEFAULT_REQUEST_TIMEOUT_MS);
      expect(resolved.logger).toBe(silentLogger);
      expect(typeof resolved.fetch).toBe('function');
    });

    it('preserves user overrides', () => {
      const customFetch = ((): typeof fetch => globalThis.fetch.bind(globalThis))();
      const resolved = resolveConfig({
        namespace: 'test',
        requestTimeoutMs: 1234,
        fetch: customFetch,
      });
      expect(resolved.namespace).toBe('test');
      expect(resolved.requestTimeoutMs).toBe(1234);
      expect(resolved.fetch).toBe(customFetch);
    });
  });

  describe('didSchema', () => {
    it('accepts valid DIDs', () => {
      expect(didSchema.parse('did:oas:l1fe:hmr:alice')).toBe('did:oas:l1fe:hmr:alice');
      expect(didSchema.parse('did:oas:l1fe:agent:bot-123')).toBe('did:oas:l1fe:agent:bot-123');
      expect(didSchema.parse('did:oas:l1fe:enr:org_42')).toBe('did:oas:l1fe:enr:org_42');
    });

    it('rejects malformed DIDs', () => {
      expect(() => didSchema.parse('not-a-did')).toThrow();
      expect(() => didSchema.parse('did:web:example.com')).toThrow();
      expect(() => didSchema.parse('did:oas:l1fe:unknown:x')).toThrow();
    });
  });

  describe('scopeSchema', () => {
    it('accepts valid scopes', () => {
      expect(scopeSchema.parse('openai:chat:completions')).toBe('openai:chat:completions');
      expect(scopeSchema.parse('github:repo:read')).toBe('github:repo:read');
      expect(scopeSchema.parse('stripe:payments:*')).toBe('stripe:payments:*');
    });

    it('rejects malformed scopes', () => {
      expect(() => scopeSchema.parse('')).toThrow();
      expect(() => scopeSchema.parse('no-colon')).toThrow();
      expect(() => scopeSchema.parse('UPPER:CASE:BAD')).toThrow();
    });
  });

  describe('providerSchema', () => {
    it('accepts valid provider ids', () => {
      expect(providerSchema.parse('openai')).toBe('openai');
      expect(providerSchema.parse('github')).toBe('github');
      expect(providerSchema.parse('my-provider_1')).toBe('my-provider_1');
    });

    it('rejects malformed providers', () => {
      expect(() => providerSchema.parse('')).toThrow();
      expect(() => providerSchema.parse('Upper')).toThrow();
    });
  });

  describe('createAgentInputSchema', () => {
    it('accepts a valid input', () => {
      const parsed = createAgentInputSchema.parse({
        parent: 'did:oas:l1fe:hmr:alice',
        name: 'my-bot',
        scopes: ['openai:chat:completions'],
      });
      expect(parsed.name).toBe('my-bot');
      expect(parsed.scopes).toEqual(['openai:chat:completions']);
    });

    it('rejects missing scopes', () => {
      expect(() =>
        createAgentInputSchema.parse({
          parent: 'did:oas:l1fe:hmr:alice',
          name: 'my-bot',
          scopes: [],
        }),
      ).toThrow();
    });

    it('rejects unknown fields', () => {
      expect(() =>
        createAgentInputSchema.parse({
          parent: 'did:oas:l1fe:hmr:alice',
          name: 'my-bot',
          scopes: ['openai:chat:completions'],
          extra: 'field',
        }),
      ).toThrow();
    });
  });
});
