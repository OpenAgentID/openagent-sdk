/**
 * Small duration parser for the `rate_limit.window` field.
 *
 * Accepted forms: `<N>s`, `<N>m`, `<N>h`, `<N>d` (case-insensitive), or a
 * bare integer (interpreted as seconds). Returns the duration in seconds.
 */

export function parseDurationSeconds(input: string): number {
  const trimmed = input.trim();
  if (!trimmed) {
    throw new Error("empty duration");
  }
  const match = /^(\d+)\s*([sSmMhHdD]?)$/.exec(trimmed);
  if (!match) {
    throw new Error(
      `invalid duration \`${input}\`; expected \`<N>[s|m|h|d]\``,
    );
  }
  const numStr = match[1];
  const unit = match[2];
  if (numStr === undefined) {
    throw new Error(`invalid duration \`${input}\``);
  }
  const n = Number(numStr);
  if (!Number.isFinite(n) || n <= 0) {
    throw new Error(`duration must be > 0 (got ${input})`);
  }
  const multiplier = (() => {
    switch (unit) {
      case "":
      case "s":
      case "S":
        return 1;
      case "m":
      case "M":
        return 60;
      case "h":
      case "H":
        return 60 * 60;
      case "d":
      case "D":
        return 60 * 60 * 24;
      default:
        throw new Error(`unknown unit \`${unit}\``);
    }
  })();
  return n * multiplier;
}
