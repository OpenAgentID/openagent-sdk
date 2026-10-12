import { createHash, randomUUID } from 'node:crypto';
import type { OpenAgentWorkspace, LocalChallenge } from '@openagentid/sdk/local';
import type { VerifiedAgentIdentity } from '@openagentid/sdk';
import type { Agent } from './types.js';

export interface McpChallengeRequest {
  did: string;
  toolName: string;
  args?: Record<string, unknown>;
}

function canonical(value: unknown): string {
  if (value === null || typeof value !== 'object') {
    const text = JSON.stringify(value);
    if (text === undefined) throw new TypeError('MCP arguments must be JSON values');
    return text;
  }
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonical((value as Record<string, unknown>)[key])}`).join(',')}}`;
}

function digest(toolName: string, args: unknown): string {
  return createHash('sha256').update(canonical({ toolName, args: args ?? {} })).digest('hex');
}

/** Receiver-owned, single-process challenge bindings. Keep this instance alive
 * for the server's lifetime. Restarts fail outstanding requests closed. The SDK
 * persists trust, replay consumption and revocation in the receiver workspace. */
export function createWorkspaceMcpServer(options: {
  workspace: OpenAgentWorkspace;
  did: string;
  /** Scopes come from receiver policy, never from request metadata. */
  authorize(identity: VerifiedAgentIdentity): Promise<readonly string[]> | readonly string[];
  maxPendingChallenges?: number;
}): {
  agent: Pick<Agent, 'did' | 'verifier'>;
  issueChallenge(request: McpChallengeRequest): Promise<LocalChallenge>;
} {
  const pending = new Map<string, { did: string; digest: string; expiresAt: number }>();
  let issuing = 0;
  const max = options.maxPendingChallenges ?? 1000;
  if (!Number.isSafeInteger(max) || max < 1) throw new TypeError('Invalid pending challenge limit');
  return {
    async issueChallenge(request) {
      for (const [nonce, value] of pending) if (value.expiresAt <= Date.now() / 1000) pending.delete(nonce);
      if (pending.size + issuing >= max) throw new Error('MCP challenge capacity reached');
      const binding = digest(request.toolName, request.args);
      issuing += 1;
      try {
        const challenge = await options.workspace.issueChallenge(request.did);
        pending.set(challenge.nonce, { did: request.did, digest: binding, expiresAt: challenge.expiresAt });
        return challenge;
      } finally { issuing -= 1; }
    },
    agent: {
      did: options.did,
      verifier: {
        async verify(envelope, _scopes, request) {
          const nonce = envelope.nonce;
          const binding = nonce ? pending.get(nonce) : undefined;
          if (!binding || !nonce || !request || binding.did !== envelope.did ||
              binding.expiresAt <= Date.now() / 1000 || binding.digest !== digest(request.toolName, request.args)) {
            throw new Error('MCP challenge does not match this caller and tool request');
          }
          // Claim before awaiting verification to exclude parallel use in this process.
          pending.delete(nonce);
          const proof = JSON.parse(envelope.proof) as Parameters<OpenAgentWorkspace['verify']>[0];
          const identity = await options.workspace.verify(proof, { nonce });
          if (identity.did !== envelope.did) throw new Error('MCP identity DID mismatch');
          const scopes = [...await options.authorize(identity)];
          if (!scopes.every(scope => typeof scope === 'string')) throw new TypeError('Invalid authorized scopes');
          return { did: identity.did, scopes, auditId: randomUUID(), claims: { identity } };
        },
      },
    },
  };
}

/** Adapt a current SDK signer. Obtain challenges over the receiver's trusted
 * transport; reject an audience change before signing. */
export function createWorkspaceMcpClient(options: {
  workspace: OpenAgentWorkspace;
  did: string;
  audience: string;
  issueChallenge(request: McpChallengeRequest): Promise<LocalChallenge>;
}): Pick<Agent, 'did' | 'signRequest'> {
  return {
    did: options.did,
    async signRequest(toolName, audience, args) {
      if (audience !== undefined && audience !== options.audience) throw new Error('MCP audience mismatch');
      const challenge = await options.issueChallenge({ did: options.did, toolName, ...(args ? { args } : {}) });
      if (challenge.audience !== options.audience || challenge.expiresAt <= Date.now() / 1000) throw new Error('Invalid MCP receiver challenge');
      const proof = await options.workspace.prove(options.did, { audience: options.audience, nonce: challenge.nonce });
      return { did: options.did, proof: JSON.stringify(proof), nonce: challenge.nonce };
    },
  };
}
