import { describe, expect, it } from 'vitest';
import {
  AuditChain,
  ConsoleAuditSink,
  FanOutAuditSink,
  GENESIS_PREV_HASH,
  InMemoryAuditSink,
  hashRecord,
  verifyChain,
} from '../src/audit.js';
import { canonicalJson, hashHex } from '../src/hash.js';

describe('AuditChain', () => {
  it('chains records via prevHash', async () => {
    const sink = new InMemoryAuditSink();
    const chain = new AuditChain({
      sessionId: 's1',
      agentDid: 'did:oas:test:agent:x',
      sink,
    });
    await chain.append({ kind: 'session.start', outcome: 'ok' });
    await chain.append({ kind: 'tool.preflight', name: 'bash', outcome: 'allow' });
    await chain.append({ kind: 'tool.complete', name: 'bash', outcome: 'ok' });

    expect(sink.records).toHaveLength(3);
    expect(sink.records[0]?.prevHash).toBe(GENESIS_PREV_HASH);
    expect(sink.records[1]?.prevHash).toBe(sink.records[0]?.hash);
    expect(sink.records[2]?.prevHash).toBe(sink.records[1]?.hash);

    const v = verifyChain(sink.records);
    expect(v.valid).toBe(true);
  });

  it('detects byte-level tampering', async () => {
    const sink = new InMemoryAuditSink();
    const chain = new AuditChain({
      sessionId: 's1',
      agentDid: 'did:oas:test:agent:x',
      sink,
    });
    await chain.append({ kind: 'session.start', outcome: 'ok' });
    await chain.append({ kind: 'tool.preflight', name: 'bash', outcome: 'allow' });

    const target = sink.records[1];
    if (target) target.name = 'rm-rf';
    expect(verifyChain(sink.records).valid).toBe(false);
  });

  it('does not throw when sink throws', async () => {
    const angrySink = {
      append() {
        throw new Error('disk on fire');
      },
    };
    const chain = new AuditChain({
      sessionId: 's',
      agentDid: 'did:oas:test:x',
      sink: angrySink,
    });
    await expect(chain.append({ kind: 'session.start', outcome: 'ok' })).resolves
      .toBeDefined();
  });

  it('hashRecord excludes the hash field', () => {
    const r = {
      seq: 1,
      timestamp: '2026-01-01T00:00:00.000Z',
      sessionId: 's',
      agentDid: 'did:oas:test:x',
      kind: 'session.start' as const,
      outcome: 'ok' as const,
      prevHash: GENESIS_PREV_HASH,
      hash: 'placeholder',
    };
    const h1 = hashRecord(r);
    r.hash = 'something else entirely';
    const h2 = hashRecord(r);
    expect(h1).toBe(h2);
  });
});

describe('FanOutAuditSink', () => {
  it('dispatches to every sink', async () => {
    const a = new InMemoryAuditSink();
    const b = new InMemoryAuditSink();
    const fan = new FanOutAuditSink([a, b]);
    await fan.append({
      seq: 1,
      timestamp: 'now',
      sessionId: 's',
      agentDid: 'd',
      kind: 'session.start',
      outcome: 'ok',
      prevHash: GENESIS_PREV_HASH,
      hash: 'h',
    });
    expect(a.records).toHaveLength(1);
    expect(b.records).toHaveLength(1);
  });

  it('isolates sink failures', async () => {
    const good = new InMemoryAuditSink();
    const bad = {
      append() {
        throw new Error('nope');
      },
    };
    const fan = new FanOutAuditSink([bad, good]);
    await expect(
      fan.append({
        seq: 1,
        timestamp: 'now',
        sessionId: 's',
        agentDid: 'd',
        kind: 'session.start',
        outcome: 'ok',
        prevHash: GENESIS_PREV_HASH,
        hash: 'h',
      }),
    ).resolves.toBeUndefined();
    expect(good.records).toHaveLength(1);
  });
});

describe('hash utilities', () => {
  it('canonicalJson sorts keys deterministically', () => {
    const a = canonicalJson({ b: 1, a: 2, c: { y: 1, x: 2 } });
    const b = canonicalJson({ a: 2, c: { x: 2, y: 1 }, b: 1 });
    expect(a).toBe(b);
  });

  it('hashHex returns lowercase hex', () => {
    const h = hashHex('hello');
    expect(h).toMatch(/^[0-9a-f]+$/);
    expect(h.length).toBeGreaterThan(0);
  });

  it('hashHex is stable', () => {
    expect(hashHex('hello')).toBe(hashHex('hello'));
    expect(hashHex('hello')).not.toBe(hashHex('world'));
  });
});

describe('ConsoleAuditSink', () => {
  it('writes a JSON line for each record', () => {
    const sink = new ConsoleAuditSink();
    const lines: string[] = [];
    const orig = console.log;
    console.log = (msg: string) => lines.push(msg);
    try {
      sink.append({
        seq: 1,
        timestamp: 'now',
        sessionId: 's',
        agentDid: 'd',
        kind: 'session.start',
        outcome: 'ok',
        prevHash: GENESIS_PREV_HASH,
        hash: 'h',
      });
    } finally {
      console.log = orig;
    }
    expect(lines).toHaveLength(1);
    expect(lines[0]).toContain('openagent_audit');
  });
});
