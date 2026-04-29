//! WebAssembly bindings for `openagent-crypto-wasm`.
//!
//! This module is only compiled when the `wasm` feature is enabled. It exposes
//! every primitive in the crate as a `#[wasm_bindgen]` function with TypeScript
//! type definitions automatically emitted by `wasm-pack`.
//!
//! ## Calling conventions
//!
//! - **Inputs**: byte slices arrive as `&[u8]`. wasm-bindgen translates this to
//!   `Uint8Array` on the JS side.
//! - **Outputs**: byte arrays leave as `Vec<u8>`, also `Uint8Array` on the JS
//!   side. JSON-shaped outputs use [`serde_wasm_bindgen`]-style conversion via
//!   `JsValue` (we hand-roll a single helper to keep dependencies minimal).
//! - **Errors**: every fallible function returns `Result<T, JsError>` so that
//!   `await` on the JS side throws a `Error` with the human-readable message.
//!
//! ## Naming
//!
//! Each exported function is prefixed by its primitive family so the resulting
//! TypeScript module reads cleanly:
//!
//! ```text
//! ed25519_generate_keypair
//! ed25519_sign
//! ed25519_verify
//! x25519_diffie_hellman
//! frost_trusted_keygen
//! frost_sign_round1
//! ...
//! ```

use wasm_bindgen::prelude::*;

use crate::{aead, blake3_hash, ct, ed25519, encoding, frost, hkdf_sha256, jcs, kdf_password, sha, x25519};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

fn js_err(e: impl std::fmt::Display) -> JsError {
    JsError::new(&e.to_string())
}

/// JS-friendly Ed25519 keypair: `{ signing_key, verifying_key }` as
/// `Uint8Array` byte arrays. Returned by [`ed25519_generate_keypair`].
#[wasm_bindgen]
#[derive(Clone)]
pub struct WasmKeypair {
    signing_key: Vec<u8>,
    verifying_key: Vec<u8>,
}

#[wasm_bindgen]
impl WasmKeypair {
    /// 32-byte signing (private) key.
    #[wasm_bindgen(getter)]
    pub fn signing_key(&self) -> Vec<u8> {
        self.signing_key.clone()
    }

    /// 32-byte verifying (public) key.
    #[wasm_bindgen(getter)]
    pub fn verifying_key(&self) -> Vec<u8> {
        self.verifying_key.clone()
    }
}

/// JS-friendly X25519 keypair: `{ secret_key, public_key }`.
#[wasm_bindgen]
#[derive(Clone)]
pub struct WasmX25519Keypair {
    secret_key: Vec<u8>,
    public_key: Vec<u8>,
}

#[wasm_bindgen]
impl WasmX25519Keypair {
    /// 32-byte secret (private) key.
    #[wasm_bindgen(getter)]
    pub fn secret_key(&self) -> Vec<u8> {
        self.secret_key.clone()
    }

    /// 32-byte public key.
    #[wasm_bindgen(getter)]
    pub fn public_key(&self) -> Vec<u8> {
        self.public_key.clone()
    }
}

// ---------------------------------------------------------------------------
// Ed25519
// ---------------------------------------------------------------------------

/// Generates a fresh Ed25519 keypair using the host CSPRNG.
#[wasm_bindgen]
pub fn ed25519_generate_keypair() -> WasmKeypair {
    let kp = ed25519::generate_keypair();
    WasmKeypair {
        signing_key: kp.signing_key_bytes().to_vec(),
        verifying_key: kp.verifying_key_bytes().to_vec(),
    }
}

/// Signs `message` with the supplied 32-byte Ed25519 signing key.
#[wasm_bindgen]
pub fn ed25519_sign(signing_key: &[u8], message: &[u8]) -> Result<Vec<u8>, JsError> {
    ed25519::sign(signing_key, message)
        .map(|sig| sig.to_vec())
        .map_err(js_err)
}

/// Verifies an Ed25519 signature. Throws if verification fails.
#[wasm_bindgen]
pub fn ed25519_verify(verifying_key: &[u8], message: &[u8], signature: &[u8]) -> Result<(), JsError> {
    ed25519::verify(verifying_key, message, signature).map_err(js_err)
}

/// Derives the Ed25519 verifying key from a signing key.
#[wasm_bindgen]
pub fn ed25519_public_from_private(signing_key: &[u8]) -> Result<Vec<u8>, JsError> {
    ed25519::public_from_private(signing_key)
        .map(|pk| pk.to_vec())
        .map_err(js_err)
}

// ---------------------------------------------------------------------------
// X25519
// ---------------------------------------------------------------------------

