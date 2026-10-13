/**
 * @openagentid/sdk-testing — in-memory backends for `@openagentid/sdk`.
 *
 * # When to use this package
 *
 * In unit tests and offline development only. These backends fabricate
 * identity documents, accept `stub:` bearer tokens, and echo deterministic
 * proxy URLs. **Nothing here is cryptographically sound.** They used to live
 * inside `@openagentid/sdk` as silent fallbacks when no protocol client was
 * configured - which meant a production deployment with a missing peer would
 * sign and "verify" with fake crypto without anyone choosing that. The
 * production SDK now fails closed instead, and the fakes live here, behind
 * an explicit import that cannot sneak into a dependency graph unnoticed.
 *
 * ```ts
 * import { OpenAgent } from '@openagentid/sdk';
 * import { createTestingConfig } from '@openagentid/sdk-testing';
 *
 * OpenAgent.configure(createTestingConfig());
 * const agent = await OpenAgent.createAgent({ parent, name, scopes });
 * ```
 */

import {
  assertAncestor,
  assertScopes,
  didSchema,
  ErrorCode,
  extractBearerToken,
  IdentityError,
  VerificationError,
  type ArsenalClient,
  type AuthContext,
  type CreateAgentInput,
  type Did,
  type IdentityDocument,
  type IdentityProvider,
  type OpenAgentConfig,
  type SignedAssertion,
  type VerificationClient,
  type VerifyRequestOptions,
} from '@openagentid/sdk';

/**
 * In-memory identity provider for tests.
 *
 * Generates deterministic-looking DIDs and public keys. NOT cryptographically
 * sound for production - `signChallenge` returns a tagged base64 blob, not an
 * Ed25519 signature.
 */
export class StubIdentityProvider implements IdentityProvider {
  private readonly store = new Map<Did, IdentityDocument>();
  private readonly namespace: string;

  constructor(namespace = 'openagent') {
    this.namespace = namespace;
  }

  async createAgentIdentity(input: CreateAgentInput): Promise<IdentityDocument> {
    const id = `stub-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
    const did: Did = `did:oas:${input.namespace ?? this.namespace}:agent:${id}`;
    const doc: IdentityDocument = {
      did,
      parent: input.parent,
      publicKeyMultibase: `z${id}`,
      kind: 'agent',
      scopes: [...input.scopes],
      createdAt: new Date().toISOString(),
      ...(input.metadata ? { metadata: input.metadata } : {}),
    };
    this.store.set(did, doc);
    return doc;
  }

  async resolve(did: Did): Promise<IdentityDocument> {
    const doc = this.store.get(did);
    if (!doc) {
      throw new IdentityError(`Unknown DID: ${did}`, {
        code: ErrorCode.IDENTITY_RESOLVE_FAILED,
        context: { did },
      });
    }
    return doc;
  }

  async signChallenge(did: Did, challenge: Uint8Array): Promise<SignedAssertion> {
    if (!this.store.has(did)) {
      throw new IdentityError(`Unknown DID: ${did}`, {
        code: ErrorCode.IDENTITY_SIGNATURE_INVALID,
        context: { did },
      });
    }
    const now = Math.floor(Date.now() / 1000);
    // Stub signature: tag + challenge as base64. NOT real crypto.
    const sig = toBase64(new Uint8Array([0xaa, 0xbb, ...challenge]));
    return {
      token: `stub.${toBase64Url(new TextEncoder().encode(did))}.${sig}`,
      signature: sig,
      signer: did,
      issuedAt: now,
      expiresAt: now + 300,
    };
  }

  async publicKey(did: Did): Promise<string> {
    const doc = await this.resolve(did);
    return doc.publicKeyMultibase;
  }
}

/**
 * In-memory Arsenal client for tests. Echoes a deterministic proxy URL per
 * provider without minting any credential.
 */
export function stubArsenalClient(): ArsenalClient {
  return {
    async requestCredential({ agentDid, provider }) {
      const now = Math.floor(Date.now() / 1000);
      return {
        provider,
        proxyUrl: `https://stub.arsenal.invalid/proxy?agent=${encodeURIComponent(agentDid)}&provider=${provider}`,
        expiresAt: now + 300,
      };
    },
    async release() {
      // no-op
    },
  };
}

