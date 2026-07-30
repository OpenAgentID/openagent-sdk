//! Ed25519 signature primitives (RFC 8032).
//!
//! Wraps [`ed25519_dalek`] with the calling conventions used by Arsenal, AEGIS,
//! OAS, and the OpenAgent SDK. All operations take and return raw byte arrays so
//! that the same surface compiles cleanly to WASM via [`crate::wasm_api`].
//!
//! - Signing keys are 32 bytes.
//! - Public (verifying) keys are 32 bytes.
//! - Signatures are 64 bytes.
//! - The signing-key wrapper [`Keypair`] zeroizes its private bytes on drop.

use ed25519_dalek::{
    Signature, Signer, SigningKey, Verifier, VerifyingKey, PUBLIC_KEY_LENGTH, SECRET_KEY_LENGTH,
    SIGNATURE_LENGTH,
};
use zeroize::Zeroize;

use crate::error::CryptoError;

/// Length of an Ed25519 signing (private) key in bytes.
pub const SIGNING_KEY_LEN: usize = SECRET_KEY_LENGTH;
/// Length of an Ed25519 verifying (public) key in bytes.
pub const VERIFYING_KEY_LEN: usize = PUBLIC_KEY_LENGTH;
/// Length of an Ed25519 signature in bytes.
pub const SIGNATURE_LEN: usize = SIGNATURE_LENGTH;

/// An Ed25519 keypair, suitable for both Rust and WASM contexts.
///
/// Holds the 32-byte signing key and the derived 32-byte verifying key. The
/// signing key bytes are zeroized when this struct is dropped.
///
/// # Security
///
/// `Debug` deliberately redacts the signing key. Do not log a [`Keypair`] in
/// any way that could expose `signing_key`.
pub struct Keypair {
    signing_key: [u8; SIGNING_KEY_LEN],
    verifying_key: [u8; VERIFYING_KEY_LEN],
}

impl std::fmt::Debug for Keypair {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("Keypair")
            .field("signing_key", &"[REDACTED]")
            .field("verifying_key", &hex::encode(self.verifying_key))
            .finish()
    }
}

impl Drop for Keypair {
    fn drop(&mut self) {
        self.signing_key.zeroize();
    }
}

impl Keypair {
    /// Returns a copy of the 32-byte signing (private) key bytes.
    ///
    /// The returned array should be wiped after use.
    #[inline]
    pub fn signing_key_bytes(&self) -> [u8; SIGNING_KEY_LEN] {
        self.signing_key
    }

    /// Returns a copy of the 32-byte verifying (public) key bytes.
    #[inline]
    pub fn verifying_key_bytes(&self) -> [u8; VERIFYING_KEY_LEN] {
        self.verifying_key
    }
}

/// Generates a fresh Ed25519 keypair using the OS / WASM host CSPRNG.
///
/// # Examples
///
/// ```
/// let kp = openagent_crypto_wasm::ed25519::generate_keypair();
/// assert_eq!(kp.signing_key_bytes().len(), 32);
/// assert_eq!(kp.verifying_key_bytes().len(), 32);
/// ```
pub fn generate_keypair() -> Keypair {
    let mut seed = [0u8; SIGNING_KEY_LEN];
    crate::ct::fill_random(&mut seed).expect("system CSPRNG must be available for keygen");
    let sk = SigningKey::from_bytes(&seed);
    let vk = sk.verifying_key();
    let kp = Keypair {
        signing_key: sk.to_bytes(),
        verifying_key: vk.to_bytes(),
    };
    seed.zeroize();
    kp
}

/// Constructs an Ed25519 keypair from raw signing-key bytes.
///
/// The verifying key is computed deterministically from the signing key.
///
/// # Errors
///
/// [`CryptoError::InvalidLength`] if `signing_key` is not exactly
/// [`SIGNING_KEY_LEN`] bytes.
pub fn keypair_from_signing_key(signing_key: &[u8]) -> Result<Keypair, CryptoError> {
    let bytes: [u8; SIGNING_KEY_LEN] = signing_key.try_into().map_err(|_| {
        CryptoError::invalid_length("Ed25519 signing key", SIGNING_KEY_LEN, signing_key.len())
    })?;
    let sk = SigningKey::from_bytes(&bytes);
    let vk = sk.verifying_key();
    Ok(Keypair {
        signing_key: bytes,
        verifying_key: vk.to_bytes(),
    })
}

