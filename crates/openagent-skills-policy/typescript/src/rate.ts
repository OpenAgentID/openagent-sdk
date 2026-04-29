/**
 * Per-skill GCRA rate limiter.
 *
 * The algorithm matches the Rust crate one-for-one so that a policy YAML
 * evaluated in either language reaches the same allow/deny decision given
 * the same invocation timestamps.
 */

import { parseDurationSeconds } from "./duration.js";
import type { RateLimit } from "./schema.js";

export type RateLimitDecision =
  | { kind: "allowed" }
  | { kind: "denied"; used: number };

export class RateLimiter {
  private readonly tats = new Map<string, number>();

  checkAndRecord(
    skill: string,
    limit: RateLimit,
    nowSecs: number,
  ): RateLimitDecision {
    let windowSecs: number;
    try {
      windowSecs = parseDurationSeconds(limit.window);
    } catch {
      // Validation should have caught this already; allow as a safety net.
      return { kind: "allowed" };
    }
    if (limit.max <= 0 || windowSecs <= 0) {
      return { kind: "allowed" };
    }

    const emissionInterval = windowSecs / limit.max;
    const tat = this.tats.get(skill) ?? nowSecs;
    const newTat = Math.max(tat, nowSecs) + emissionInterval;
    const allowAt = newTat - windowSecs;

    if (nowSecs >= allowAt) {
      this.tats.set(skill, newTat);
      return { kind: "allowed" };
    }

    const gap = tat - nowSecs;
    const used = Math.min(
      Math.max(Math.ceil(gap / emissionInterval), 0),
      limit.max,
    );
    return { kind: "denied", used };
  }

  reset(skill: string): void {
    this.tats.delete(skill);
  }

  snapshot(): Array<[string, number]> {
    return [...this.tats.entries()];
  }
}
