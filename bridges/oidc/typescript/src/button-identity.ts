/**
 * Decorative identity selection for the Continue as Agent button.
 *
 * Everything here is display-only: a random seed chooses which existing SDK
 * character appears inside the button's avatar slot. The seed is never sent to
 * an authorization server and never implies an authenticated agent.
 */
import type { CharacterAccessory, CharacterEyePlacement, CharacterFinish, CharacterShape, CharacterSkin } from '@openagentid/sdk/characters';

/** Catalog families whose art is tied to a holiday; the random pick avoids them. */
export const SEASONAL_FAMILIES: ReadonlySet<string> = new Set(['halloween', 'thanksgiving', 'christmas']);

/** Host-selected appearance for an already chosen (not necessarily authenticated) agent. */
export interface ContinueAsAgentAppearance {
  /** Existing agent or agent-instance DID whose character should be shown. Omit for a random decorative seed. */
  readonly did?: string;
  readonly skin?: CharacterSkin;
  readonly shape?: CharacterShape;
  readonly finish?: CharacterFinish;
  readonly eyePlacement?: CharacterEyePlacement;
  readonly accessories?: readonly CharacterAccessory[];
}

/** Fully resolved appearance that stays fixed for the life of one mounted button. */
export interface ResolvedButtonAppearance {
  readonly did: string;
  readonly skin: CharacterSkin;
  readonly shape?: CharacterShape;
  readonly finish?: CharacterFinish;
  readonly eyePlacement?: CharacterEyePlacement;
  readonly accessories?: readonly CharacterAccessory[];
  /** True when the DID was generated here for decoration rather than supplied by the host. */
  readonly decorative: boolean;
}

export type RandomBytes = (length: number) => Uint8Array;

const appearanceKeys: readonly string[] = ['did', 'skin', 'shape', 'finish', 'eyePlacement', 'accessories'];
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

/** Year-round families from the live SDK catalog, in catalog order. */
export function yearRoundFamilies<T extends { readonly id: string }>(catalog: readonly T[]): readonly T[] {
  const families = catalog.filter(family => !SEASONAL_FAMILIES.has(family.id));
  if (families.length === 0) throw new Error('Character catalog has no year-round family');
  return families;
}

/** Uniform pick that avoids modulo bias for the small catalog sizes involved. */
export function pickYearRoundFamily<T extends { readonly id: string }>(catalog: readonly T[], random: RandomBytes): T {
  const families = yearRoundFamilies(catalog);
  const limit = 65_536 - (65_536 % families.length);
  for (;;) {
    const bytes = random(2);
    if (!(bytes instanceof Uint8Array) || bytes.length !== 2) throw new TypeError('Family selection requires 2 random bytes');
    const value = bytes[0]! * 256 + bytes[1]!;
    if (value < limit) return families[value % families.length]!;
  }
}

/**
 * Resolve the host's appearance request once. A random decorative DID also
 * receives a random year-round family; a host-supplied DID keeps the SDK's
 * own defaults unless the host names a skin.
 */
export function resolveButtonAppearance<T extends { readonly id: string }>(
  appearance: ContinueAsAgentAppearance | undefined,
  catalog: readonly T[],
  random: RandomBytes,
): ResolvedButtonAppearance {
  if (appearance !== undefined && (!appearance || typeof appearance !== 'object' || Array.isArray(appearance) ||
      Object.keys(appearance).some(key => !appearanceKeys.includes(key)))) {
    throw new TypeError('Invalid Continue as Agent appearance');
  }
  const input = appearance ?? {};
  if (input.did !== undefined && (typeof input.did !== 'string' || input.did.length === 0)) throw new TypeError('Continue as Agent appearance did must be a non-empty string');
  const decorative = input.did === undefined;
  const did = decorative ? decorativeAgentDid(random) : input.did!;
  const skin = input.skin ?? (decorative ? (pickYearRoundFamily(catalog, random).id as CharacterSkin) : 'autos');
  return Object.freeze({ did, skin, decorative,
    ...(input.shape === undefined ? {} : { shape: input.shape }),
    ...(input.finish === undefined ? {} : { finish: input.finish }),
    ...(input.eyePlacement === undefined ? {} : { eyePlacement: input.eyePlacement }),
    ...(input.accessories === undefined ? {} : { accessories: input.accessories }) });
}