/// Derives the Ed25519 verifying (public) key from a signing (private) key.
///
/// # Errors
///
/// [`CryptoError::InvalidLength`] if `signing_key` is not exactly 32 bytes.
pub fn public_from_private(signing_key: &[u8]) -> Result<[u8; VERIFYING_KEY_LEN], CryptoError> {
    let kp = keypair_from_signing_key(signing_key)?;
    Ok(kp.verifying_key_bytes())
}

/// Signs `message` with the supplied 32-byte Ed25519 signing key.
///
/// Returns the 64-byte detached signature.
///
/// # Errors
///
/// [`CryptoError::InvalidLength`] if `signing_key` is not exactly 32 bytes.
pub fn sign(signing_key: &[u8], message: &[u8]) -> Result<[u8; SIGNATURE_LEN], CryptoError> {
    let bytes: [u8; SIGNING_KEY_LEN] = signing_key.try_into().map_err(|_| {
        CryptoError::invalid_length("Ed25519 signing key", SIGNING_KEY_LEN, signing_key.len())
    })?;
    let sk = SigningKey::from_bytes(&bytes);
    let sig: Signature = sk.sign(message);
    Ok(sig.to_bytes())
}

/// Verifies an Ed25519 signature against the given verifying key and message.
///
/// Returns `Ok(())` on success.
///
/// # Errors
///
/// - [`CryptoError::InvalidLength`] if either `verifying_key` or `signature`
///   has the wrong length.
/// - [`CryptoError::InvalidPublicKey`] if `verifying_key` is not on the curve.
/// - [`CryptoError::SignatureInvalid`] if verification fails.
pub fn verify(verifying_key: &[u8], message: &[u8], signature: &[u8]) -> Result<(), CryptoError> {
    let vk_bytes: [u8; VERIFYING_KEY_LEN] = verifying_key.try_into().map_err(|_| {
        CryptoError::invalid_length(
            "Ed25519 verifying key",
            VERIFYING_KEY_LEN,
            verifying_key.len(),
        )
    })?;
    let sig_bytes: [u8; SIGNATURE_LEN] = signature.try_into().map_err(|_| {
        CryptoError::invalid_length("Ed25519 signature", SIGNATURE_LEN, signature.len())
    })?;

    let vk = VerifyingKey::from_bytes(&vk_bytes).map_err(|e| CryptoError::InvalidPublicKey {
        reason: e.to_string(),
    })?;
    let sig = Signature::from_bytes(&sig_bytes);
    vk.verify(message, &sig)
        .map_err(|e| CryptoError::SignatureInvalid {
            reason: e.to_string(),
        })
}

#[cfg(test)]
mod tests {
    use super::*;
    use hex_literal::hex;

    #[test]
    fn generate_round_trip_sign_verify() {
        let kp = generate_keypair();
        let sig = sign(&kp.signing_key_bytes(), b"hello world").unwrap();
        verify(&kp.verifying_key_bytes(), b"hello world", &sig).unwrap();
    }

    #[test]
    fn keypair_from_signing_key_is_deterministic() {
        let seed = hex!("9d61b19deffd5a60ba844af492ec2cc44449c5697b326919703bac031cae7f60");
        let a = keypair_from_signing_key(&seed).unwrap();
        let b = keypair_from_signing_key(&seed).unwrap();
        assert_eq!(a.verifying_key_bytes(), b.verifying_key_bytes());
    }

    #[test]
    fn public_from_private_matches_keypair() {
        let kp = generate_keypair();
        let pk = public_from_private(&kp.signing_key_bytes()).unwrap();
        assert_eq!(pk, kp.verifying_key_bytes());
    }

    #[test]
    fn invalid_length_signing_key_returns_error() {
        let result = sign(&[0u8; 16], b"msg");
        assert!(matches!(result, Err(CryptoError::InvalidLength { .. })));
    }

    #[test]
    fn invalid_length_signature_returns_error() {
        let kp = generate_keypair();
        let result = verify(&kp.verifying_key_bytes(), b"msg", &[0u8; 32]);
        assert!(matches!(result, Err(CryptoError::InvalidLength { .. })));
    }

    #[test]
    fn tampered_message_fails_verification() {
        let kp = generate_keypair();
        let sig = sign(&kp.signing_key_bytes(), b"original").unwrap();
        let result = verify(&kp.verifying_key_bytes(), b"tampered", &sig);
        assert!(matches!(result, Err(CryptoError::SignatureInvalid { .. })));
    }

    #[test]
    fn wrong_key_fails_verification() {
        let kp1 = generate_keypair();
        let kp2 = generate_keypair();
        let sig = sign(&kp1.signing_key_bytes(), b"msg").unwrap();
        let result = verify(&kp2.verifying_key_bytes(), b"msg", &sig);
        assert!(matches!(result, Err(CryptoError::SignatureInvalid { .. })));
    }

