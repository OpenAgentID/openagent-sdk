/** Self-contained browser entry: no framework or Node polyfills required. */
export { mountCharacter } from './character-player.js';
export type { CharacterPlayer, CharacterPlayerOptions, CharacterAppearanceUpdate } from './character-player.js';
export { getCharacterExpressions, getCharacterStatuses, getCharacterSkins, getCharacterAccessories } from './characters.js';
export type { CharacterAppearance, CharacterOptions, CharacterDescriptor, CharacterFinish,
  CharacterEyePlacement, CharacterSkin, CharacterShape, CharacterView, CharacterAccessory,
  AvatarExpression, LiveEyeState } from './characters.js';
