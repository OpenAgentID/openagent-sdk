//! Multibase base58btc encoding (W3C multibase, prefix `z`).
//!
//! This is the canonical encoding used for `publicKeyMultibase` in OAS Identity
//! Documents and the on-the-wire representation of public keys in Arsenal ACTs.
//!
//! - [`encode`] takes raw bytes and returns `"z" + base58btc(bytes)`.
//! - [`decode`] strips the leading `"z"` and returns the raw bytes.

use crate::error::CryptoError;

/// Encodes raw bytes as multibase base58btc with the `z` prefix.
///
/// # Examples
///
/// ```
/// let s = openagent_crypto_wasm::encoding::encode(&[0xDE, 0xAD, 0xBE, 0xEF]);
/// assert!(s.starts_with('z'));
/// ```
pub fn encode(bytes: &[u8]) -> String {
    let mut s = String::with_capacity(1 + bytes.len() * 2);
    s.push('z');
    s.push_str(&bs58::encode(bytes).into_string());
    s
}

/// Decodes a multibase base58btc string (must start with `z`) into raw bytes.
///
/// # Errors
///
/// [`CryptoError::MultibaseFailed`] if:
/// - The input is empty or does not start with `'z'`
/// - The base58btc payload is malformed
pub fn decode(input: &str) -> Result<Vec<u8>, CryptoError> {
    let rest = input.strip_prefix('z').ok_or_else(|| CryptoError::MultibaseFailed {
        operation: "decode",
        reason: format!(
            "expected 'z' prefix for base58btc multibase, got {:?}",
            input.chars().next()
        ),
    })?;
    bs58::decode(rest).into_vec().map_err(|e| CryptoError::MultibaseFailed {
        operation: "decode",
        reason: format!("base58btc decode error: {e}"),
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn round_trip_arbitrary_bytes() {
        let data = vec![0xDE, 0xAD, 0xBE, 0xEF, 0xCA, 0xFE];
        let encoded = encode(&data);
        assert!(encoded.starts_with('z'));
        let decoded = decode(&encoded).unwrap();
        assert_eq!(decoded, data);
    }

    #[test]
    fn round_trip_32_byte_key() {
        let key: Vec<u8> = (0..32).collect();
        let encoded = encode(&key);
        let decoded = decode(&encoded).unwrap();
        assert_eq!(decoded, key);
    }

    #[test]
    fn empty_bytes_round_trip() {
        let encoded = encode(&[]);
        assert_eq!(encoded, "z");
        let decoded = decode(&encoded).unwrap();
        assert_eq!(decoded, Vec::<u8>::new());
    }

    #[test]
    fn decode_missing_prefix_fails() {
        let result = decode("noprefix");
        assert!(matches!(result, Err(CryptoError::MultibaseFailed { .. })));
    }

    #[test]
    fn decode_garbage_payload_fails() {
        let result = decode("z!!!!notbase58!!!");
        assert!(matches!(result, Err(CryptoError::MultibaseFailed { .. })));
    }
}
