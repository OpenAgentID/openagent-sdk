//! HKDF-SHA256 (RFC 5869) extract / expand primitives.
//!
//! Three operations are exposed:
//!
//! - [`extract`] — `HKDF-Extract(salt, IKM) -> PRK`
//! - [`expand`] — `HKDF-Expand(PRK, info, L) -> OKM`
//! - [`derive`] — convenience: extract + expand in one call
//!
//! All three are deterministic. None require randomness.

use hkdf::Hkdf;
use sha2::Sha256;

use crate::error::CryptoError;

/// Length of the HKDF-SHA256 PRK output (== HashLen).
pub const PRK_LEN: usize = 32;

/// Performs `HKDF-Extract(salt, IKM)`.
///
/// Returns the 32-byte pseudo-random key.
///
/// # Arguments
///
/// * `salt` — optional salt; pass an empty slice for the "no salt" case (the
///   HKDF will internally use 32 zero bytes per RFC 5869).
/// * `ikm` — input keying material.
pub fn extract(salt: &[u8], ikm: &[u8]) -> [u8; PRK_LEN] {
    let salt_opt = if salt.is_empty() { None } else { Some(salt) };
    let (prk, _hk) = Hkdf::<Sha256>::extract(salt_opt, ikm);
    let mut out = [0u8; PRK_LEN];
    out.copy_from_slice(&prk);
    out
}

/// Performs `HKDF-Expand(PRK, info, length)`.
///
/// # Errors
///
/// - [`CryptoError::InvalidLength`] if `prk` is not exactly 32 bytes.
/// - [`CryptoError::HkdfFailed`] if `length` exceeds `255 * HashLen` (8160 bytes
///   for SHA-256), which is the maximum allowed by RFC 5869.
pub fn expand(prk: &[u8], info: &[u8], length: usize) -> Result<Vec<u8>, CryptoError> {
    if prk.len() != PRK_LEN {
        return Err(CryptoError::invalid_length("HKDF PRK", PRK_LEN, prk.len()));
    }
    let hk = Hkdf::<Sha256>::from_prk(prk).map_err(|e| CryptoError::HkdfFailed {
        stage: "expand",
        reason: format!("invalid PRK: {e}"),
    })?;
    let mut okm = vec![0u8; length];
    hk.expand(info, &mut okm)
        .map_err(|e| CryptoError::HkdfFailed {
            stage: "expand",
            reason: e.to_string(),
        })?;
    Ok(okm)
}

/// Convenience: combined `HKDF-Extract` + `HKDF-Expand` in one call.
///
/// Equivalent to running [`extract`] then [`expand`] but avoids exposing the
/// intermediate PRK to the caller.
///
/// # Errors
///
/// [`CryptoError::HkdfFailed`] if `length` exceeds `255 * HashLen`.
pub fn derive(salt: &[u8], ikm: &[u8], info: &[u8], length: usize) -> Result<Vec<u8>, CryptoError> {
    let salt_opt = if salt.is_empty() { None } else { Some(salt) };
    let hk = Hkdf::<Sha256>::new(salt_opt, ikm);
    let mut okm = vec![0u8; length];
    hk.expand(info, &mut okm)
        .map_err(|e| CryptoError::HkdfFailed {
            stage: "expand",
            reason: e.to_string(),
        })?;
    Ok(okm)
}

#[cfg(test)]
mod tests {
    use super::*;
    use hex_literal::hex;

    // RFC 5869 §A.1 Test Case 1
    #[test]
    fn rfc5869_test_case_1() {
        let ikm = hex!("0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b");
        let salt = hex!("000102030405060708090a0b0c");
        let info = hex!("f0f1f2f3f4f5f6f7f8f9");
        let expected_prk = hex!("077709362c2e32df0ddc3f0dc47bba6390b6c73bb50f9c3122ec844ad7c2b3e5");
        let expected_okm = hex!(
            "3cb25f25faacd57a90434f64d0362f2a"
            "2d2d0a90cf1a5a4c5db02d56ecc4c5bf"
            "34007208d5b887185865"
        );

        let prk = extract(&salt, &ikm);
        assert_eq!(prk, expected_prk);

        let okm = expand(&prk, &info, 42).unwrap();
        assert_eq!(okm, expected_okm);

        let combined = derive(&salt, &ikm, &info, 42).unwrap();
        assert_eq!(combined, expected_okm);
    }

    // RFC 5869 §A.2 Test Case 2 — longer inputs/outputs.
    #[test]
    fn rfc5869_test_case_2() {
        let ikm = hex!(
            "000102030405060708090a0b0c0d0e0f"
            "101112131415161718191a1b1c1d1e1f"
            "202122232425262728292a2b2c2d2e2f"
            "303132333435363738393a3b3c3d3e3f"
            "404142434445464748494a4b4c4d4e4f"
        );
        let salt = hex!(
            "606162636465666768696a6b6c6d6e6f"
            "707172737475767778797a7b7c7d7e7f"
            "808182838485868788898a8b8c8d8e8f"
            "909192939495969798999a9b9c9d9e9f"
            "a0a1a2a3a4a5a6a7a8a9aaabacadaeaf"
        );
        let info = hex!(
            "b0b1b2b3b4b5b6b7b8b9babbbcbdbebf"
            "c0c1c2c3c4c5c6c7c8c9cacbcccdcecf"
            "d0d1d2d3d4d5d6d7d8d9dadbdcdddedf"
            "e0e1e2e3e4e5e6e7e8e9eaebecedeeef"
            "f0f1f2f3f4f5f6f7f8f9fafbfcfdfeff"
        );
        let expected_prk = hex!("06a6b88c5853361a06104c9ceb35b45cef760014904671014a193f40c15fc244");
        let expected_okm = hex!(
            "b11e398dc80327a1c8e7f78c596a4934"
            "4f012eda2d4efad8a050cc4c19afa97c"
            "59045a99cac7827271cb41c65e590e09"
            "da3275600c2f09b8367793a9aca3db71"
            "cc30c58179ec3e87c14c01d5c1f3434f"
            "1d87"
        );

        let prk = extract(&salt, &ikm);
        assert_eq!(prk, expected_prk);

        let okm = expand(&prk, &info, 82).unwrap();
        assert_eq!(okm, expected_okm);
    }

    // RFC 5869 §A.3 Test Case 3 — empty salt and info.
    #[test]
    fn rfc5869_test_case_3_empty_salt_and_info() {
        let ikm = hex!("0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b");
        let expected_prk = hex!("19ef24a32c717b167f33a91d6f648bdf96596776afdb6377ac434c1c293ccb04");
        let expected_okm = hex!(
            "8da4e775a563c18f715f802a063c5a31"
            "b8a11f5c5ee1879ec3454e5f3c738d2d"
            "9d201395faa4b61a96c8"
        );

        let prk = extract(b"", &ikm);
        assert_eq!(prk, expected_prk);

        let okm = expand(&prk, b"", 42).unwrap();
        assert_eq!(okm, expected_okm);
    }

    #[test]
    fn expand_rejects_oversized_output() {
        let prk = [0u8; 32];
        let result = expand(&prk, b"info", 256 * 32);
        assert!(matches!(result, Err(CryptoError::HkdfFailed { .. })));
    }

    #[test]
    fn expand_rejects_invalid_prk_length() {
        let result = expand(&[0u8; 16], b"info", 32);
        assert!(matches!(result, Err(CryptoError::InvalidLength { .. })));
    }
}
