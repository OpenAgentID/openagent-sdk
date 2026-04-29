//! Authenticated encryption with associated data (AEAD).
//!
//! Two algorithms are exposed:
//!
//! - **AES-256-GCM** — NIST SP 800-38D, 96-bit nonce, 128-bit tag
//! - **XChaCha20-Poly1305** — IRTF draft, 192-bit nonce, 128-bit tag
//!
//! Both functions take key + nonce + plaintext + associated data and return
//! `ciphertext || tag` as a single byte vector. Decryption verifies the tag
//! before returning plaintext; a tag mismatch returns
//! [`CryptoError::AeadFailed`] with `operation = "decrypt"`.

use aes_gcm::{
    aead::{Aead, KeyInit, Payload},
    Aes256Gcm, Nonce as AesNonce,
};
use chacha20poly1305::{XChaCha20Poly1305, XNonce};

use crate::error::CryptoError;

/// Length of an AES-256-GCM key in bytes.
pub const AES256GCM_KEY_LEN: usize = 32;
/// Length of an AES-256-GCM nonce in bytes (96 bits, recommended).
pub const AES256GCM_NONCE_LEN: usize = 12;

/// Length of an XChaCha20-Poly1305 key in bytes.
pub const XCHACHA20POLY1305_KEY_LEN: usize = 32;
/// Length of an XChaCha20-Poly1305 nonce in bytes (192 bits, extended).
pub const XCHACHA20POLY1305_NONCE_LEN: usize = 24;

/// Encrypts `plaintext` with AES-256-GCM.
///
/// Returns `ciphertext || tag` (16-byte tag appended).
///
/// # Errors
///
/// - [`CryptoError::InvalidLength`] if `key` or `nonce` has the wrong length.
/// - [`CryptoError::AeadFailed`] if the underlying cipher rejects the input.
pub fn aes256gcm_encrypt(
    key: &[u8],
    nonce: &[u8],
    plaintext: &[u8],
    aad: &[u8],
) -> Result<Vec<u8>, CryptoError> {
    if key.len() != AES256GCM_KEY_LEN {
        return Err(CryptoError::invalid_length("AES-256-GCM key", AES256GCM_KEY_LEN, key.len()));
    }
    if nonce.len() != AES256GCM_NONCE_LEN {
        return Err(CryptoError::invalid_length("AES-256-GCM nonce", AES256GCM_NONCE_LEN, nonce.len()));
    }
    let cipher = Aes256Gcm::new_from_slice(key).map_err(|e| CryptoError::AeadFailed {
        algorithm: "AES-256-GCM",
        operation: "encrypt",
        reason: format!("invalid key: {e}"),
    })?;
    let nonce = AesNonce::from_slice(nonce);
    cipher
        .encrypt(nonce, Payload { msg: plaintext, aad })
        .map_err(|e| CryptoError::AeadFailed {
            algorithm: "AES-256-GCM",
            operation: "encrypt",
            reason: e.to_string(),
        })
}

/// Decrypts `ciphertext` with AES-256-GCM, verifying the tag.
///
/// `ciphertext` must be `actual_ciphertext || tag`. Returns the plaintext on
/// successful tag verification.
///
/// # Errors
///
/// - [`CryptoError::InvalidLength`] if `key` or `nonce` has the wrong length.
/// - [`CryptoError::AeadFailed`] (operation = `"decrypt"`) on tag failure.
pub fn aes256gcm_decrypt(
    key: &[u8],
    nonce: &[u8],
    ciphertext: &[u8],
    aad: &[u8],
) -> Result<Vec<u8>, CryptoError> {
    if key.len() != AES256GCM_KEY_LEN {
        return Err(CryptoError::invalid_length("AES-256-GCM key", AES256GCM_KEY_LEN, key.len()));
    }
    if nonce.len() != AES256GCM_NONCE_LEN {
        return Err(CryptoError::invalid_length("AES-256-GCM nonce", AES256GCM_NONCE_LEN, nonce.len()));
    }
    let cipher = Aes256Gcm::new_from_slice(key).map_err(|e| CryptoError::AeadFailed {
        algorithm: "AES-256-GCM",
        operation: "decrypt",
        reason: format!("invalid key: {e}"),
    })?;
    let nonce = AesNonce::from_slice(nonce);
    cipher
        .decrypt(nonce, Payload { msg: ciphertext, aad })
        .map_err(|e| CryptoError::AeadFailed {
            algorithm: "AES-256-GCM",
            operation: "decrypt",
            reason: e.to_string(),
        })
}

