//! X25519 Diffie-Hellman key agreement (RFC 7748).
//!
//! Used by Arsenal capability tokens, AEGIS session establishment, and any
//! OpenAgent SDK component that needs an ECDH-derived shared secret. The shared
//! secret is the raw 32-byte X25519 output — callers MUST run it through a KDF
//! (HKDF-SHA256) before using it as keying material; this module deliberately
//! does NOT do that for you, so different protocols can apply their own context.

use x25519_dalek::{PublicKey, StaticSecret};
use zeroize::Zeroize;

use crate::error::CryptoError;

/// Length of an X25519 secret (private) key in bytes.
pub const SECRET_KEY_LEN: usize = 32;
/// Length of an X25519 public key in bytes.
pub const PUBLIC_KEY_LEN: usize = 32;
/// Length of an X25519 raw shared secret in bytes.
pub const SHARED_SECRET_LEN: usize = 32;

/// An X25519 keypair (Curve25519, RFC 7748).
///
/// The secret key is zeroized on drop.
pub struct X25519Keypair {
    secret_key: [u8; SECRET_KEY_LEN],
    public_key: [u8; PUBLIC_KEY_LEN],
}

impl std::fmt::Debug for X25519Keypair {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("X25519Keypair")
            .field("secret_key", &"[REDACTED]")
            .field("public_key", &hex::encode(self.public_key))
            .finish()
    }
}

impl Drop for X25519Keypair {
    fn drop(&mut self) {
        self.secret_key.zeroize();
    }
}

impl X25519Keypair {
    /// Returns a copy of the 32-byte secret key bytes.
    #[inline]
    pub fn secret_key_bytes(&self) -> [u8; SECRET_KEY_LEN] {
        self.secret_key
    }

    /// Returns a copy of the 32-byte public key bytes.
    #[inline]
    pub fn public_key_bytes(&self) -> [u8; PUBLIC_KEY_LEN] {
        self.public_key
    }
}

/// Generates a fresh X25519 keypair using the OS / WASM host CSPRNG.
pub fn generate_keypair() -> X25519Keypair {
    let mut seed = [0u8; SECRET_KEY_LEN];
    crate::ct::fill_random(&mut seed).expect("system CSPRNG must be available for keygen");
    let secret = StaticSecret::from(seed);
    let public = PublicKey::from(&secret);
    let kp = X25519Keypair {
        secret_key: secret.to_bytes(),
        public_key: public.to_bytes(),
    };
    seed.zeroize();
    kp
}

/// Derives an X25519 public key from a 32-byte secret key.
///
/// # Errors
///
/// [`CryptoError::InvalidLength`] if `secret_key` is not exactly 32 bytes.
pub fn public_from_secret(secret_key: &[u8]) -> Result<[u8; PUBLIC_KEY_LEN], CryptoError> {
    let bytes: [u8; SECRET_KEY_LEN] = secret_key.try_into().map_err(|_| {
        CryptoError::invalid_length("X25519 secret key", SECRET_KEY_LEN, secret_key.len())
    })?;
    let secret = StaticSecret::from(bytes);
    let public = PublicKey::from(&secret);
    Ok(public.to_bytes())
}

/// Performs an X25519 Diffie-Hellman key exchange.
///
/// Returns the raw 32-byte shared secret. Callers MUST process this through
/// a KDF (e.g. [`crate::hkdf_sha256`]) before using it as keying material.
///
/// # Errors
///
/// [`CryptoError::InvalidLength`] if either input is not 32 bytes.
pub fn diffie_hellman(
    secret_key: &[u8],
    peer_public_key: &[u8],
) -> Result<[u8; SHARED_SECRET_LEN], CryptoError> {
    let sk_bytes: [u8; SECRET_KEY_LEN] = secret_key.try_into().map_err(|_| {
        CryptoError::invalid_length("X25519 secret key", SECRET_KEY_LEN, secret_key.len())
    })?;
    let pk_bytes: [u8; PUBLIC_KEY_LEN] = peer_public_key.try_into().map_err(|_| {
        CryptoError::invalid_length("X25519 public key", PUBLIC_KEY_LEN, peer_public_key.len())
    })?;

    let secret = StaticSecret::from(sk_bytes);
    let peer = PublicKey::from(pk_bytes);
    let shared = secret.diffie_hellman(&peer);
    Ok(*shared.as_bytes())
}

#[cfg(test)]
mod tests {
    use super::*;
    use hex_literal::hex;

    #[test]
    fn generate_keypair_yields_distinct_keys() {
        let kp1 = generate_keypair();
        let kp2 = generate_keypair();
        assert_ne!(kp1.public_key_bytes(), kp2.public_key_bytes());
    }

    #[test]
    fn diffie_hellman_round_trip_produces_same_secret() {
        let alice = generate_keypair();
        let bob = generate_keypair();

        let alice_view =
            diffie_hellman(&alice.secret_key_bytes(), &bob.public_key_bytes()).unwrap();
        let bob_view = diffie_hellman(&bob.secret_key_bytes(), &alice.public_key_bytes()).unwrap();

        assert_eq!(alice_view, bob_view);
    }

    #[test]
    fn public_from_secret_matches_keypair() {
        let kp = generate_keypair();
        let derived = public_from_secret(&kp.secret_key_bytes()).unwrap();
        assert_eq!(derived, kp.public_key_bytes());
    }

    #[test]
    fn invalid_length_secret_key_returns_error() {
        let result = diffie_hellman(&[0u8; 16], &[0u8; 32]);
        assert!(matches!(result, Err(CryptoError::InvalidLength { .. })));
    }

    // RFC 7748 §6.1 Alice and Bob test vector.
    #[test]
    fn rfc7748_section_6_1_alice_bob() {
        let alice_secret = hex!("77076d0a7318a57d3c16c17251b26645df4c2f87ebc0992ab177fba51db92c2a");
        let alice_public = hex!("8520f0098930a754748b7ddcb43ef75a0dbf3a0d26381af4eba4a98eaa9b4e6a");
        let bob_secret = hex!("5dab087e624a8a4b79e17f8b83800ee66f3bb1292618b6fd1c2f8b27ff88e0eb");
        let bob_public = hex!("de9edb7d7b7dc1b4d35b61c2ece435373f8343c85b78674dadfc7e146f882b4f");
        let expected_shared =
            hex!("4a5d9d5ba4ce2de1728e3bf480350f25e07e21c947d19e3376f09b3c1e161742");

        // Public-from-secret matches the spec.
        assert_eq!(public_from_secret(&alice_secret).unwrap(), alice_public);
        assert_eq!(public_from_secret(&bob_secret).unwrap(), bob_public);

        // DH outputs from both sides match the expected shared secret.
        assert_eq!(
            diffie_hellman(&alice_secret, &bob_public).unwrap(),
            expected_shared
        );
        assert_eq!(
            diffie_hellman(&bob_secret, &alice_public).unwrap(),
            expected_shared
        );
    }
}
