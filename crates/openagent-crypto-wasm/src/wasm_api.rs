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

use crate::{
    aead, blake3_hash, ct, ed25519, encoding, frost, hkdf_sha256, jcs, kdf_password, sha, x25519,
};

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
pub fn ed25519_verify(
    verifying_key: &[u8],
    message: &[u8],
    signature: &[u8],
) -> Result<(), JsError> {
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
pub fn x25519_diffie_hellman(
    secret_key: &[u8],
    peer_public_key: &[u8],
) -> Result<Vec<u8>, JsError> {
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
    frost::sign_round2(
        serialized_key_package,
        serialized_nonces,
        message,
        &commitments,
    )
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
    let shares: Vec<frost::ParticipantShare> = serde_json::from_str(shares_json).map_err(js_err)?;
    frost::aggregate(
        message,
        &commitments,
        &shares,
        serialized_public_key_package,
    )
    .map_err(js_err)
}

/// Verifies a FROST signature. Throws on failure.
#[wasm_bindgen]
pub fn frost_verify(
    message: &[u8],
    signature: &[u8],
    group_public_key: &[u8],
) -> Result<(), JsError> {
    frost::verify(message, signature, group_public_key).map_err(js_err)
}

/// Returns the crate version string.
#[wasm_bindgen]
pub fn version() -> String {
    crate::VERSION.to_string()
}

// ---------------------------------------------------------------------------
// Agent Capability Token (ACT) verification - the canonical format, verified
// in Rust so every TypeScript consumer shares one implementation of the rules.
// ---------------------------------------------------------------------------

/// Verifies an ACT envelope against the trusted key set and policy, and
/// returns the claims as a JSON string.
///
/// This is the full normative procedure from `agent-capability-token`, not a
/// re-implementation: envelope decode, version/algorithm checks, Ed25519
/// signature verification (checked **before** any claim, so an attacker
/// cannot plant unauthenticated claim content), temporal checks with leeway,
/// and issuer/audience/scope policy.
///
/// Arguments:
/// - `token_bytes`: the ACT envelope bytes (CBOR).
/// - `trusted_keys`: concatenated raw 32-byte Ed25519 public keys (exactly 32
///   bytes each, any count > 0). Keys are tried in order; `kid` is a hint for
///   audit, never authoritative for selection.
/// - `expected_issuer` / `expected_audience`: the policy bindings. Both are
///   required, deliberately: a verifier that does not bind the token's
///   intended audience accepts tokens meant for someone else.
/// - `required_scopes`: each entry a `service:resource:action` scope string
///   the token must grant; wildcards in the GRANT expand, in the REQUEST are
///   literal.
/// - `leeway_seconds`: symmetric clock-skew allowance on temporal checks.
/// - `now_unix_seconds`: 0 for the system clock, or a pinned time for tests
///   and for replaying a decision at a known instant.
///
/// Errors (thrown on the JS side) are the canonical `ActError` reasons, so a
/// forged token reports distinctly from an expired one and an unimplemented
/// format version distinctly from both.
#[wasm_bindgen]
pub fn act_verify(
    token_bytes: &[u8],
    trusted_keys: &[u8],
    expected_issuer: &str,
    expected_audience: &str,
    required_scopes: Vec<String>,
    leeway_seconds: i64,
    now_unix_seconds: i64,
) -> Result<String, JsError> {
    if trusted_keys.is_empty() || trusted_keys.len() % 32 != 0 {
        return Err(JsError::new(
            "trusted_keys must be a non-empty multiple of 32 bytes",
        ));
    }
    if expected_issuer.is_empty() || expected_audience.is_empty() {
        return Err(JsError::new(
            "expected_issuer and expected_audience are required",
        ));
    }
    let keys: Vec<[u8; 32]> = trusted_keys
        .chunks_exact(32)
        .map(|c| {
            let mut k = [0u8; 32];
            k.copy_from_slice(c);
            k
        })
        .collect();

    let mut verifier = agent_capability_token::Verifier::new(keys, expected_issuer, expected_audience)
        .map_err(js_err)?
        .with_leeway_seconds(leeway_seconds);

    if now_unix_seconds != 0 {
        verifier = verifier.with_clock(now_unix_seconds);
    }

    let scopes: Result<Vec<_>, _> = required_scopes
        .iter()
        .map(|s| agent_capability_token::Scope::parse(s))
        .collect();
    let scopes = scopes.map_err(js_err)?;
    if !scopes.is_empty() {
        verifier = verifier.requiring_scopes(scopes);
    }

    let claims = agent_capability_token::verify(token_bytes, &verifier).map_err(js_err)?;

    // The claims cross the boundary as JSON: the typed fields serialize
    // directly, and the ext map passes through with its values as raw CBOR
    // hex for the caller's own interpretation.
    serde_json::to_string(&claims)
        .map_err(|e| JsError::new(&format!("claims JSON serialization: {e}")))
}

/// Decodes an ACT envelope's claims WITHOUT verifying the signature, for
/// diagnostics and tooling. The returned string is prefixed so callers cannot
/// accidentally treat the contents as verified.
///
/// Never use this for authorization: unverified claims are attacker
/// controlled. Authorization decisions go through [`act_verify`].
#[wasm_bindgen]
pub fn act_decode_unverified(token_bytes: &[u8]) -> Result<String, JsError> {
    let envelope = agent_capability_token::ActEnvelope::decode(token_bytes).map_err(js_err)?;
    let claims_bytes: &[u8] = envelope.claims.as_ref();
    let claims: agent_capability_token::ActClaims =
        ciborium::from_reader(claims_bytes).map_err(js_err)?;
    let json = serde_json::to_string(&claims)
        .map_err(|e| JsError::new(&format!("claims JSON serialization: {e}")))?;
    Ok(format!("UNVERIFIED:{json}"))
}
