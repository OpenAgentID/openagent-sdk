/** Accessible names for characters: short plain text, normally the agent's own name, never a colour word. */
export function parseCharacterLabel(value: unknown): string {
  if (typeof value !== 'string' || value.length > 200 || !value.trim() || /[\u0000-\u001f\u007f]/.test(value)) {
    throw new TypeError('Character label must be 1–200 characters of plain text');
  }
  return value;
}