/// Generates a fresh X25519 keypair using the host CSPRNG.
#[wasm_bindgen]
pub fn x25519_generate_keypair() -> WasmX25519Keypair {
    let kp = x25519::generate_keypair();
    WasmX25519Keypair {
        secret_key: kp.secret_key_bytes().to_vec(),
        public_key: kp.public_key_bytes().to_vec(),
    }
}

/// Computes the X25519 raw shared secret. Callers MUST run this through HKDF
/// before using it as keying material.
#[wasm_bindgen]
pub fn x25519_diffie_hellman(secret_key: &[u8], peer_public_key: &[u8]) -> Result<Vec<u8>, JsError> {
    x25519::diffie_hellman(secret_key, peer_public_key)
        .map(|s| s.to_vec())
        .map_err(js_err)
}

// ---------------------------------------------------------------------------
// HKDF-SHA256
// ---------------------------------------------------------------------------

/// `HKDF-Extract(salt, IKM)` — returns the 32-byte PRK.
#[wasm_bindgen]
pub fn hkdf_sha256_extract(salt: &[u8], ikm: &[u8]) -> Vec<u8> {
    hkdf_sha256::extract(salt, ikm).to_vec()
}

/// `HKDF-Expand(PRK, info, length)`.
#[wasm_bindgen]
pub fn hkdf_sha256_expand(prk: &[u8], info: &[u8], length: usize) -> Result<Vec<u8>, JsError> {
    hkdf_sha256::expand(prk, info, length).map_err(js_err)
}

/// Combined extract + expand HKDF-SHA256 derivation.
#[wasm_bindgen]
pub fn hkdf_sha256_derive(
    salt: &[u8],
    ikm: &[u8],
    info: &[u8],
    length: usize,
) -> Result<Vec<u8>, JsError> {
    hkdf_sha256::derive(salt, ikm, info, length).map_err(js_err)
}

// ---------------------------------------------------------------------------
// Hashing
// ---------------------------------------------------------------------------

/// BLAKE3 hash of `data`.
#[wasm_bindgen]
pub fn blake3_hash_bytes(data: &[u8]) -> Vec<u8> {
    blake3_hash::hash(data).to_vec()
}

/// BLAKE3 keyed hash.
#[wasm_bindgen]
pub fn blake3_keyed_hash(key: &[u8], data: &[u8]) -> Result<Vec<u8>, JsError> {
    blake3_hash::keyed_hash(key, data)
        .map(|h| h.to_vec())
        .map_err(js_err)
}

/// BLAKE3 KDF mode: `derive_key(context, key_material)`.
#[wasm_bindgen]
pub fn blake3_derive_key(context: &str, key_material: &[u8]) -> Vec<u8> {
    blake3_hash::derive_key(context, key_material).to_vec()
}

/// SHA-256 hash of `data`.
#[wasm_bindgen]
pub fn sha256(data: &[u8]) -> Vec<u8> {
    sha::sha256(data).to_vec()
}

/// SHA-512 hash of `data`.
#[wasm_bindgen]
pub fn sha512(data: &[u8]) -> Vec<u8> {
    sha::sha512(data).to_vec()
}

// ---------------------------------------------------------------------------
// AEAD
// ---------------------------------------------------------------------------

/// AES-256-GCM encryption. Returns `ciphertext || tag`.
#[wasm_bindgen]
pub fn aes256gcm_encrypt(
    key: &[u8],
    nonce: &[u8],
    plaintext: &[u8],
    aad: &[u8],
) -> Result<Vec<u8>, JsError> {
    aead::aes256gcm_encrypt(key, nonce, plaintext, aad).map_err(js_err)
}

/// AES-256-GCM decryption.
#[wasm_bindgen]
pub fn aes256gcm_decrypt(
    key: &[u8],
    nonce: &[u8],
    ciphertext: &[u8],
    aad: &[u8],
) -> Result<Vec<u8>, JsError> {
    aead::aes256gcm_decrypt(key, nonce, ciphertext, aad).map_err(js_err)
}

/// XChaCha20-Poly1305 encryption.
#[wasm_bindgen]
pub fn xchacha20poly1305_encrypt(
    key: &[u8],
    nonce: &[u8],
    plaintext: &[u8],
    aad: &[u8],
) -> Result<Vec<u8>, JsError> {
    aead::xchacha20poly1305_encrypt(key, nonce, plaintext, aad).map_err(js_err)
}

/// XChaCha20-Poly1305 decryption.
#[wasm_bindgen]
pub fn xchacha20poly1305_decrypt(
    key: &[u8],
    nonce: &[u8],
    ciphertext: &[u8],
    aad: &[u8],
) -> Result<Vec<u8>, JsError> {
    aead::xchacha20poly1305_decrypt(key, nonce, ciphertext, aad).map_err(js_err)
}

// ---------------------------------------------------------------------------
// Argon2id
// ---------------------------------------------------------------------------

