import type { HookCallback, Options } from '@anthropic-ai/claude-agent-sdk';
import type { OpenAgentInstance } from '@openagentid/sdk';
import { openAgentPlugin, type OpenAgentPlugin, type OpenAgentPluginOptions } from './plugin.js';
import type { OpenAgentIdentity } from './types.js';
import { canonicalJson, hashHex } from './hash.js';

function scopeSegment(name: string): string {
  if (!name || name.length > 128) throw new TypeError('Tool and skill names must have 1–128 characters');
  if (/^[a-z0-9][a-z0-9_-]*$/.test(name) && !name.startsWith('encoded-')) return name;
  return `encoded-${Array.from(new TextEncoder().encode(name), byte => byte.toString(16).padStart(2, '0')).join('')}`;
}

/** SDK-valid, case-preserving scope encoding. Lowercase simple names stay readable. */
export function sdkToolScope(name: string): string { return `tools:invoke:${scopeSegment(name)}`; }
export function sdkSkillScope(name: string): string { return `skills:invoke:${scopeSegment(name)}`; }

/** Adapt a current SDK identity. Raw message signing is explicit: an identity
 * provider's signed challenge/JWT is NOT a signature over the message bytes.
 * The optional signer remains behind application custody and must belong to
 * the same public key. Without it, signing stays unavailable. */
export function createSdkAgentIdentity(agent: Pick<OpenAgentInstance, 'did' | 'document'>, signer?: {
  publicKey: string;
  sign(payload: Uint8Array): Promise<Uint8Array> | Uint8Array;
}): OpenAgentIdentity {
  if (signer && signer.publicKey !== agent.document.publicKeyMultibase) {
    throw new Error('Raw signer public key does not match the SDK identity');
  }
  return {
    did: agent.did,
    kind: agent.document.kind,
    publicKey: agent.document.publicKeyMultibase,
    ...(signer ? { sign: async (payload: Uint8Array) => {
      const signature = await signer.sign(payload);
      if (!(signature instanceof Uint8Array) || signature.length !== 64) throw new Error('Raw Ed25519 signer returned an invalid signature');
      return signature;
    } } : {}),
  };
}

/** Real Claude Agent SDK `options.hooks`. Allow returns no permission override,
 * preserving the harness's ordinary permission checks. Denials explicitly block.
 * A separate lifecycle/audit chain is maintained for each SDK session ID. */
export function createOpenAgentHooks(options: OpenAgentPluginOptions): {
  hooks: NonNullable<Options['hooks']>;
  inspectAudit(sessionId: string): ReturnType<OpenAgentPlugin['inspectAudit']>;
} {
  const sessions = new Map<string, OpenAgentPlugin>();
  const start = async (sessionId: string) => {
    if (sessions.has(sessionId)) throw new Error('OpenAgent session is already active');
    const plugin = openAgentPlugin({ ...options, denyMode: 'block', capabilities: {
      check(scope) {
        const canonical = scope.startsWith('tools:invoke:') ? sdkToolScope(scope.slice('tools:invoke:'.length))
          : scope.startsWith('skills:invoke:') ? sdkSkillScope(scope.slice('skills:invoke:'.length)) : scope;
        return options.capabilities.check(canonical);
      },
    } });
    sessions.set(sessionId, plugin);
    try { await plugin.hooks.onSessionStart({ sessionId }); }
    catch (error) { sessions.delete(sessionId); throw error; }
    return plugin;
  };
  const current = (sessionId: string) => {
    const plugin = sessions.get(sessionId);
    if (!plugin) throw new Error('OpenAgent session has not started');
    return plugin;
  };
  const deny = (reason: string) => ({
    hookSpecificOutput: { hookEventName: 'PreToolUse' as const, permissionDecision: 'deny' as const, permissionDecisionReason: reason },
  });
  const callback: HookCallback = async (input, _id, context) => {
    try {
      if (context.signal.aborted) throw new Error('Hook cancelled');
      switch (input.hook_event_name) {
        case 'SessionStart':
          await start(input.session_id);
          return {};
        case 'PreToolUse': {
          const plugin = current(input.session_id);
          const tool = await plugin.hooks.preToolUse({ toolName: input.tool_name, args: input.tool_input });
          if (!tool.allow) return deny(tool.reason ?? 'OpenAgent tool policy denied');
          if (input.tool_name === 'Skill') {
            const args = input.tool_input as { skill?: unknown } | null;
            if (typeof args?.skill !== 'string' || !args.skill) return deny('Skill name is required');
            const skill = await plugin.hooks.onSkillInvoke({ skillName: args.skill, args: input.tool_input });
            if (!skill.allow) return deny(skill.reason ?? 'OpenAgent skill policy denied');
          }
          return {};
        }
        case 'PostToolUse':
          await current(input.session_id).hooks.postToolUse({ toolName: input.tool_name, result: input.tool_response,
            ok: true, inputHash: hashHex(canonicalJson(input.tool_input)) });
          return {};
        case 'PostToolUseFailure':
          await current(input.session_id).hooks.postToolUse({ toolName: input.tool_name, result: null,
            ok: false, error: input.error, inputHash: hashHex(canonicalJson(input.tool_input)) });
          return {};
        case 'SessionEnd':
          await current(input.session_id).hooks.onSessionEnd();
          sessions.delete(input.session_id);
          return {};
        default: throw new Error('Unsupported OpenAgent hook event');
      }
    } catch (error) {
      // A thrown PreToolUse hook is not an authorization decision in every host.
      // Return the SDK's explicit deny shape on policy or authority failure.
      if (input.hook_event_name === 'PreToolUse') return deny(error instanceof Error ? error.message : 'OpenAgent authority unavailable');
      throw error;
    }
  };
  return {
    hooks: {
      SessionStart: [{ hooks: [callback] }],
      PreToolUse: [{ hooks: [callback] }],
      PostToolUse: [{ hooks: [callback] }],
      PostToolUseFailure: [{ hooks: [callback] }],
      SessionEnd: [{ hooks: [callback] }],
    },
    inspectAudit: sessionId => sessions.get(sessionId)?.inspectAudit() ?? [],
  };
}
