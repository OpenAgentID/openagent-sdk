/**
 * The live One runtime alone, self-contained for a browser: `mountOne` and the shape and colour helpers, within the
 * One app's script budget of 16 KB gzipped (scripts/check-size.mjs). Render still heads and DID default looks where
 * a DID is at hand, on the server or in a bundle, with `@openagentid/sdk/one`.
 */
export { mountOne } from './one.js';
export type { OneMountOptions, OneAppearanceUpdate, OnePlayer, OnePlayOptions } from './one.js';
export { getOneShapes, getOneColors, ONE_SHAPE_ORDER, ONE_DIGITAL, ONE_KINDS, isOneShape, isOneColor, isOneKind, isOneColorAllowed, nextOneLook } from './character-one.js';
export type { OneShape, OneColor, OneKind, OneHeadColor, OneLook, OneLookHolder, OneShapeDescription, OneShapeEye, OneColorDescription,
  OneTemperament, OneTheme } from './character-one.js';
export type { OneCadence, OneGesture } from './character-one-motion.js';
export type { AvatarExpression, AvatarStatus, LiveEyeState, CharacterRuntimeState, CharacterStateUpdate } from './character-state.js';