/// Hashes `password` with Argon2id, returning a PHC-format string.
#[wasm_bindgen]
pub fn argon2id_hash_password(password: &[u8]) -> Result<String, JsError> {
    kdf_password::hash_password(password).map_err(js_err)
}

/// Verifies a password against a PHC-format Argon2id hash.
#[wasm_bindgen]
pub fn argon2id_verify_password(password: &[u8], encoded_hash: &str) -> Result<bool, JsError> {
    kdf_password::verify_password(password, encoded_hash).map_err(js_err)
}

// ---------------------------------------------------------------------------
// JCS, multibase, ct
// ---------------------------------------------------------------------------

/// JCS canonicalization (RFC 8785) of a JSON string.
#[wasm_bindgen]
pub fn jcs_canonicalize(json: &str) -> Result<Vec<u8>, JsError> {
    jcs::canonicalize(json).map_err(js_err)
}

/// Multibase base58btc encode.
#[wasm_bindgen]
pub fn multibase_base58btc_encode(bytes: &[u8]) -> String {
    encoding::encode(bytes)
}

/// Multibase base58btc decode.
#[wasm_bindgen]
pub fn multibase_base58btc_decode(input: &str) -> Result<Vec<u8>, JsError> {
    encoding::decode(input).map_err(js_err)
}

/// Constant-time byte equality. Returns `false` for slices of differing length.
#[wasm_bindgen]
pub fn ct_eq(a: &[u8], b: &[u8]) -> bool {
    ct::ct_eq(a, b)
}

/// Returns `n` cryptographically random bytes.
#[wasm_bindgen]
pub fn random_bytes(n: usize) -> Result<Vec<u8>, JsError> {
    ct::random_bytes(n).map_err(js_err)
}

// ---------------------------------------------------------------------------
// FROST
// ---------------------------------------------------------------------------
//
// FROST inputs and outputs are JSON-shaped because they contain repeated
// per-participant byte vectors. We expose the JSON form (`String`) on the WASM
// boundary so that the TS client can use the typed shapes from its own SDK
// without depending on `serde_wasm_bindgen` or any extra runtime helper.

/// Generates a t-of-n FROST key share bundle (trusted dealer).
///
/// Returns a JSON string of [`KeyShareBundle`](crate::frost::KeyShareBundle).
#[wasm_bindgen]
pub fn frost_trusted_keygen(min_signers: u16, max_signers: u16) -> Result<String, JsError> {
    let bundle = frost::trusted_keygen(min_signers, max_signers).map_err(js_err)?;
    serde_json::to_string(&bundle).map_err(js_err)
}

/// FROST round 1 for a single participant. Returns JSON of [`Round1Output`](crate::frost::Round1Output).
#[wasm_bindgen]
pub fn frost_sign_round1(serialized_key_package: &[u8]) -> Result<String, JsError> {
    let r1 = frost::sign_round1(serialized_key_package).map_err(js_err)?;
    serde_json::to_string(&r1).map_err(js_err)
}

/// FROST round 2 for a single participant.
///
/// `commitments_json` is a JSON array of
/// [`ParticipantCommitments`](crate::frost::ParticipantCommitments).
#[wasm_bindgen]
pub fn frost_sign_round2(
    serialized_key_package: &[u8],
    serialized_nonces: &[u8],
    message: &[u8],
    commitments_json: &str,
) -> Result<Vec<u8>, JsError> {
    let commitments: Vec<frost::ParticipantCommitments> =
        serde_json::from_str(commitments_json).map_err(js_err)?;
    frost::sign_round2(serialized_key_package, serialized_nonces, message, &commitments)
        .map_err(js_err)
}

/// FROST aggregation: combine signature shares into a 64-byte Ed25519 signature.
#[wasm_bindgen]
pub fn frost_aggregate(
    message: &[u8],
    commitments_json: &str,
    shares_json: &str,
    serialized_public_key_package: &[u8],
) -> Result<Vec<u8>, JsError> {
    let commitments: Vec<frost::ParticipantCommitments> =
        serde_json::from_str(commitments_json).map_err(js_err)?;
    let shares: Vec<frost::ParticipantShare> =
        serde_json::from_str(shares_json).map_err(js_err)?;
    frost::aggregate(message, &commitments, &shares, serialized_public_key_package).map_err(js_err)
}

/// Verifies a FROST signature. Throws on failure.
#[wasm_bindgen]
pub fn frost_verify(message: &[u8], signature: &[u8], group_public_key: &[u8]) -> Result<(), JsError> {
    frost::verify(message, signature, group_public_key).map_err(js_err)
}

/// Returns the crate version string.
#[wasm_bindgen]
pub fn version() -> String {
    crate::VERSION.to_string()
}
