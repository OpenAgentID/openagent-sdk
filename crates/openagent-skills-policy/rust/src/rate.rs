//! Per-skill rate limiter.
//!
//! We use a GCRA-style virtual-scheduling algorithm: each skill has a
//! `theoretical_arrival_time` (TAT) that advances by `emission_interval` on
//! every recorded invocation. A request is allowed if `now >= tat - window`.
//!
//! This gives smooth rate limiting (no burst refills at window boundaries)
//! while still allowing short bursts up to `max` back-to-back invocations.
//!
//! State is held in memory keyed by skill name. A production deployment
//! would back this with Arsenal's `arsenal-store` — see `RateLimiter::snapshot`
//! for the export hook.

use std::collections::HashMap;
use std::time::Duration;

use time::OffsetDateTime;

use crate::policy::RateLimit;

/// In-memory GCRA rate limiter keyed by skill name.
#[derive(Debug, Default)]
pub struct RateLimiter {
    /// Per-skill theoretical arrival time (TAT) as unix seconds (float).
    tats: HashMap<String, f64>,
}

/// Result of consulting the rate limiter.
#[derive(Debug, Clone, Copy, PartialEq)]
pub enum RateLimitDecision {
    /// The invocation is allowed; TAT has been advanced.
    Allowed,
    /// The invocation is denied. Contains the number of *conceptual*
    /// invocations already consumed in the window.
    Denied {
        /// How many are currently considered used in the window.
        used: u64,
    },
}

impl RateLimiter {
    /// Create a fresh limiter with no state.
    #[must_use]
    pub fn new() -> Self {
        Self::default()
    }

    /// Check whether an invocation at `now` would be allowed and, if so,
    /// advance the TAT. If denied, state is left untouched.
    pub(crate) fn check_and_record(
        &mut self,
        skill: &str,
        limit: &RateLimit,
        now: OffsetDateTime,
    ) -> RateLimitDecision {
        let Ok(window) = crate::duration::parse_duration(&limit.window) else {
            // Validation should have caught this earlier; treat as allowed
            // so we don't silently break an already-loaded policy.
            return RateLimitDecision::Allowed;
        };
        let Some(decision) =
            gcra_check_and_record(&mut self.tats, skill, limit.max, window, now)
        else {
            return RateLimitDecision::Allowed;
        };
        decision
    }

    /// Peek at the number of theoretical invocations currently in use for
    /// `skill`, for observability/debugging.
    #[must_use]
    pub fn used(&self, skill: &str, limit: &RateLimit, now: OffsetDateTime) -> u64 {
        let Ok(window) = crate::duration::parse_duration(&limit.window) else {
            return 0;
        };
        let Some(tat) = self.tats.get(skill).copied() else {
            return 0;
        };
        let now_secs = offset_seconds(now);
        let window_secs = window.as_secs_f64();
        let emission_interval = window_secs / (limit.max as f64);
        let gap = tat - now_secs;
        if gap <= 0.0 {
            0
        } else {
            let used_f = (gap / emission_interval).ceil();
            used_f.max(0.0).min(limit.max as f64) as u64
        }
    }

    /// Remove any stored state for the given skill.
    pub fn reset(&mut self, skill: &str) {
        self.tats.remove(skill);
    }

    /// Snapshot the current TATs — useful for persisting state.
    #[must_use]
    pub fn snapshot(&self) -> Vec<(String, f64)> {
        self.tats
            .iter()
            .map(|(k, v)| (k.clone(), *v))
            .collect()
    }
}

fn gcra_check_and_record(
    tats: &mut HashMap<String, f64>,
    skill: &str,
    max: u64,
    window: Duration,
    now: OffsetDateTime,
) -> Option<RateLimitDecision> {
    if max == 0 {
        return Some(RateLimitDecision::Denied { used: 0 });
    }
    let window_secs = window.as_secs_f64();
    if window_secs <= 0.0 {
        return Some(RateLimitDecision::Allowed);
    }
    let emission_interval = window_secs / (max as f64);
    let now_secs = offset_seconds(now);

    let tat = tats.get(skill).copied().unwrap_or(now_secs);
    let new_tat = tat.max(now_secs) + emission_interval;
    let allow_at = new_tat - window_secs;

    if now_secs >= allow_at {
        tats.insert(skill.to_string(), new_tat);
        Some(RateLimitDecision::Allowed)
    } else {
        let gap = tat - now_secs;
        let used = ((gap / emission_interval).ceil()).max(0.0).min(max as f64) as u64;
        Some(RateLimitDecision::Denied { used })
    }
}

fn offset_seconds(now: OffsetDateTime) -> f64 {
    let whole = now.unix_timestamp() as f64;
    let frac = f64::from(now.nanosecond()) / 1_000_000_000.0_f64;
    whole + frac
}

#[cfg(test)]
mod tests {
    use super::*;
    use time::Duration as TD;

    fn now() -> OffsetDateTime {
        OffsetDateTime::from_unix_timestamp(1_700_000_000).expect("ts")
    }

    fn rl(max: u64, window: &str) -> RateLimit {
        RateLimit {
            window: window.to_string(),
            max,
        }
    }

    #[test]
    fn allows_within_burst() {
        let mut limiter = RateLimiter::new();
        let limit = rl(3, "60s");
        let t = now();
        for _ in 0..3 {
            assert_eq!(
                limiter.check_and_record("s", &limit, t),
                RateLimitDecision::Allowed
            );
        }
        assert!(matches!(
            limiter.check_and_record("s", &limit, t),
            RateLimitDecision::Denied { .. }
        ));
    }

    #[test]
    fn recovers_after_window() {
        let mut limiter = RateLimiter::new();
        let limit = rl(2, "10s");
        let t0 = now();
        assert_eq!(
            limiter.check_and_record("s", &limit, t0),
            RateLimitDecision::Allowed
        );
        assert_eq!(
            limiter.check_and_record("s", &limit, t0),
            RateLimitDecision::Allowed
        );
        assert!(matches!(
            limiter.check_and_record("s", &limit, t0),
            RateLimitDecision::Denied { .. }
        ));
        // After a full window elapses, we should be allowed again.
        let t1 = t0 + TD::seconds(15);
        assert_eq!(
            limiter.check_and_record("s", &limit, t1),
            RateLimitDecision::Allowed
        );
    }

    #[test]
    fn per_skill_isolation() {
        let mut limiter = RateLimiter::new();
        let limit = rl(1, "60s");
        let t = now();
        assert_eq!(
            limiter.check_and_record("a", &limit, t),
            RateLimitDecision::Allowed
        );
        assert_eq!(
            limiter.check_and_record("b", &limit, t),
            RateLimitDecision::Allowed
        );
        assert!(matches!(
            limiter.check_and_record("a", &limit, t),
            RateLimitDecision::Denied { .. }
        ));
    }

    #[test]
    fn reset_clears_state() {
        let mut limiter = RateLimiter::new();
        let limit = rl(1, "60s");
        let t = now();
        assert_eq!(
            limiter.check_and_record("s", &limit, t),
            RateLimitDecision::Allowed
        );
        limiter.reset("s");
        assert_eq!(
            limiter.check_and_record("s", &limit, t),
            RateLimitDecision::Allowed
        );
    }
}
