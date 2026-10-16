/** Self-contained browser entry: no framework or Node polyfills required. */
export { mountCharacter } from './character-player.js';
export type { CharacterPlayer, CharacterPlayerOptions, CharacterAppearanceUpdate } from './character-player.js';
export { getCharacterExpressions, getCharacterStatuses, getCharacterSkins, getCharacterAccessories,
  getOneShapes, getOneColors, ONE_SHAPE_ORDER, ONE_DIGITAL, isOneShape, isOneColor, isOneKind, isOneColorAllowed,
  oneShapeForDid, oneColorForDid, oneLookForDid, nextOneLook } from './characters.js';
export type { CharacterAppearance, CharacterOptions, CharacterDescriptor, CharacterFinish,
  CharacterEyePlacement, CharacterSkin, CharacterShape, CharacterView, CharacterAccessory,
  AvatarExpression, LiveEyeState, CharacterTheme, CharacterEyeStyle, OneShape, OneColor, OneKind, OneLook, OneLookHolder,
  OneShapeDescription, OneColorDescription } from './characters.js';
export type { CharacterMotionPreference } from './character-player.js';
export type { OneCadence } from './character-animation.js';
