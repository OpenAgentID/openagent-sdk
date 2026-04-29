//! Constant-time byte operations and CSPRNG plumbing.
//!
//! - [`ct_eq`] performs a length-checked, constant-time equality check using
//!   [`subtle::ConstantTimeEq`]. Returns `false` if the two slices have
//!   different lengths.
//! - [`fill_random`] is the single point of contact between this crate and the
//!   underlying CSPRNG (`getrandom`). Both native and WASM targets share the
//!   same call site so we can change the entropy source in exactly one place.

use subtle::ConstantTimeEq;

use crate::error::CryptoError;

/// Returns `true` iff `a` and `b` have the same length and identical contents.
///
/// Comparison is **constant time** with respect to slice length: the entire
/// `a` slice is consumed before returning. Use this for comparing secrets,
/// MAC tags, and any byte sequence whose contents must not leak via timing.
///
/// # Examples
///
/// ```
/// use openagent_crypto_wasm::ct::ct_eq;
/// assert!(ct_eq(b"abc", b"abc"));
/// assert!(!ct_eq(b"abc", b"abd"));
/// assert!(!ct_eq(b"abc", b"abcd"));
/// ```
pub fn ct_eq(a: &[u8], b: &[u8]) -> bool {
    if a.len() != b.len() {
        return false;
    }
    a.ct_eq(b).into()
}

/// Fills `out` with cryptographically secure random bytes.
///
/// On native targets this calls `getrandom::getrandom` which delegates to the
/// OS CSPRNG (`/dev/urandom`, `getrandom(2)`, `BCryptGenRandom`, etc.). On
/// WebAssembly with the `wasm` feature enabled, the same call routes through
/// the JS host's `crypto.getRandomValues`.
///
/// # Errors
///
/// [`CryptoError::RngFailed`] if the underlying CSPRNG returns an error
/// (extremely rare; usually only on misconfigured WASI environments).
pub fn fill_random(out: &mut [u8]) -> Result<(), CryptoError> {
    getrandom::getrandom(out).map_err(|e| CryptoError::RngFailed {
        reason: e.to_string(),
    })
}

/// Returns `n` cryptographically secure random bytes.
pub fn random_bytes(n: usize) -> Result<Vec<u8>, CryptoError> {
    let mut buf = vec![0u8; n];
    fill_random(&mut buf)?;
    Ok(buf)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn ct_eq_identical_bytes() {
        assert!(ct_eq(b"identical", b"identical"));
    }

    #[test]
    fn ct_eq_differing_bytes() {
        assert!(!ct_eq(b"identical", b"identicaL"));
    }

    #[test]
    fn ct_eq_different_lengths() {
        assert!(!ct_eq(b"abc", b"abcd"));
        assert!(!ct_eq(b"abcd", b"abc"));
    }

    #[test]
    fn ct_eq_empty_slices_match() {
        assert!(ct_eq(b"", b""));
    }

    #[test]
    fn fill_random_produces_distinct_outputs() {
        let mut a = [0u8; 32];
        let mut b = [0u8; 32];
        fill_random(&mut a).unwrap();
        fill_random(&mut b).unwrap();
        assert_ne!(a, b);
    }

    #[test]
    fn random_bytes_returns_correct_length() {
        let bytes = random_bytes(64).unwrap();
        assert_eq!(bytes.len(), 64);
    }
}
