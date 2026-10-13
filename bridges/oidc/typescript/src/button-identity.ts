/**
 * Decorative seed selection for the Continue as Agent button.
 *
 * The seed only varies the timing of the eyes' blinking and glances through
 * the SDK animator. It is never sent to an authorization server and never
 * implies an authenticated agent.
 */

/** Host-selected seed for an already chosen (not necessarily authenticated) agent. */
export interface ContinueAsAgentAppearance {
  /** Existing agent or agent-instance DID whose eye timing should be used. Omit for a random decorative seed. */
  readonly did?: string;
}

/** Fully resolved seed that stays fixed for the life of one mounted button. */
export interface ResolvedButtonAppearance {
  readonly did: string;
  /** True when the DID was generated here for decoration rather than supplied by the host. */
  readonly decorative: boolean;
}

export type RandomBytes = (length: number) => Uint8Array;

const appearanceKeys: readonly string[] = ['did'];
const decorativeDid = /^did:oas:openagent:agent:decorative-[0-9a-f]{16}$/;

/** A random agent-kind DID that the SDK generator accepts; it identifies nothing. */
export function decorativeAgentDid(random: RandomBytes): string {
  const bytes = random(8);
  if (!(bytes instanceof Uint8Array) || bytes.length !== 8) throw new TypeError('Decorative seed requires 8 random bytes');
  return 'did:oas:openagent:agent:decorative-' + Array.from(bytes, value => value.toString(16).padStart(2, '0')).join('');
}

export function isDecorativeAgentDid(value: string): boolean {
  return decorativeDid.test(value);
}

/** Resolve the host's seed request once: a supplied DID is kept literally, otherwise a decorative one is drawn. */
export function resolveButtonAppearance(appearance: ContinueAsAgentAppearance | undefined, random: RandomBytes): ResolvedButtonAppearance {
  if (appearance !== undefined && (!appearance || typeof appearance !== 'object' || Array.isArray(appearance) ||
      Object.keys(appearance).some(key => !appearanceKeys.includes(key)))) {
    throw new TypeError('Invalid Continue as Agent appearance');
  }
  const did = appearance?.did;
  if (did !== undefined && (typeof did !== 'string' || did.length === 0)) throw new TypeError('Continue as Agent appearance did must be a non-empty string');
  return Object.freeze(did === undefined ? { did: decorativeAgentDid(random), decorative: true } : { did, decorative: false });
}
