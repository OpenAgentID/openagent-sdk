import type * as Oas from '@openagentid/oas-sdk';
import { base64, base64urlnopad } from '@scure/base';
import { createAgentInputSchema, didSchema, scopeSchema, type CreateAgentInput } from '../config.js';
import { parseIdentityDocument, type IdentityDocument, type IdentityProvider } from '../identity.js';

/** Receiver-owned registration. Scopes are an explicit local authorization,
 * not a field invented on an OAS document or proof of a public registration. */
export interface OasIdentityRegistration {
  readonly document: Oas.OasDocument;
  readonly scopes: readonly string[];
  readonly keypair?: Oas.OasKeyPair;
}

/** Applications own durable storage and signer custody. put must atomically
 * refuse an existing DID rather than overwrite its document/key registration. */
export interface OasIdentityStore extends Oas.DocumentProvider {
  get(did: string): Promise<OasIdentityRegistration | undefined>;
  put(identity: OasIdentityRegistration): Promise<void>;
}

/** Identity facade plus an explicit raw-byte signing operation. The raw signer
 * signs only the provided bytes; signChallenge separately signs a JWT envelope. */
export interface OasIdentityProvider extends IdentityProvider {
  signBytes(did: string, payload: Uint8Array): Promise<Uint8Array>;
}

/** Adapt published OAS creation, real signatures and verified portable lineage
 * to the SDK identity facade. Scope authorization and key custody stay explicit.
 * Portable lineage does not establish an authenticated LifeID owner/session. */
export function createOasIdentityProvider(options: {
  oas: typeof Oas;
  store: OasIdentityStore;
  /** Required local policy; the returned grant must exactly cover requested scopes. */
  authorizeCreation(input: CreateAgentInput, parent: OasIdentityRegistration): Promise<readonly string[]>;
  /** Service audience for the signed challenge assertion, not a caller claim. */
  audience: string;
}): OasIdentityProvider {
  if (!options.audience || typeof options.authorizeCreation !== 'function') {
    throw new TypeError('OAS integration requires a challenge audience and creation authority');
  }
  const { oas, store } = options;
  async function registration(did: string): Promise<OasIdentityRegistration> {
    didSchema.parse(did);
    const entry = await store.get(did);
    if (!entry || entry.document.id !== did || oas.isRevoked(entry.document)) throw new Error('OAS identity is missing or revoked');
    const proof = entry.document.proof;
    const proofKey = proof && entry.document.verificationMethod.find(method => method.id === proof.verificationMethod);
    if (!proof || !proofKey || proofKey.controller !== did || !entry.document.assertionMethod.includes(proofKey.id) ||
        !await oas.verifyDocumentProof(oas.documentWithoutProof(entry.document), proof,
          oas.multibaseDecode(proofKey.publicKeyMultibase))) throw new Error('Invalid OAS document signature');
    await oas.verifyChain(entry.document, store);
    return entry;
  }
  function authenticationKey(entry: OasIdentityRegistration): string {
    const keys = entry.document.verificationMethod.filter(method =>
      entry.document.authentication.includes(method.id) && method.controller === entry.document.id &&
      method.id.startsWith(`${entry.document.id}#`));
    if (keys.length !== 1) throw new Error('OAS identity requires one unambiguous authentication key');
    return keys[0]!.publicKeyMultibase;
  }
  function project(entry: OasIdentityRegistration): IdentityDocument {
    const doc = entry.document;
    return parseIdentityDocument({ did: doc.id, parent: doc.lineage?.creatorDid ?? doc.id,
      publicKeyMultibase: authenticationKey(entry), kind: doc.kind,
      scopes: entry.scopes.map(scope => scopeSchema.parse(scope)), createdAt: doc.proof?.created,
      metadata: { ...doc.metadata } });
  }
  function signer(entry: OasIdentityRegistration): Oas.OasKeyPair {
    if (!entry.keypair || entry.keypair.publicKeyMultibase() !== authenticationKey(entry)) {
      throw new Error('OAS private signer is unavailable or does not match the authentication key');
    }
    return entry.keypair;
  }
  return {
    async createAgentIdentity(input) {
      const request = createAgentInputSchema.parse(input);
      const parent = await registration(request.parent);
      const scopes = [...await options.authorizeCreation(request, parent)].map(scope => scopeSchema.parse(scope));
      if (request.scopes.some(scope => !scopes.includes(scope)) || scopes.some(scope => !request.scopes.includes(scope))) {
        throw new Error('Creation authority must grant exactly the requested scopes');
      }
      const identifier = globalThis.crypto.randomUUID();
      const created = new Date().toISOString();
      const derived = await oas.deriveChild(signer(parent), parent.document, request.namespace ?? 'openagent',
        oas.EntityKind.Agent, identifier, `/agent-${identifier}`, created);
      const namedDocument: Oas.OasDocument = { ...derived.document, name: request.name,
        metadata: { ...derived.document.metadata, ...request.metadata } };
      const proof = await oas.generateDocumentProof(oas.documentWithoutProof(namedDocument), derived.keypair,
        derived.document.proof!.verificationMethod, created);
      const entry: OasIdentityRegistration = { document: { ...namedDocument, proof }, keypair: derived.keypair, scopes };
      await store.put(entry);
      return project(await registration(derived.document.id));
    },
    async resolve(did) { return project(await registration(did)); },
    async publicKey(did) { return authenticationKey(await registration(did)); },
    async signBytes(did, payload) {
      if (!(payload instanceof Uint8Array) || payload.length === 0 || payload.length > 1_048_576) {
        throw new TypeError('A nonempty payload of at most 1048576 bytes is required');
      }
      return signer(await registration(did)).sign(payload);
    },
    async signChallenge(did, challenge) {
      if (!(challenge instanceof Uint8Array) || challenge.length === 0 || challenge.length > 16_384) {
        throw new TypeError('A nonempty challenge of at most 16384 bytes is required');
      }
      const entry = await registration(did);
      const key = signer(entry);
      const issuedAt = Math.floor(Date.now() / 1000);
      const expiresAt = issuedAt + 60;
      const encode = (value: unknown) => base64urlnopad.encode(new TextEncoder().encode(JSON.stringify(value)));
      const header = encode({ alg: 'EdDSA', typ: 'oaid-challenge+jwt', kid: entry.document.verificationMethod.find(method => method.publicKeyMultibase === key.publicKeyMultibase() && entry.document.authentication.includes(method.id))!.id });
      const payload = encode({ iss: did, sub: did, aud: options.audience,
        challenge: base64urlnopad.encode(challenge), iat: issuedAt, exp: expiresAt });
      const signature = await key.sign(new TextEncoder().encode(`${header}.${payload}`));
      return { token: `${header}.${payload}.${base64urlnopad.encode(signature)}`, signature: base64.encode(signature),
        signer: did, issuedAt, expiresAt };
    },
  };
}

