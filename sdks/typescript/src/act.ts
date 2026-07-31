/**
 * ACT (Agent Capability Token) verification — the verify-first surface.
 *
 * Most consumers never mint an ACT; they verify one presented by a caller.
 * This module is the five-minute path for that:
 *
 * ```ts
 * import { act } from '@openagent/sdk';
 *
 * const claims = await act.verify(tokenBytes)
 *   .issuer('arsenal:broker:prod-1')
 *   .forAudience('my-service')
 *   .requireScope('tools:calendar:invoke')
 *   .trustedKeys([brokerPublicKey])
 *   .run();
 * ```
 *
 * Verification itself runs in the canonical Rust crate compiled to WASM
 * (`@openagent/crypto-wasm`): envelope decode, version/algorithm checks,
 * Ed25519 signature verification (before any claim check), temporal checks,
 * and issuer/audience/scope policy. TypeScript carries none of the rules, so
 * it cannot drift from the format the way three handwritten implementations
 * once did.
 */

import { ErrorCode, OpenAgentError, VerificationError } from './errors.js';

/** The claims of a verified ACT, as returned by the canonical verifier. */
export interface ActClaims {
  /** Token identifier. */
  jti: string;
  /** Subject: the OAS DID of the agent the token was issued to. */
  sub: string;
  /** Issuer: the broker instance that minted the token. */
  iss: string;
  /** Audiences this token is valid for. */
  aud: string[];
  /** Issued-at, seconds since the Unix epoch. */
  iat: number;
  /** Not-before, seconds since the Unix epoch. */
  nbf: number;
  /** Expiry, seconds since the Unix epoch. */
  exp: number;
  /** Tenant this token is scoped to. */
  tenant_id: string;
  /** Granted scopes (`service:resource:action`). */
  scope: string[];
  /** Proof-of-possession binding, when present. */
  cnf?: { key_fingerprint: string; alg: string };
  /** Onward delegation constraints, when present. */
  delegation?: { allow_delegation: boolean; max_depth: number };
  /** Issuer-defined extension claims (opaque to the format). */
  ext?: Record<string, unknown>;
}

/** Options accepted by the fluent verifier. */
export interface ActVerifyOptions {
  /** The trusted issuer string (required — see {@link ActVerifierBuilder.issuer}). */
  issuer?: string;
  /** The audience this verifier answers for (required). */
  audience?: string;
  /** Scopes the token must grant. Wildcards in the grant expand; literal in the request. */
  scopes?: string[];
  /** Raw 32-byte Ed25519 trusted public keys (required). */
  trustedKeys?: Uint8Array[];
  /** Symmetric clock-skew allowance in seconds. Default: 0. */
  leewaySeconds?: number;
  /** Pinned verification time (tests and decision replay). Default: system clock. */
  nowUnixSeconds?: number;
}

/** The crypto-wasm binding shape this module consumes. */
interface ActVerifyBinding {
  act_verify(
    token: Uint8Array,
    trustedKeys: Uint8Array,
    issuer: string,
    audience: string,
    scopes: string[],
    leewaySeconds: bigint,
    nowUnixSeconds: bigint,
  ): string;
}

let wasmBinding: ActVerifyBinding | undefined;

/**
 * Inject the crypto-wasm binding. Called by consumers at startup (and by
 * tests with a mock). The binding is the `@openagent/crypto-wasm` module's
 * nodejs or bundler build, already instantiated.
 */
export function setActCryptoBinding(binding: ActVerifyBinding): void {
  wasmBinding = binding;
}

function binding(): ActVerifyBinding {
  if (!wasmBinding) {
    throw new OpenAgentError(
      'ACT verification requires the @openagent/crypto-wasm binding: call ' +
        'setActCryptoBinding(await cryptoWasmInit()) at startup.',
      { code: ErrorCode.INVALID_CONFIG },
    );
  }
  return wasmBinding;
}

