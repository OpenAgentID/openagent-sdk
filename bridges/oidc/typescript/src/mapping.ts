/**
 * JWT claim to OAS DID mapping and scope translation.
 *
 * Maps between OIDC/OAuth2 (issuers, subjects, scopes) and
 * OAS/Arsenal (DIDs, lineage, capability scopes).
 */

import { createHash, createPrivateKey, createPublicKey } from 'node:crypto';
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
  return createHash('sha256').update(JSON.stringify([issuer, hmrValue])).digest('hex');
}

/** Real identity custody/derivation hook. The host must authorize the human owner. */
export type IdentityDeriver = (
  namespace: string, claims: ValidatedClaims, agentName: string,
) => DerivedAgent;

export function validateDerivedAgent(agent: DerivedAgent): DerivedAgent {
  try {
    if (!/^did:(?:oas:[a-z0-9_-]+|l1fe):agent:[A-Za-z0-9._%-]+$/.test(agent.agentDid)
      || !agent.lineageProof || !agent.parentHmrDid || !Number.isSafeInteger(agent.lineageDepth)
      || agent.lineageDepth < 1 || agent.agentKeypair.publicKey.length !== 32
      || ![32, 64].includes(agent.agentKeypair.privateKey.length)) {
      throw new Error('Missing owned identity, key material or signed lineage');
    }
    const seed = agent.agentKeypair.privateKey.slice(0, 32);
    const privateKey = createPrivateKey({
      key: Buffer.concat([Buffer.from('302e020100300506032b657004220420', 'hex'), Buffer.from(seed)]),
      format: 'der', type: 'pkcs8',
    });
    const publicKey = createPublicKey(privateKey).export({ format: 'der', type: 'spki' }).subarray(-32);
    if (!publicKey.equals(Buffer.from(agent.agentKeypair.publicKey))) throw new Error('Ed25519 keypair mismatch');
    return agent;
  } catch {
    throw OidcBridgeError.mapping('Identity derivation must return real matching Ed25519 keys and owned lineage');
  }
}

/** No fallback identity is issued when real custody/derivation is unconfigured. */
export function deriveAgentFromClaims(
  namespace: string, claims: ValidatedClaims, agentName: string, derive?: IdentityDeriver,
): DerivedAgent {
  if (!namespace || !agentName) throw OidcBridgeError.mapping('Namespace and agent name are required');
  if (!derive) throw OidcBridgeError.mapping('Configure an identity derivation callback backed by real key custody');
  return validateDerivedAgent(derive(namespace, claims, agentName));
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
