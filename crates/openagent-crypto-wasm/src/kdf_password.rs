//! Argon2id password hashing and verification (RFC 9106).
//!
//! Uses the [`argon2`] crate's password-hash format strings (`$argon2id$...`)
//! for both storage and verification. The default parameters are the OWASP-
//! recommended baseline (m=19MiB, t=2, p=1) and are baked into the underlying
//! crate. Callers needing custom parameters should use the native Rust API of
//! `argon2` directly — this module is intentionally minimal so the WASM-facing
//! surface stays small.

use argon2::{
    password_hash::{rand_core::OsRng, PasswordHash, PasswordHasher, PasswordVerifier, SaltString},
    Argon2,
};

use crate::error::CryptoError;

/// Hashes `password` with Argon2id and a fresh random salt.
///
/// Returns the PHC-format encoded hash string (`$argon2id$v=19$m=...`).
///
/// # Errors
///
/// [`CryptoError::PasswordHashFailed`] if the underlying hasher fails.
pub fn hash_password(password: &[u8]) -> Result<String, CryptoError> {
    let salt = SaltString::generate(&mut OsRng);
    let argon2 = Argon2::default();
    let hash =
        argon2
            .hash_password(password, &salt)
            .map_err(|e| CryptoError::PasswordHashFailed {
                operation: "hash",
                reason: e.to_string(),
            })?;
    Ok(hash.to_string())
}

/// Verifies `password` against a PHC-format encoded Argon2id hash.
///
/// Returns `Ok(true)` on a valid match, `Ok(false)` on a mismatch, and
/// [`CryptoError::PasswordHashFailed`] only if the hash string is malformed.
pub fn verify_password(password: &[u8], encoded_hash: &str) -> Result<bool, CryptoError> {
    let parsed = PasswordHash::new(encoded_hash).map_err(|e| CryptoError::PasswordHashFailed {
        operation: "verify",
        reason: format!("malformed hash string: {e}"),
    })?;
    match Argon2::default().verify_password(password, &parsed) {
        Ok(()) => Ok(true),
        Err(argon2::password_hash::Error::Password) => Ok(false),
        Err(e) => Err(CryptoError::PasswordHashFailed {
            operation: "verify",
            reason: e.to_string(),
        }),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn hash_and_verify_round_trip() {
        let password = b"correct horse battery staple";
        let encoded = hash_password(password).unwrap();
        assert!(encoded.starts_with("$argon2id$"));
        assert!(verify_password(password, &encoded).unwrap());
    }

    #[test]
    fn wrong_password_returns_false() {
        let encoded = hash_password(b"hunter2").unwrap();
        assert!(!verify_password(b"hunter1", &encoded).unwrap());
    }

    #[test]
    fn malformed_hash_returns_error() {
        let result = verify_password(b"x", "this is not a phc string");
        assert!(matches!(
            result,
            Err(CryptoError::PasswordHashFailed { .. })
        ));
    }

    #[test]
    fn each_hash_uses_a_different_salt() {
        let a = hash_password(b"same").unwrap();
        let b = hash_password(b"same").unwrap();
        assert_ne!(a, b, "salts must be random for each hash");
        assert!(verify_password(b"same", &a).unwrap());
        assert!(verify_password(b"same", &b).unwrap());
    }
}