/** Fluent ACT verifier, built by {@link act.verify}. */
export class ActVerifierBuilder {
  private readonly token: Uint8Array;
  private opts: Required<Pick<ActVerifyOptions, 'scopes' | 'leewaySeconds' | 'nowUnixSeconds'>> &
    ActVerifyOptions;

  constructor(token: Uint8Array) {
    this.token = token;
    this.opts = { scopes: [], leewaySeconds: 0, nowUnixSeconds: 0 };
  }

  /** Bind the expected issuer. Required: a verifier that does not name the issuer accepts anyone's tokens. */
  issuer(iss: string): this {
    this.opts.issuer = iss;
    return this;
  }

  /** Bind the audience this verifier answers for. Required: a token meant for another service must not pass here. */
  forAudience(audience: string): this {
    this.opts.audience = audience;
    return this;
  }

  /** Require a scope the token must grant. Repeatable. */
  requireScope(scope: string): this {
    this.opts.scopes.push(scope);
    return this;
  }

  /** Require several scopes at once. */
  requireScopes(scopes: string[]): this {
    this.opts.scopes.push(...scopes);
    return this;
  }

  /** The trusted Ed25519 public keys (raw 32 bytes each). Required. */
  trustedKeys(keys: Uint8Array[]): this {
    this.opts.trustedKeys = keys;
    return this;
  }

  /** Allow `seconds` of clock skew on temporal checks. */
  withLeeway(seconds: number): this {
    this.opts.leewaySeconds = seconds;
    return this;
  }

  /** Pin the verification clock (tests, decision replay). */
  atTime(unixSeconds: number): this {
    this.opts.nowUnixSeconds = unixSeconds;
    return this;
  }

  /** Run verification. Resolves to the claims on success; throws {@link VerificationError} with the canonical reason on failure. */
  async run(): Promise<ActClaims> {
    const { issuer, audience, scopes, trustedKeys, leewaySeconds, nowUnixSeconds } = this.opts;

    if (!issuer) {
      throw new OpenAgentError('act.verify(): issuer() is required', {
        code: ErrorCode.INVALID_CONFIG,
      });
    }
    if (!audience) {
      throw new OpenAgentError('act.verify(): forAudience() is required', {
        code: ErrorCode.INVALID_CONFIG,
      });
    }
    if (!trustedKeys || trustedKeys.length === 0) {
      throw new OpenAgentError('act.verify(): trustedKeys() is required (at least one key)', {
        code: ErrorCode.INVALID_CONFIG,
      });
    }

    const concatenated = new Uint8Array(trustedKeys.length * 32);
    trustedKeys.forEach((k, i) => {
      if (k.length !== 32) {
        throw new OpenAgentError(`trusted key ${i} must be 32 bytes, got ${k.length}`, {
          code: ErrorCode.INVALID_CONFIG,
        });
      }
      concatenated.set(k, i * 32);
    });

    let json: string;
    try {
      json = binding().act_verify(
        this.token,
        concatenated,
        issuer,
        audience,
        scopes,
        BigInt(leewaySeconds),
        BigInt(nowUnixSeconds),
      );
    } catch (err) {
      // The canonical verifier's error message is the reason: signature,
      // expiry, audience, scope, version - distinct on purpose.
      throw new VerificationError(`ACT verification failed: ${(err as Error).message}`, {
        code: ErrorCode.VERIFICATION_FAILED,
        cause: err,
      });
    }

    return JSON.parse(json) as ActClaims;
  }
}

/** The ACT namespace. */
export const act = {
  /**
   * Begin verifying an ACT envelope (CBOR bytes).
   *
   * Chain the policy — `.issuer(...)`, `.forAudience(...)`, `.requireScope(...)`,
   * `.trustedKeys(...)` — then `await .run()`.
   */
  verify(token: Uint8Array): ActVerifierBuilder {
    return new ActVerifierBuilder(token);
  },

  /** Inject the crypto-wasm binding (see {@link setActCryptoBinding}). */
  setCryptoBinding: setActCryptoBinding,
} as const;
