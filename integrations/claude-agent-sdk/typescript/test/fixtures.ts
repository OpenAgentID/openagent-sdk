/**
 * Shared test fixtures for the plugin test suite.
 *
 * Mocks the parts of the Claude Agent SDK surface the plugin touches:
 * a session lifecycle that fires hooks in order, a fake tool registry,
 * and a fake skills loader.
 */

import type {
  AuditSink,
  CapabilityChecker,
  OpenAgentIdentity,
  ScopeDecision,
} from '../src/types.js';
import { StaticCapabilityChecker } from '../src/policy.js';
import type { OpenAgentPlugin } from '../src/plugin.js';

/** Build a deterministic fake identity. */
export function makeIdentity(opts?: Partial<OpenAgentIdentity>): OpenAgentIdentity {
  const signed: number[] = [];
  return {
    did: opts?.did ?? 'did:oas:test:agent:refactor-bot',
    kind: opts?.kind ?? 'agent',
    displayName: opts?.displayName ?? 'Refactor Bot',
    publicKey: opts?.publicKey ?? '00'.repeat(32),
    sign: opts?.sign ?? ((payload: Uint8Array) => {
      // Deterministic stub: sign = sha-like fold of payload bytes.
      const out = new Uint8Array(64);
      for (let i = 0; i < payload.length; i++) {
        const v = payload[i] ?? 0;
        out[i % 64] = ((out[i % 64] ?? 0) + v) & 0xff;
      }
      signed.push(payload.length);
      return out;
    }),
    ...(opts?.lineage !== undefined ? { lineage: opts.lineage } : {}),
  };
}

/** Capability checker that allows everything (test convenience). */
export class AllowAllChecker implements CapabilityChecker {
  check(scope: string): ScopeDecision {
    return { allowed: true, matchedScope: scope };
  }
}

/** Capability checker that denies everything (test convenience). */
export class DenyAllChecker implements CapabilityChecker {
  check(): ScopeDecision {
    return { allowed: false, reason: 'deny-all checker' };
  }
}

/** Build a static checker from an array of scopes. */
export function checker(scopes: string[]): CapabilityChecker {
  return new StaticCapabilityChecker(scopes);
}

/**
 * Minimal in-process Claude Agent SDK harness — just enough surface for
 * the plugin tests to drive realistic lifecycle sequences.
 */
export class MockClaudeAgentSession {
  private readonly sessionId: string;
  private readonly plugin: OpenAgentPlugin;

  constructor(plugin: OpenAgentPlugin, sessionId = 'sess_test_001') {
    this.plugin = plugin;
    this.sessionId = sessionId;
  }

  async start(): Promise<void> {
    await this.plugin.hooks.onSessionStart({ sessionId: this.sessionId });
  }

  async stop(): Promise<void> {
    await this.plugin.hooks.onSessionEnd();
  }

  async runTool(toolName: string, args: unknown, result: unknown): Promise<unknown> {
    const pre = await this.plugin.hooks.preToolUse({ toolName, args });
    if (!pre.allow) return { denied: true, reason: pre.reason };
    await this.plugin.hooks.postToolUse({ toolName, args, ok: true, result });
    return result;
  }

  async runSkill(skillName: string, args?: unknown): Promise<unknown> {
    const decision = await this.plugin.hooks.onSkillInvoke({ skillName, args });
    return decision;
  }

  async sendMessage(body: string): Promise<{ allow: true; signature?: string }> {
    return this.plugin.hooks.onMessage({ body, direction: 'out' });
  }

  async receiveMessage(body: string): Promise<{ allow: true; signature?: string }> {
    return this.plugin.hooks.onMessage({ body, direction: 'in' });
  }
}

/** Capture sink that buffers records (alternative to InMemoryAuditSink). */
export class CaptureSink implements AuditSink {
  public readonly records: import('../src/types.js').AuditRecord[] = [];
  append(record: import('../src/types.js').AuditRecord): void {
    this.records.push(record);
  }
}
