//! Small duration parser for the `rate_limit.window` field.
//!
//! Accepted forms: `<N>s`, `<N>m`, `<N>h`, `<N>d` (case-insensitive). This
//! keeps YAML policies readable (`window: 1h`) without pulling in a
//! heavyweight duration crate.

use std::time::Duration;

/// Parse a string like `30s`, `5m`, `2h`, `1d` into a [`Duration`].
///
/// # Errors
/// Returns a `String` describing the parse failure. Callers typically wrap
/// this in [`SkillsPolicyError::InvalidPolicy`].
pub(crate) fn parse_duration(input: &str) -> Result<Duration, String> {
    let trimmed = input.trim();
    if trimmed.is_empty() {
        return Err("empty duration".to_string());
    }
    let (num_part, unit_char) = split_suffix(trimmed)?;
    let n: u64 = num_part
        .parse()
        .map_err(|e| format!("invalid number `{num_part}`: {e}"))?;
    if n == 0 {
        return Err("duration must be > 0".to_string());
    }
    let multiplier: u64 = match unit_char {
        's' | 'S' => 1,
        'm' | 'M' => 60,
        'h' | 'H' => 60 * 60,
        'd' | 'D' => 60 * 60 * 24,
        other => {
            return Err(format!(
                "unknown unit `{other}`; expected one of s, m, h, d"
            ))
        }
    };
    let secs = n
        .checked_mul(multiplier)
        .ok_or_else(|| "duration overflow".to_string())?;
    Ok(Duration::from_secs(secs))
}

fn split_suffix(input: &str) -> Result<(&str, char), String> {
    let last = input
        .chars()
        .last()
        .ok_or_else(|| "empty duration".to_string())?;
    if last.is_ascii_digit() {
        // No unit — default to seconds.
        return Ok((input, 's'));
    }
    let prefix = &input[..input.len() - last.len_utf8()];
    if prefix.is_empty() {
        return Err(format!("missing numeric part in `{input}`"));
    }
    Ok((prefix, last))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_seconds() {
        assert_eq!(parse_duration("30s").expect("ok"), Duration::from_secs(30));
        assert_eq!(parse_duration("30").expect("ok"), Duration::from_secs(30));
    }

    #[test]
    fn parses_minutes_hours_days() {
        assert_eq!(parse_duration("5m").expect("ok"), Duration::from_secs(300));
        assert_eq!(
            parse_duration("2h").expect("ok"),
            Duration::from_secs(7_200)
        );
        assert_eq!(
            parse_duration("1d").expect("ok"),
            Duration::from_secs(86_400)
        );
    }

    #[test]
    fn rejects_invalid() {
        assert!(parse_duration("").is_err());
        assert!(parse_duration("abc").is_err());
        assert!(parse_duration("5x").is_err());
        assert!(parse_duration("0s").is_err());
    }
}