/**
 * In-memory verification client for tests.
 *
 * Accepts any request carrying `Authorization: OpenAgent stub:<did>` or
 * `Authorization: Bearer stub:<did>` and returns a synthetic
 * {@link AuthContext}. NOT a real verifier: any well-formed stub token passes.
 */
export class StubVerificationClient implements VerificationClient {
  private readonly challenges = new Map<string, Uint8Array>();

  async verifyRequest(req: Request, options?: VerifyRequestOptions): Promise<AuthContext> {
    const token = extractBearerToken(req);
    if (!token) {
      throw new VerificationError('No bearer token present', {
        code: ErrorCode.AUTH_REQUIRED,
      });
    }
    if (!token.startsWith('stub:')) {
      throw new VerificationError('Stub verifier only accepts stub: tokens', {
        code: ErrorCode.VERIFICATION_FAILED,
      });
    }
    const did = token.slice('stub:'.length);
    didSchema.parse(did);
    const ctx: AuthContext = {
      did,
      root: did,
      lineage: [did],
      scopes: [],
      expiresAt: Math.floor(Date.now() / 1000) + 300,
      presentedToken: token,
    };
    if (options?.requiredScopes?.length) {
      assertScopes(ctx, options.requiredScopes);
    }
    if (options?.requiredAncestor) {
      assertAncestor(ctx, options.requiredAncestor);
    }
    if (options?.requirePrivilegedAuthority) {
      throw new VerificationError('Privileged authority requires a verified authority lineage', {
        code: ErrorCode.IDENTITY_LINEAGE_INVALID,
        context: {
          requiredAuthorityPath: options.requiredAuthorityPath,
          verifier: 'stub',
        },
      });
    }
    return ctx;
  }

  async issueChallenge(): Promise<{ challenge: Uint8Array; challengeId: string }> {
    const challenge = new Uint8Array(32);
    if (typeof globalThis.crypto?.getRandomValues === 'function') {
      globalThis.crypto.getRandomValues(challenge);
    }
    const challengeId = Math.random().toString(36).slice(2);
    this.challenges.set(challengeId, challenge);
    return { challenge, challengeId };
  }

  async verifyChallengeResponse(params: {
    challengeId: string;
    agentDid: Did;
    signatureBase64: string;
  }): Promise<AuthContext> {
    if (!this.challenges.has(params.challengeId)) {
      throw new VerificationError('Unknown challenge', {
        code: ErrorCode.AUTH_CHALLENGE_INVALID,
      });
    }
    this.challenges.delete(params.challengeId);
    return {
      did: params.agentDid,
      root: params.agentDid,
      lineage: [params.agentDid],
      scopes: [],
      expiresAt: Math.floor(Date.now() / 1000) + 300,
    };
  }
}

/**
 * An {@link OpenAgentConfig} with all three in-memory backends wired in.
 *
 * The production SDK requires real protocol clients and fails closed when one
 * is missing; tests opt into the fakes explicitly through this helper.
 */
export function createTestingConfig(
  overrides: Partial<OpenAgentConfig> = {},
): OpenAgentConfig {
  return {
    ...overrides,
    clients: {
      identity: new StubIdentityProvider(overrides.namespace),
      credentials: stubArsenalClient(),
      verification: new StubVerificationClient(),
      ...overrides.clients,
    },
  };
}

function toBase64(bytes: Uint8Array): string {
  if (typeof Buffer !== 'undefined') {
    return Buffer.from(bytes).toString('base64');
  }
  let s = '';
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s);
}

function toBase64Url(bytes: Uint8Array): string {
  return toBase64(bytes).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '');
}
