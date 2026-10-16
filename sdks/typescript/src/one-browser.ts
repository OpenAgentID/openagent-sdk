/**
 * The live One runtime alone, self-contained for a browser: `mountOne` and the palette helpers, within the One
 * app's script budget of 16 KB gzipped (scripts/check-size.mjs). Render still heads and DID default colours where
 * a DID is at hand, on the server or in a bundle, with `@openagentid/sdk/one`.
 */
export { mountOne } from './one.js';
export type { OneMountOptions, OneAppearanceUpdate, OnePlayer, OnePlayOptions } from './one.js';
export { getOneColors, nextOneColor, ONE_KINDS } from './character-one.js';
export type { OneColor, OneKind, OneHeadColor, OneColorHolder, OneColorDescription, OneTemperament, OneTheme } from './character-one.js';
export type { OneCadence, OneGesture } from './character-one-motion.js';
export type { AvatarExpression, AvatarStatus, LiveEyeState, CharacterRuntimeState, CharacterStateUpdate } from './character-state.js';
