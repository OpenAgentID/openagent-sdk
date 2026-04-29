import { describe, it, expect } from 'vitest';
import { AuthenticatedSession } from '../src/session.js';

describe('AuthenticatedSession', () => {
  it('resolves URLs correctly', () => {
    const session = new AuthenticatedSession({
      baseUrl: 'https://api.example.com/',
      sessionId: 'sess-1',
      peerDid: 'did:oas:l1fe:agent:test',
      sessionToken: 'tok-123',
      expiresAt: Math.floor(Date.now() / 1000) + 300,
    });

    expect(session.getBaseUrl()).toBe('https://api.example.com');
    expect(session.getSessionId()).toBe('sess-1');
    expect(session.getPeerDid()).toBe('did:oas:l1fe:agent:test');
  });

  it('reports not expired for future expiry', () => {
    const session = new AuthenticatedSession({
      baseUrl: 'https://api.example.com',
      sessionId: 'sess-1',
      peerDid: 'did:oas:test',
      sessionToken: 'tok',
      expiresAt: Math.floor(Date.now() / 1000) + 300,
    });
    expect(session.isExpired()).toBe(false);
  });

  it('reports expired for past expiry', () => {
    const session = new AuthenticatedSession({
      baseUrl: 'https://api.example.com',
      sessionId: 'sess-1',
      peerDid: 'did:oas:test',
      sessionToken: 'tok',
      expiresAt: Math.floor(Date.now() / 1000) - 10,
    });
    expect(session.isExpired()).toBe(true);
  });
});
