/**
 * JWT claim to OAS DID mapping and scope translation.
 *
 * Maps between OIDC/OAuth2 (issuers, subjects, scopes) and
 * OAS/Arsenal (DIDs, lineage, capability scopes).
 */

import type { ValidatedClaims } from './jwt.js';
import { OidcBridgeError } from './errors.js';

/** Result of deriving an agent DID from a human JWT. */
export interface DerivedAgent {
  /** Agent DID (did:oas:<ns>:agent:<name>). */
  readonly agentDid: string;
  /** Agent keypair (Ed25519 public + private key bytes). */
  readonly agentKeypair: {
    readonly publicKey: Uint8Array;
    readonly privateKey: Uint8Array;
  };
  /** Lineage proof (JSON structure). */
  readonly lineageProof: Record<string, unknown> | null;
  /** Parent HMR DID. */
  readonly parentHmrDid: string;
  /** Lineage depth (0 for HMR, 1 for direct child). */
  readonly lineageDepth: number;
}

/**
 * Deterministic identifier for an HMR derived from an OIDC subject.
 *
 * Uses issuer + subject to produce a stable, collision-resistant
 * identifier that doesn't leak PII.
 */
export function hmrIdentifierFromClaims(issuer: string, hmrValue: string): string {
  const input = `${issuer}:${hmrValue}`;
  // Use a simple deterministic hash for the identifier.
  // In production, the OAS SDK handles proper key derivation.
  const hash = simpleHash(input);
  return hash;
}

/**
 * Derive an agent DID from validated OIDC claims.
 *
 * This is the core of Flow 1: Human JWT -> Agent DID.
 *
 * In a production deployment, this would use the OAS SDK's `create_hmr`
 * and `derive_child` functions (available via the WASM crypto module).
 * Here we produce the correct DID format and structure, with placeholder
 * keypairs that would be replaced by the real OAS SDK integration.
 */
export function deriveAgentFromClaims(
  namespace: string,
  claims: ValidatedClaims,
  agentName: string,
): DerivedAgent {
  if (!agentName) {
    throw OidcBridgeError.mapping('Agent name cannot be empty');
  }

  if (!namespace) {
    throw OidcBridgeError.mapping('Namespace cannot be empty');
  }

  const hmrId = hmrIdentifierFromClaims(claims.issuer, claims.hmrValue);
  const parentHmrDid = `did:oas:${namespace}:hmr:${hmrId}`;
  const agentDid = `did:oas:${namespace}:agent:${agentName}`;

  // In production, these would come from the OAS SDK's Ed25519 key derivation.
  // The WASM crypto module provides byte-identical results to the Rust implementation.
  const dummyPublicKey = new Uint8Array(32);
  const dummyPrivateKey = new Uint8Array(64);

  // Seed the dummy keys deterministically from the DID (for testing parity).
  const agentHash = simpleHash(agentDid);
  for (let i = 0; i < 32 && i < agentHash.length; i++) {
    dummyPublicKey[i] = agentHash.charCodeAt(i);
  }

  return {
    agentDid,
    agentKeypair: {
      publicKey: dummyPublicKey,
      privateKey: dummyPrivateKey,
    },
    lineageProof: {
      parent: parentHmrDid,
      depth: 1,
      derivationPath: `agent/${agentName}`,
    },
    parentHmrDid,
    lineageDepth: 1,
  };
}

/**
 * Map OIDC scopes/roles to Arsenal capability scopes.
 *
 * Unmapped scopes are passed through as-is.
 */
export function mapScopes(
  oidcScopes: readonly string[],
  scopeMapping: Readonly<Record<string, readonly string[]>>,
): string[] {
  const result: string[] = [];
  const seen = new Set<string>();

  for (const scope of oidcScopes) {
    const mapped = scopeMapping[scope];
    if (mapped) {
      for (const s of mapped) {
        if (!seen.has(s)) {
          seen.add(s);
          result.push(s);
        }
      }
    } else {
      if (!seen.has(scope)) {
        seen.add(scope);
        result.push(scope);
      }
    }
  }

  return result;
}

/** Simple deterministic string hash (not cryptographic -- for identifiers only). */
function simpleHash(input: string): string {
  let h1 = 0xdeadbeef;
  let h2 = 0x41c6ce57;
  for (let i = 0; i < input.length; i++) {
    const ch = input.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507);
  h1 ^= Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507);
  h2 ^= Math.imul(h1 ^ (h1 >>> 13), 3266489909);

  const combined = (h2 >>> 0) * 4294967296 + (h1 >>> 0);
  return combined.toString(36);
}
