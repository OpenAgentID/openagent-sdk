/**
 * AEGIS verification wrapper.
 *
 * Turns incoming HTTP requests into {@link AuthContext} objects that
 * downstream code can trust. Wraps `@aegis/sdk`'s challenge-response flow
 * and delegation policy engine.
 *
 * Framework-agnostic: takes the standard WHATWG `Request` so the same
 * verifier works in Node, Bun, Deno, browsers, and Cloudflare Workers.
 */

import { didSchema } from './config.js';
import { ErrorCode, VerificationError, wrapError } from './errors.js';
import type { Did } from './identity.js';

/** Sigil-backed lineage authority attached by an OAS verifier. */
export interface LineageAuthorityContext {
  /** DID whose privileged authority was verified. */
  readonly subject: Did;
  /** Backend/source identifier, normally `sigil_gal`. */
  readonly source: string;
  /** Finalized root DID for the verified path. */
  readonly root: Did;
  /** Reconstructed finalized path, ordered root to caller. */
  readonly path: readonly Did[];
  /** Sigil block height at which this authority was finalized. */
  readonly finalizedBlock: number;
  /** Authority path kind, e.g. `human_to_agent`. */
  readonly pathKind: string;
  /** Scopes proven by this lineage path. */
  readonly scopes: readonly string[];
  /** Generation/depth from root to subject. */
  readonly generation: number;
  /** Accepted root kind for this authority path. */
  readonly rootKind?: string;
  /** Optional org lineage root commitment for org-scoped authority. */
  readonly orgRootCommitment?: string;
  /** Optional expiry timestamp for the authority edge/path. */
  readonly expiresAt?: string;
}

/** A resolved, authenticated caller identity. */
export interface AuthContext {
  /** The calling agent's DID. */
  readonly did: Did;
  /** The root HMR/MHR this agent chains to. */
  readonly root: Did;
  /** Delegation chain from `root` → `did`. Ordered, length ≥ 1. */
  readonly lineage: readonly Did[];
  /** OAS + Sigil authority proof required for privileged access. */
  readonly lineageAuthority?: LineageAuthorityContext;
  /** Scopes granted to this caller for this request. */
  readonly scopes: readonly string[];
  /** Unix timestamp when the underlying assertion expires. */
  readonly expiresAt: number;
  /** Raw bearer the caller presented, for audit logging. */
  readonly presentedToken?: string;
  /** Arbitrary claims passed through from AEGIS. */
  readonly claims?: Readonly<Record<string, unknown>>;
}

/** Options for {@link VerificationClient.verifyRequest}. */
export interface VerifyRequestOptions {
  /** Require the caller to hold all of these scopes; otherwise throw. */
  requiredScopes?: readonly string[];
  /** Require the caller's lineage to include (or equal) this DID. */
  requiredAncestor?: Did;
  /** Require a Sigil-backed OAS lineage authority result. */
  requirePrivilegedAuthority?: boolean;
  /** Required authority path kind when privileged authority is required. */
  requiredAuthorityPath?: string;
  /** Extra clock skew tolerance (seconds). Default: 60. */
  clockSkewSeconds?: number;
}

/**
 * AEGIS verifier facade. Concrete implementation lives in `@aegis/sdk`.
 *
 * The OpenAgent SDK never decodes assertions itself — it delegates to
 * AEGIS for all verification, lineage walking, and policy evaluation.
 */
export interface VerificationClient {
  verifyRequest(req: Request, options?: VerifyRequestOptions): Promise<AuthContext>;

  /** Issue a short-lived challenge for challenge-response auth. */
  issueChallenge(): Promise<{ challenge: Uint8Array; challengeId: string }>;

  /** Verify a challenge response (typically from a worker/CLI flow). */
  verifyChallengeResponse(params: {
    challengeId: string;
    agentDid: Did;
    signatureBase64: string;
  }): Promise<AuthContext>;
}

/** Runtime hook that turns an authenticated context into OAS/Sigil authority. */
export interface PrivilegedAuthorityVerifier {
  verify(ctx: AuthContext, options: VerifyRequestOptions): Promise<LineageAuthorityContext>;
}

/**
 * Extract the bearer token from a `Request` without trusting it.
 *
 * Checks, in order: `Authorization: Bearer ...`, `X-OpenAgent-Token`,
 * and an `oa_token` query parameter. Returns `null` if absent.
 */
export function extractBearerToken(req: Request): string | null {
  const auth = req.headers.get('authorization');
  if (auth) {
    const match = /^Bearer\s+(.+)$/i.exec(auth.trim());
    if (match && match[1]) return match[1];
  }
  const custom = req.headers.get('x-openagent-token');
  if (custom) return custom.trim();
  try {
    const url = new URL(req.url);
    const q = url.searchParams.get('oa_token');
    if (q) return q.trim();
  } catch {
    // Non-absolute URL — skip query-param lookup.
  }
  return null;
}

