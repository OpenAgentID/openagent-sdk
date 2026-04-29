import { describe, it, expect } from 'vitest';
import {
  challengeMessageSchema,
  establishedMessageSchema,
  TransportError,
} from '../src/transport.js';

describe('transport schemas', () => {
  describe('challengeMessageSchema', () => {
    it('validates a correct challenge', () => {
      const result = challengeMessageSchema.safeParse({
        session_id: 'sess-1',
        nonce: 'abc123',
        responder_did: 'did:oas:l1fe:service:test',
        responder_ephemeral_public_key: 'AAAA==',
        expires_at: 1234567890,
      });
      expect(result.success).toBe(true);
    });

    it('accepts optional required_conformance_level', () => {
      const result = challengeMessageSchema.safeParse({
        session_id: 'sess-1',
        nonce: 'abc123',
        responder_did: 'did:oas:l1fe:service:test',
        responder_ephemeral_public_key: 'AAAA==',
        required_conformance_level: 'L2',
        expires_at: 1234567890,
      });
      expect(result.success).toBe(true);
    });

    it('rejects missing fields', () => {
      const result = challengeMessageSchema.safeParse({ session_id: 'sess-1' });
      expect(result.success).toBe(false);
    });
  });

  describe('establishedMessageSchema', () => {
    it('validates a correct established message', () => {
      const result = establishedMessageSchema.safeParse({
        session_id: 'sess-1',
        expires_at: 1234567890,
      });
      expect(result.success).toBe(true);
    });

    it('accepts optional capabilities', () => {
      const result = establishedMessageSchema.safeParse({
        session_id: 'sess-1',
        expires_at: 1234567890,
        capabilities: ['read', 'write'],
      });
      expect(result.success).toBe(true);
    });
  });

  describe('TransportError', () => {
    it('carries status code', () => {
      const err = new TransportError('test', 401, 'body');
      expect(err.statusCode).toBe(401);
      expect(err.responseBody).toBe('body');
      expect(err.message).toBe('test');
      expect(err instanceof Error).toBe(true);
    });
  });
});
