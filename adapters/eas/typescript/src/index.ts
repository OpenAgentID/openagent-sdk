/**
 * @openagentid/anchor-eas — Ethereum Attestation Service adapter for the OAS
 * lineage anchor seam.
 *
 * # The split
 *
 * - **Resolution** (verifier path): EAS GraphQL over native fetch — the same
 *   model as `oas-anchor-eas` in Rust. Root anchors are attestations under
 *   the OAS lineage schema; the latest attestation for a subject wins; a
 *   `status: "revoked"` attestation or a revoked latest attestation means
 *   the subject is revoked.
 * - **Publishing** (issuer path): the maintained EAS SDK with a viem signer.
 *   Transaction construction — RLP, EIP-1559 fees, replacement semantics —
 *   belongs to the maintained SDK, not to hand-rolled code.
 *
 * # The anchoring model
 *
 * - Schema: {@link SCHEMA_STRING}, registered per-chain; its UID is config.
 * - Recipient: {@link didRecipient} — BLAKE3(did)[0..20], deterministic and
 *   normative, so "all attestations about this DID" is an exact-match query.
 * - Supersession: latest wins (newer attestation supersedes older status).
 * - Finality: `eth_blockNumber` minus the configured confirmation depth.
 */

import { blake3 } from '@noble/hashes/blake3';
import { EAS, NO_EXPIRATION, SchemaEncoder } from '@ethereum-attestation-service/eas-sdk';
import { z } from 'zod';

/** The OAS lineage-root attestation schema registered on EAS. */
export const SCHEMA_STRING =
  'string did,string kind,string status,string metadataCommitment,uint64 anchoredAtBlock';

/** The attestation's decoded data fields. */
export interface AnchorData {
  did: string;
  kind: string;
  status: string;
  metadataCommitment: string;
  anchoredAtBlock: bigint;
}

/** The anchor record an anchor backend reports for a root. */
export interface AnchorRecord {
  did: string;
  status: string;
  anchoredAtBlock: number;
  metadataCommitment: string;
}

/** The revocation status of a subject. */
export interface RevocationStatus {
  revoked: boolean;
  reasonCommitment?: string;
}

