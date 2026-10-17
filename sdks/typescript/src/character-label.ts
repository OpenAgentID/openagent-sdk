/** Accessible names for characters: short plain text, normally the agent's own name, never a colour word. */
import { oneError } from './one-error.js';

export function parseCharacterLabel(value: unknown): string {
  if (typeof value !== 'string' || value.length > 200 || !value.trim() || /[\u0000-\u001f\u007f]/.test(value)) {
    throw new TypeError(oneError(1, () => ('Character label must be 1–200 characters of plain text')));
  }
  return value;
}