/** Assert that `ctx` holds every scope in `required`. */
export function assertScopes(ctx: AuthContext, required: readonly string[]): void {
  const owned = new Set(ctx.scopes);
  const missing = required.filter((s) => !owned.has(s));
  if (missing.length > 0) {
    throw new VerificationError('Caller missing required scopes', {
      code: ErrorCode.VERIFICATION_FAILED,
      context: { missing, owned: [...owned] },
    });
  }
}

/** Assert that `ctx.lineage` contains `ancestor`. */
export function assertAncestor(ctx: AuthContext, ancestor: Did): void {
  if (!ctx.lineage.includes(ancestor) && ctx.root !== ancestor) {
    throw new VerificationError('Caller is not descended from required ancestor', {
      code: ErrorCode.IDENTITY_LINEAGE_INVALID,
      context: { required: ancestor, lineage: ctx.lineage },
    });
  }
}

/**
 * Narrow any unknown value into a {@link VerificationClient}, or throw.
 * Duck-typed for forward compatibility with `@aegis/sdk`.
 */
export function toVerificationClient(client: unknown): VerificationClient {
  if (
    client &&
    typeof client === 'object' &&
    typeof (client as VerificationClient).verifyRequest === 'function' &&
    typeof (client as VerificationClient).issueChallenge === 'function' &&
    typeof (client as VerificationClient).verifyChallengeResponse === 'function'
  ) {
    return client as VerificationClient;
  }
  throw wrapError(
    new Error('Provided client does not implement VerificationClient'),
    'Invalid verification client',
  );
}

/** Wraps any verifier and requires OAS/Sigil authority for privileged requests. */
export class PrivilegedAuthorityVerificationClient implements VerificationClient {
  constructor(
    private readonly inner: VerificationClient,
    private readonly authorityVerifier: PrivilegedAuthorityVerifier,
  ) {}

  async verifyRequest(req: Request, options?: VerifyRequestOptions): Promise<AuthContext> {
    const innerOptions = options?.requirePrivilegedAuthority
      ? { ...options, requirePrivilegedAuthority: false }
      : options;
    const ctx = await this.inner.verifyRequest(req, innerOptions);
    if (!options?.requirePrivilegedAuthority) {
      return ctx;
    }
    const lineageAuthority = await this.authorityVerifier.verify(ctx, options);
    assertAuthorityContext(ctx, lineageAuthority, options);
    return { ...ctx, lineageAuthority };
  }

  issueChallenge(): Promise<{ challenge: Uint8Array; challengeId: string }> {
    return this.inner.issueChallenge();
  }

  verifyChallengeResponse(params: {
    challengeId: string;
    agentDid: Did;
    signatureBase64: string;
  }): Promise<AuthContext> {
    return this.inner.verifyChallengeResponse(params);
  }
}

function assertAuthorityContext(
  ctx: AuthContext,
  authority: LineageAuthorityContext,
  options: VerifyRequestOptions,
): void {
  if (authority.subject !== ctx.did) {
    throw new VerificationError('Privileged authority subject mismatch', {
      code: ErrorCode.IDENTITY_LINEAGE_INVALID,
      context: { expected: ctx.did, actual: authority.subject },
    });
  }
  if (authority.root !== ctx.root) {
    throw new VerificationError('Privileged authority root mismatch', {
      code: ErrorCode.IDENTITY_LINEAGE_INVALID,
      context: { expected: ctx.root, actual: authority.root },
    });
  }
  if (options.requiredAuthorityPath && authority.pathKind !== options.requiredAuthorityPath) {
    throw new VerificationError('Privileged authority path mismatch', {
      code: ErrorCode.IDENTITY_LINEAGE_INVALID,
      context: { expected: options.requiredAuthorityPath, actual: authority.pathKind },
    });
  }
  const scopes = new Set(authority.scopes);
  for (const scope of options.requiredScopes ?? []) {
    if (!scopes.has(scope)) {
      throw new VerificationError('Privileged authority missing required scope', {
        code: ErrorCode.IDENTITY_LINEAGE_INVALID,
        context: { scope },
      });
    }
  }
}

/**
 * Stub verification client for tests and offline dev.
 *
 * Accepts any request that carries `Authorization: Bearer stub:<did>` and
 * returns a synthetic {@link AuthContext}. NOT a real verifier.
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
      throw new VerificationError('Privileged authority requires OAS + Sigil lineage', {
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