/// Encrypts `plaintext` with XChaCha20-Poly1305 (extended-nonce variant).
///
/// Returns `ciphertext || tag` (16-byte tag appended).
///
/// # Errors
///
/// - [`CryptoError::InvalidLength`] if `key` or `nonce` has the wrong length.
/// - [`CryptoError::AeadFailed`] if the cipher rejects the input.
pub fn xchacha20poly1305_encrypt(
    key: &[u8],
    nonce: &[u8],
    plaintext: &[u8],
    aad: &[u8],
) -> Result<Vec<u8>, CryptoError> {
    if key.len() != XCHACHA20POLY1305_KEY_LEN {
        return Err(CryptoError::invalid_length(
            "XChaCha20-Poly1305 key",
            XCHACHA20POLY1305_KEY_LEN,
            key.len(),
        ));
    }
    if nonce.len() != XCHACHA20POLY1305_NONCE_LEN {
        return Err(CryptoError::invalid_length(
            "XChaCha20-Poly1305 nonce",
            XCHACHA20POLY1305_NONCE_LEN,
            nonce.len(),
        ));
    }
    let cipher = XChaCha20Poly1305::new_from_slice(key).map_err(|e| CryptoError::AeadFailed {
        algorithm: "XChaCha20-Poly1305",
        operation: "encrypt",
        reason: format!("invalid key: {e}"),
    })?;
    let nonce = XNonce::from_slice(nonce);
    cipher
        .encrypt(nonce, Payload { msg: plaintext, aad })
        .map_err(|e| CryptoError::AeadFailed {
            algorithm: "XChaCha20-Poly1305",
            operation: "encrypt",
            reason: e.to_string(),
        })
}

/// Decrypts `ciphertext` with XChaCha20-Poly1305, verifying the tag.
///
/// # Errors
///
/// - [`CryptoError::InvalidLength`] if `key` or `nonce` has the wrong length.
/// - [`CryptoError::AeadFailed`] (operation = `"decrypt"`) on tag failure.
pub fn xchacha20poly1305_decrypt(
    key: &[u8],
    nonce: &[u8],
    ciphertext: &[u8],
    aad: &[u8],
) -> Result<Vec<u8>, CryptoError> {
    if key.len() != XCHACHA20POLY1305_KEY_LEN {
        return Err(CryptoError::invalid_length(
            "XChaCha20-Poly1305 key",
            XCHACHA20POLY1305_KEY_LEN,
            key.len(),
        ));
    }
    if nonce.len() != XCHACHA20POLY1305_NONCE_LEN {
        return Err(CryptoError::invalid_length(
            "XChaCha20-Poly1305 nonce",
            XCHACHA20POLY1305_NONCE_LEN,
            nonce.len(),
        ));
    }
    let cipher = XChaCha20Poly1305::new_from_slice(key).map_err(|e| CryptoError::AeadFailed {
        algorithm: "XChaCha20-Poly1305",
        operation: "decrypt",
        reason: format!("invalid key: {e}"),
    })?;
    let nonce = XNonce::from_slice(nonce);
    cipher
        .decrypt(nonce, Payload { msg: ciphertext, aad })
        .map_err(|e| CryptoError::AeadFailed {
            algorithm: "XChaCha20-Poly1305",
            operation: "decrypt",
            reason: e.to_string(),
        })
}

#[cfg(test)]
mod tests {
    use super::*;
    use hex_literal::hex;

