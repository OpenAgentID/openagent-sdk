/**
 * Test fakes for @openagent/mcp.
 *
 * Provides an in-memory {@link IdentityVerifier} and {@link Agent}
 * implementation suitable for unit and integration tests. Production
 * code should use the verifier from `@openagent/sdk` instead.
 */

import {
  Agent,
  IdentityVerifier,
  OpenAgentRequestIdentity,
  VerifiedIdentity,
} from '../src/types.js';

export interface FakeIdentityRecord {
  did: string;
  proof: string;
  scopes: ReadonlyArray<string>;
  claims?: Readonly<Record<string, unknown>>;
}

/**
 * Verifier that looks up records by `(did, proof)` pair. Anything not in
 * the table is rejected. Useful for asserting auth pipeline behaviour
 * deterministically.
 */
export class FakeVerifier implements IdentityVerifier {
  private readonly records: Map<string, FakeIdentityRecord>;
  public verifyCalls: Array<{
    identity: OpenAgentRequestIdentity;
    requiredScopes: ReadonlyArray<string>;
  }> = [];

  constructor(records: ReadonlyArray<FakeIdentityRecord>) {
    this.records = new Map(records.map((r) => [`${r.did}::${r.proof}`, r]));
  }

  async verify(
    identity: OpenAgentRequestIdentity,
    requiredScopes: ReadonlyArray<string>,
  ): Promise<VerifiedIdentity> {
    this.verifyCalls.push({ identity, requiredScopes });
    const record = this.records.get(`${identity.did}::${identity.proof}`);
    if (record === undefined) {
      throw new Error(`unknown identity ${identity.did}`);
    }
    return {
      did: record.did,
      scopes: record.scopes,
      auditId: `audit-${this.verifyCalls.length}`,
      claims: record.claims ?? {},
    };
  }
}

/**
 * Test agent that signs outbound requests with a fixed (did, proof)
 * pair. Both `agent.did` and `agent.signRequest()` use the same values
 * so client/server tests can round-trip the same identity.
 */
export class FakeAgent implements Agent {
  public readonly did: string;
  public readonly verifier: IdentityVerifier;
  public readonly proof: string;
  public signCalls: Array<{ toolName: string; audience?: string }> = [];

  constructor(options: {
    did: string;
    proof: string;
    verifier: IdentityVerifier;
  }) {
    this.did = options.did;
    this.proof = options.proof;
    this.verifier = options.verifier;
  }

  async signRequest(
    toolName: string,
    audience?: string,
  ): Promise<OpenAgentRequestIdentity> {
    const call: { toolName: string; audience?: string } = { toolName };
    if (audience !== undefined) {
      call.audience = audience;
    }
    this.signCalls.push(call);
    return {
      did: this.did,
      proof: this.proof,
      nonce: `nonce-${this.signCalls.length}`,
    };
  }
}

/**
 * Build a (verifier, agent) pair pre-loaded with a single happy-path
 * record. The proof string defaults to `'valid'`.
 */
export function buildHappyPath(
  did: string,
  scopes: ReadonlyArray<string>,
): { agent: FakeAgent; verifier: FakeVerifier } {
  const verifier = new FakeVerifier([{ did, proof: 'valid', scopes }]);
  const agent = new FakeAgent({ did, proof: 'valid', verifier });
  return { agent, verifier };
}
