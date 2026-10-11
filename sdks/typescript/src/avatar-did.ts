/** Display-only identity parsing. This module never admits or verifies a principal. */
import { didSchema } from './config.js';

// IAM enrollment already assigns this literal format using ulid::Ulid::new().
// Canonical ULIDs have 128 bits: their first base32 digit is at most seven.
const iamInstanceDid = /^did:oas:agent-instance:[0-7][0-9A-HJKMNP-TV-Z]{25}(?![\s\S])/;

export interface AvatarDidParts {
  readonly namespace: string;
  readonly kind: string;
  readonly identifier: string;
  /** An IAM ULID is an opaque identifier, never a multibase key. */
  readonly opaque: boolean;
}

/** Preserve every identifier literally; compatibility here applies only to pixels. */
export function parseAvatarDid(did: string): AvatarDidParts {
  if (typeof did !== 'string' || did.length > 512 || /\s/.test(did)) {
    throw new TypeError('Invalid avatar DID');
  }
  if (iamInstanceDid.test(did)) {
    return { namespace: '', kind: 'agent:instance', identifier: did.slice('did:oas:agent-instance:'.length), opaque: true };
  }
  didSchema.parse(did);
  const fields = did.split(':');
  const legacy = fields[1] === 'l1fe';
  return {
    namespace: legacy ? 'l1fe' : fields[2]!,
    kind: fields.slice(legacy ? 2 : 3, -1).join(':'),
    identifier: fields.at(-1)!,
    opaque: false,
  };
}

/** Supported agent avatar input, not registration, authorization or identity proof. */
export function isAgentAvatarDid(value: unknown): value is string {
  if (typeof value !== 'string') return false;
  try {
    const { kind } = parseAvatarDid(value);
    return kind === 'agent' || kind === 'agent:instance';
  } catch { return false; }
}
