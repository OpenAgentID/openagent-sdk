/** Shared validation for presentation records; unknown own keys are refused. */
import { objectKeys } from './character-intrinsics.js';

export function hasOnlyKeys(value: unknown, keys: readonly string[]): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value) && objectKeys(value).every(key => keys.includes(key));
}