/** Derive the deterministic recipient address for a subject DID. */
export function didRecipient(did: string): string {
  const digest = blake3(new TextEncoder().encode(did));
  return '0x' + [...digest.slice(0, 20)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

const WORD = 32;

function padWord(value: bigint | number): string {
  return value.toString(16).padStart(WORD * 2, '0');
}

function encodeStringTail(value: string): string {
  const bytes = new TextEncoder().encode(value);
  const paddedLength = Math.ceil(bytes.length / WORD) * WORD;
  return padWord(bytes.length) + [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('') + '0'.repeat((paddedLength - bytes.length) * 2);
}

/** ABI-encode the anchor data (same layout as the Rust adapter). */
export function encodeAnchorData(data: AnchorData): Uint8Array {
  const strings = [data.did, data.kind, data.status, data.metadataCommitment];
  const headWords = 5;
  let cursor = headWords * WORD;
  const offsets: number[] = [];
  let tails = '';
  for (const value of strings) {
    offsets.push(cursor);
    const tail = encodeStringTail(value);
    tails += tail;
    cursor += tail.length / 2;
  }
  const head = offsets.map(padWord).join('') + padWord(data.anchoredAtBlock);
  return Uint8Array.from(Buffer.from(head + tails, 'hex'));
}

/** Configuration for the resolver. */
export interface EasResolverConfig {
  /** The OAS lineage schema UID on this chain. */
  schemaUid: string;
  /** EAS GraphQL endpoint. */
  graphqlUrl: string;
  /** Chain JSON-RPC endpoint (for eth_blockNumber). */
  rpcUrl: string;
  /** Confirmations subtracted from the head to define "finalized". Default: 64. */
  confirmationDepth?: number;
  /** Injected fetch (tests and non-Node runtimes). Default: globalThis.fetch. */
  fetch?: typeof fetch;
}

const attestationSchema = z.object({
  id: z.string(),
  data: z.string(),
  revocationTime: z.union([z.number(), z.string()]).optional(),
});

/** The EAS resolver: reads lineage authority from attestations. */
export class EasAnchorResolver {
  private readonly config: Required<Pick<EasResolverConfig, 'confirmationDepth'>> & EasResolverConfig;
  private readonly fetchImpl: typeof fetch;

  constructor(config: EasResolverConfig) {
    this.config = { confirmationDepth: 64, ...config };
    const f = config.fetch ?? globalThis.fetch;
    if (!f) throw new Error('EasAnchorResolver requires a fetch implementation');
    this.fetchImpl = f.bind(globalThis) as typeof fetch;
  }

  private async graphql(query: string, variables: Record<string, unknown>): Promise<unknown> {
    const resp = await this.fetchImpl(this.config.graphqlUrl, {
      method: 'POST',
      headers: { 'content-type': 'application/json', accept: 'application/json' },
      body: JSON.stringify({ query, variables }),
    });
    if (!resp.ok) {
      throw new Error(`graphql returned HTTP ${resp.status}`);
    }
    const result: unknown = await resp.json();
    const errors = (result as { errors?: unknown }).errors;
    if (errors) {
      throw new Error(`graphql errors: ${JSON.stringify(errors)}`);
    }
    return (result as { data: unknown }).data;
  }

  /** Latest attestation data rows about a subject DID, newest first. */
  private async attestationsFor(did: string): Promise<AnchorData[]> {
    const recipient = didRecipient(did);
    const query = `query ($schema: String!, $recipient: String!) {
  attestations(
    where: { schemaId: { equals: $schema }, recipient: { equals: $recipient } }
    orderBy: { time: desc }
    take: 4
  ) { id data revocationTime }
}`;
    const data = (await this.graphql(query, {
      schema: this.config.schemaUid,
      recipient,
    })) as { attestations?: unknown[] };
    const rows = (data.attestations ?? []).map((row) => attestationSchema.parse(row));
    const encoder = new SchemaEncoder(SCHEMA_STRING);
    return rows.map((row) => {
      const decoded = encoder.decodeData(row.data) as { name: string; value: { value: unknown } }[];
      const get = (name: string) => decoded.find((f) => f.name === name)?.value.value;
      return {
        did: String(get('did')),
        kind: String(get('kind')),
        status: String(get('status')),
        metadataCommitment: String(get('metadataCommitment')),
        anchoredAtBlock: BigInt(get('anchoredAtBlock') as bigint | number | string),
      };
    });
  }

  /** Revocation check (revocation-first per the guard's rules). */
  async checkRevocation(did: string): Promise<RevocationStatus> {
    const rows = await this.attestationsFor(did);
    const latest = rows[0];
    if (!latest) return { revoked: false };
    const revoked = latest.status === 'revoked';
    return {
      revoked,
      ...(revoked ? { reasonCommitment: `eas:${latest.metadataCommitment}` } : {}),
    };
  }

  /** Fetch the typed root anchor for a DID and kind, or undefined if absent. */
  async getRoot(did: string, kind: 'hmr' | 'mhr' | 'enr'): Promise<AnchorRecord | undefined> {
    const rows = await this.attestationsFor(did);
    const latest = rows[0];
    if (!latest || latest.kind !== kind) return undefined;
    return {
      did: latest.did,
      status: latest.status,
      anchoredAtBlock: Number(latest.anchoredAtBlock),
      metadataCommitment: latest.metadataCommitment,
    };
  }

  /** `eth_blockNumber` minus the confirmation depth. */
  async currentFinalizedBlock(): Promise<number> {
    const resp = await this.fetchImpl(this.config.rpcUrl, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'eth_blockNumber', params: [] }),
    });
    if (!resp.ok) throw new Error(`rpc returned HTTP ${resp.status}`);
    const result: unknown = await resp.json();
    const hex = (result as { result?: string }).result;
    if (!hex) throw new Error('rpc response missing block number');
    return Math.max(0, parseInt(hex, 16) - this.config.confirmationDepth);
  }
}

/** Signer shape the publisher needs: a viem-compatible account plus provider. */
export interface EasPublisherConfig {
  /** The OAS lineage schema UID on this chain. */
  schemaUid: string;
  /** The EAS contract address on this chain. */
  easContractAddress: string;
  /** A viem-compatible signer (any object the EAS SDK accepts). */
  signer: unknown;
}

/** The EAS publisher: writes anchors as attestations via the maintained SDK. */
export class EasAnchorPublisher {
  private readonly eas: EAS;
  private readonly schemaUid: string;

  constructor(config: EasPublisherConfig) {
    this.eas = new EAS(config.easContractAddress);
    this.eas.connect(config.signer as Parameters<EAS['connect']>[0]);
    this.schemaUid = config.schemaUid;
  }

  /** Publish a lineage root anchor as an attestation. Returns the attestation UID. */
  async publishAnchor(data: AnchorData): Promise<string> {
    const encoder = new SchemaEncoder(SCHEMA_STRING);
    const encoded = encoder.encodeData([
      { name: 'did', value: data.did, type: 'string' },
      { name: 'kind', value: data.kind, type: 'string' },
      { name: 'status', value: data.status, type: 'string' },
      { name: 'metadataCommitment', value: data.metadataCommitment, type: 'string' },
      { name: 'anchoredAtBlock', value: data.anchoredAtBlock, type: 'uint64' },
    ]);
    const tx = await this.eas.attest({
      schema: this.schemaUid,
      data: {
        recipient: didRecipient(data.did),
        expirationTime: NO_EXPIRATION,
        revocable: true,
        data: encoded,
      },
    });
    return tx.wait();
  }

  /** Revoke an attestation by UID. */
  async revoke(uid: string): Promise<void> {
    const tx = await this.eas.revoke({ schema: this.schemaUid, data: { uid } });
    await tx.wait();
  }
}