    #[test]
    fn debug_redacts_signing_key() {
        let kp = generate_keypair();
        let s = format!("{kp:?}");
        assert!(s.contains("[REDACTED]"));
        assert!(!s.contains(&hex::encode(kp.signing_key_bytes())));
    }

    // RFC 8032 §7.1 Test 1: empty message.
    #[test]
    fn rfc8032_test_1_empty_message() {
        let secret: [u8; 32] = [
            0x9d, 0x61, 0xb1, 0x9d, 0xef, 0xfd, 0x5a, 0x60, 0xba, 0x84, 0x4a, 0xf4, 0x92, 0xec,
            0x2c, 0xc4, 0x44, 0x49, 0xc5, 0x69, 0x7b, 0x32, 0x69, 0x19, 0x70, 0x3b, 0xac, 0x03,
            0x1c, 0xae, 0x7f, 0x60,
        ];
        let public: [u8; 32] = [
            0xd7, 0x5a, 0x98, 0x01, 0x82, 0xb1, 0x0a, 0xb7, 0xd5, 0x4b, 0xfe, 0xd3, 0xc9, 0x64,
            0x07, 0x3a, 0x0e, 0xe1, 0x72, 0xf3, 0xda, 0xa3, 0xf4, 0xa1, 0x84, 0x46, 0xb7, 0xe8,
            0xc6, 0x06, 0x27, 0x31,
        ];
        let expected_sig: [u8; 64] = [
            0xe5, 0x56, 0x43, 0x00, 0xc3, 0x60, 0xac, 0x72, 0x90, 0x86, 0xe2, 0xcc, 0x80, 0x6e,
            0x82, 0x8a, 0x84, 0x87, 0x7f, 0x1e, 0xb8, 0xe5, 0xd9, 0x74, 0xd8, 0x73, 0xe0, 0x65,
            0x22, 0x49, 0x01, 0x55, 0x5f, 0xb8, 0x82, 0x15, 0x90, 0xa3, 0x3b, 0xac, 0xc6, 0x1e,
            0x39, 0x70, 0x1c, 0xf9, 0xb4, 0x6b, 0xd2, 0x5b, 0xf5, 0xf0, 0x59, 0x5b, 0xbe, 0x24,
            0x65, 0x51, 0x41, 0x43, 0x8e, 0x7a, 0x10, 0x0b,
        ];

        let kp = keypair_from_signing_key(&secret).unwrap();
        assert_eq!(kp.verifying_key_bytes(), public);

        let sig = sign(&secret, b"").unwrap();
        assert_eq!(sig, expected_sig);

        verify(&public, b"", &sig).unwrap();
    }

    // RFC 8032 §7.1 Test 2: single byte message.
    #[test]
    fn rfc8032_test_2_single_byte_message() {
        let secret = hex!("4ccd089b28ff96da9db6c346ec114e0f5b8a319f35aba624da8cf6ed4fb8a6fb");
        let public = hex!("3d4017c3e843895a92b70aa74d1b7ebc9c982ccf2ec4968cc0cd55f12af4660c");
        let message = hex!("72");
        let expected_sig = hex!(
            "92a009a9f0d4cab8720e820b5f642540"
            "a2b27b5416503f8fb3762223ebdb69da"
            "085ac1e43e15996e458f3613d0f11d8c"
            "387b2eaeb4302aeeb00d291612bb0c00"
        );

        let kp = keypair_from_signing_key(&secret).unwrap();
        assert_eq!(kp.verifying_key_bytes(), public);

        let sig = sign(&secret, &message).unwrap();
        assert_eq!(sig, expected_sig);

        verify(&public, &message, &sig).unwrap();
    }

    // RFC 8032 §7.1 Test 3: two-byte message.
    #[test]
    fn rfc8032_test_3_two_byte_message() {
        let secret = hex!("c5aa8df43f9f837bedb7442f31dcb7b166d38535076f094b85ce3a2e0b4458f7");
        let public = hex!("fc51cd8e6218a1a38da47ed00230f0580816ed13ba3303ac5deb911548908025");
        let message = hex!("af82");
        let expected_sig = hex!(
            "6291d657deec24024827e69c3abe01a3"
            "0ce548a284743a445e3680d7db5ac3ac"
            "18ff9b538d16f290ae67f760984dc659"
            "4a7c15e9716ed28dc027beceea1ec40a"
        );
        let sig = sign(&secret, &message).unwrap();
        assert_eq!(sig, expected_sig);
        verify(&public, &message, &sig).unwrap();
    }
}
