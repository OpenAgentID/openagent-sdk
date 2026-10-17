/** Build-time-only switch: verbose in source/full SDK, compact in the standalone One browser entry. */
declare const __OAID_ONE_COMPACT_ERRORS__: boolean;

export function oneError(code: number, message: () => string): string {
  return typeof __OAID_ONE_COMPACT_ERRORS__ !== 'undefined' && __OAID_ONE_COMPACT_ERRORS__
    ? `O${code}` : message();
}
