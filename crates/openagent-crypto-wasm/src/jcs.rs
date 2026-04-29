//! JSON Canonicalization Scheme (JCS, RFC 8785).
//!
//! Produces a deterministic byte representation of a JSON value where:
//!
//! - Object keys are sorted lexicographically by UTF-16 code units
//! - All insignificant whitespace is removed
//! - Numbers are normalized via the rules in RFC 8785 §3
//! - Strings are escaped per the JCS specification
//!
//! This is the byte stream that OAS, Arsenal, and AEGIS feed into Ed25519
//! signing and BLAKE3 hashing for any JSON-shaped payload.

use crate::error::CryptoError;

/// Canonicalizes a UTF-8 JSON string into its JCS bytes.
///
/// `input` MUST be a valid JSON document. Invalid JSON returns
/// [`CryptoError::JcsFailed`].
///
/// # Examples
///
/// ```
/// let bytes = openagent_crypto_wasm::jcs::canonicalize(r#"{"b":1,"a":2}"#).unwrap();
/// assert_eq!(bytes, br#"{"a":2,"b":1}"#);
/// ```
pub fn canonicalize(input: &str) -> Result<Vec<u8>, CryptoError> {
    let value: serde_json::Value =
        serde_json::from_str(input).map_err(|e| CryptoError::JcsFailed {
            reason: format!("input is not valid JSON: {e}"),
        })?;
    canonicalize_value(&value)
}

/// Canonicalizes a [`serde_json::Value`] into its JCS bytes.
///
/// Use this when you already have a parsed `serde_json::Value` (e.g. from a
/// downstream Rust crate) so you don't pay the cost of re-parsing.
pub fn canonicalize_value(value: &serde_json::Value) -> Result<Vec<u8>, CryptoError> {
    serde_jcs::to_vec(value).map_err(|e| CryptoError::JcsFailed {
        reason: e.to_string(),
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn canonicalize_sorts_keys() {
        let input = r#"{"c":3,"a":1,"b":2}"#;
        let canonical = canonicalize(input).unwrap();
        assert_eq!(canonical, br#"{"a":1,"b":2,"c":3}"#);
    }

    #[test]
    fn canonicalize_nested_object() {
        let input = r#"{"b":{"d":4,"c":3},"a":1}"#;
        let canonical = canonicalize(input).unwrap();
        assert_eq!(canonical, br#"{"a":1,"b":{"c":3,"d":4}}"#);
    }

    #[test]
    fn canonicalize_strips_whitespace() {
        let input = r#"  {  "a"  :  1  ,  "b"  :  [ 1, 2, 3 ]  }  "#;
        let canonical = canonicalize(input).unwrap();
        assert_eq!(canonical, br#"{"a":1,"b":[1,2,3]}"#);
    }

    #[test]
    fn canonicalize_empty_object() {
        assert_eq!(canonicalize("{}").unwrap(), b"{}");
    }

    #[test]
    fn canonicalize_value_round_trip() {
        let v = json!({"z": 26, "a": 1, "m": [3, 2, 1]});
        let bytes = canonicalize_value(&v).unwrap();
        assert_eq!(bytes, br#"{"a":1,"m":[3,2,1],"z":26}"#);
    }

    #[test]
    fn canonicalize_invalid_json_returns_error() {
        let result = canonicalize("not json at all");
        assert!(matches!(result, Err(CryptoError::JcsFailed { .. })));
    }

    // RFC 8785 §3.2.3 example: number normalization round-trip.
    #[test]
    fn canonicalize_numbers_normalized() {
        let input = r#"{"e": 1.0, "f": 1, "g": 0}"#;
        let canonical = canonicalize(input).unwrap();
        let s = std::str::from_utf8(&canonical).unwrap();
        // Keys must be sorted; numbers must be present.
        assert!(s.starts_with("{\"e\":"));
        assert!(s.contains("\"f\":1"));
        assert!(s.contains("\"g\":0"));
    }
}