    #[test]
    fn aes256gcm_round_trip() {
        let key = [0x42u8; 32];
        let nonce = [0x11u8; 12];
        let plaintext = b"the quick brown fox jumps over the lazy dog";
        let aad = b"associated";
        let ct = aes256gcm_encrypt(&key, &nonce, plaintext, aad).unwrap();
        let pt = aes256gcm_decrypt(&key, &nonce, &ct, aad).unwrap();
        assert_eq!(pt.as_slice(), plaintext.as_slice());
    }

    #[test]
    fn aes256gcm_tag_mismatch_fails() {
        let key = [0x42u8; 32];
        let nonce = [0x11u8; 12];
        let mut ct = aes256gcm_encrypt(&key, &nonce, b"hi", b"").unwrap();
        let last = ct.len() - 1;
        ct[last] ^= 0x01;
        let result = aes256gcm_decrypt(&key, &nonce, &ct, b"");
        assert!(matches!(result, Err(CryptoError::AeadFailed { .. })));
    }

    #[test]
    fn aes256gcm_wrong_aad_fails() {
        let key = [0x42u8; 32];
        let nonce = [0x11u8; 12];
        let ct = aes256gcm_encrypt(&key, &nonce, b"hi", b"aad-1").unwrap();
        let result = aes256gcm_decrypt(&key, &nonce, &ct, b"aad-2");
        assert!(matches!(result, Err(CryptoError::AeadFailed { .. })));
    }

    #[test]
    fn aes256gcm_invalid_key_length() {
        let result = aes256gcm_encrypt(&[0u8; 16], &[0u8; 12], b"hi", b"");
        assert!(matches!(result, Err(CryptoError::InvalidLength { .. })));
    }

    // NIST GCM AVS test vector — count 0 from gcmEncryptExtIV256.rsp
    //   Key:        00000000000000000000000000000000 00000000000000000000000000000000
    //   IV:         000000000000000000000000
    //   PT:         (empty)
    //   AAD:        (empty)
    //   CT:         (empty)
    //   Tag:        530f8afbc74536b9a963b4f1c4cb738b
    #[test]
    fn nist_aes256gcm_empty_pt_empty_aad() {
        let key = [0u8; 32];
        let iv = [0u8; 12];
        let expected_tag = hex!("530f8afbc74536b9a963b4f1c4cb738b");
        let ct = aes256gcm_encrypt(&key, &iv, b"", b"").unwrap();
        // ct = ciphertext || tag — for empty plaintext, ct == tag.
        assert_eq!(ct.len(), 16);
        assert_eq!(ct.as_slice(), expected_tag.as_slice());
    }

    #[test]
    fn xchacha20poly1305_round_trip() {
        let key = [0x33u8; 32];
        let nonce = [0x22u8; 24];
        let pt = b"sphinx of black quartz, judge my vow";
        let ct = xchacha20poly1305_encrypt(&key, &nonce, pt, b"").unwrap();
        let recovered = xchacha20poly1305_decrypt(&key, &nonce, &ct, b"").unwrap();
        assert_eq!(recovered.as_slice(), pt.as_slice());
    }

    #[test]
    fn xchacha20poly1305_tag_mismatch_fails() {
        let key = [0x33u8; 32];
        let nonce = [0x22u8; 24];
        let mut ct = xchacha20poly1305_encrypt(&key, &nonce, b"hi", b"").unwrap();
        let last = ct.len() - 1;
        ct[last] ^= 0x80;
        let result = xchacha20poly1305_decrypt(&key, &nonce, &ct, b"");
        assert!(matches!(result, Err(CryptoError::AeadFailed { .. })));
    }

    #[test]
    fn xchacha20poly1305_invalid_nonce_length() {
        let result = xchacha20poly1305_encrypt(&[0u8; 32], &[0u8; 12], b"hi", b"");
        assert!(matches!(result, Err(CryptoError::InvalidLength { .. })));
    }
}
