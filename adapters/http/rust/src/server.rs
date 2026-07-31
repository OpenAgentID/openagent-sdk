// Copyright (c) 2026 L1fe Labs, Inc. — Apache-2.0 OR MIT
//! Framework-agnostic server-side handlers for the Core Protocol identity
//! flow over HTTP.
//!
//! These functions implement the server half of the Section 15 identity flow:
//! issue an [`IdentityChallenge`], validate and verify an [`IdentityProof`],
//! and return an [`IdentityVerified`] session. Framework integrations (Axum,
//! others) call these with parsed bodies and render the results.
//!
//! Session tokens minted here are opaque 32-byte hex strings validated
//! through the session store. JWT minting per Core Protocol Section 12 is
//! `openagent-server`'s role; this adapter's tokens are for deployments that
//! keep session state in the store.

use base64::engine::general_purpose::URL_SAFE_NO_PAD as B64URL;
use base64::Engine;
use ed25519_dalek::{Signature, Verifier, VerifyingKey};

use openagent_auth_protocol::error::AuthProtocolError;
use openagent_auth_protocol::handshake;
use openagent_auth_protocol::message::{
    IdentityChallenge, IdentityProof, IdentityVerified, KeyType, TrustTier,
};
use openagent_auth_protocol::session::{Session, SessionState, SessionStore};
use openagent_auth_protocol::types::DiscoveryDocument;

/// Server configuration for the HTTP adapter.
#[derive(Debug, Clone)]
pub struct ServerConfig {
    /// The server's origin per RFC 6454 (`scheme://host[:port]`). Bound into
    /// every challenge the server issues.
    pub origin: String,
    /// Optional protection-space identifier.
    pub realm: Option<String>,
    /// The trust tier assigned to verified agents. Deployments with DID
    /// resolution and registry context assign higher tiers in their own
    /// policy layer; this adapter's default is key-possession-only.
    pub trust_tier: TrustTier,
    /// Session TTL in seconds.
    pub session_ttl_secs: u32,
    /// Challenge TTL in seconds.
    pub challenge_ttl_secs: u32,
}

impl ServerConfig {
    /// Creates a new server configuration with sensible defaults.
    pub fn new(origin: impl Into<String>) -> Self {
        Self {
            origin: origin.into(),
            realm: None,
            trust_tier: TrustTier::Anonymous,
            session_ttl_secs: handshake::DEFAULT_SESSION_TTL_SECS,
            challenge_ttl_secs: handshake::DEFAULT_CHALLENGE_TTL_SECS,
        }
    }

    /// Sets the protection-space identifier.
    pub fn with_realm(mut self, realm: impl Into<String>) -> Self {
        self.realm = Some(realm.into());
        self
    }

    /// Sets the trust tier assigned to verified agents.
    pub fn with_trust_tier(mut self, tier: TrustTier) -> Self {
        self.trust_tier = tier;
        self
    }

    /// Sets the session TTL.
    pub fn with_session_ttl(mut self, secs: u32) -> Self {
        self.session_ttl_secs = secs;
        self
    }

    /// Sets the challenge TTL.
    pub fn with_challenge_ttl(mut self, secs: u32) -> Self {
        self.challenge_ttl_secs = secs;
        self
    }
}

/// Handle `GET /.well-known/openagent` — returns the discovery document.
pub fn handle_discovery(config: &ServerConfig) -> DiscoveryDocument {
    DiscoveryDocument {
        auth_endpoint: handshake::AUTH_ENDPOINT_PATH.to_owned(),
        supported_versions: vec![1],
        server_did: config.origin.clone(),
        required_conformance_level: openagent_auth_protocol::types::ConformanceLevel::L2,
    }
}

/// Handle the challenge step — issue an [`IdentityChallenge`].
///
/// Creates a fresh challenge per Section 4 and records a pending session
/// keyed by the nonce, so the proof step can find exactly one challenge to
/// answer and a nonce can never be answered twice.
pub async fn handle_challenge<S: SessionStore>(
    config: &ServerConfig,
    store: &S,
) -> Result<IdentityChallenge, AuthProtocolError> {
    let nonce = handshake::generate_nonce()?;
    // One instant drives both the challenge timestamp and the session record:
    // the prove step reconstructs the signed challenge from the session, so
    // the two must agree to the second or a valid proof fails to verify.
    let now = chrono::Utc::now();
    let challenge = IdentityChallenge::new(
        nonce,
        now.format("%Y-%m-%dT%H:%M:%SZ").to_string(),
        config.origin.clone(),
        config.realm.clone(),
    );

    let session = Session {
        // The pending session is keyed by nonce: that is the correlation the
        // proof carries, and single-use-ness is enforced by removal.
        id: challenge.nonce.clone(),
        state: SessionState::AwaitingProof,
        initiator_did: String::new(),
        responder_did: config.origin.clone(),
        nonce: challenge.nonce.clone(),
        created_at: now,
        expires_at: now + chrono::Duration::seconds(i64::from(config.challenge_ttl_secs)),
        capabilities: vec![],
    };
    store.put(session).await?;

    Ok(challenge)
}

/// Handle the prove step — verify an [`IdentityProof`] and issue a session.
///
/// Verification is normative-ordered: shape checks first (nonce echo, key
/// length per scheme), then the pending challenge (present, unexpired), then
/// the signature over the JCS-canonical challenge bytes. The nonce is
/// consumed on success *and* on signature failure - a failed answer must not
/// be retryable, or a verifier becomes an oracle.
pub async fn handle_prove<S: SessionStore>(
    config: &ServerConfig,
    store: &S,
    proof: &IdentityProof,
) -> Result<IdentityVerified, AuthProtocolError> {
    // 1. Load the pending challenge by the echoed nonce.
    let session =
        store
            .get(&proof.nonce)
            .await?
            .ok_or_else(|| AuthProtocolError::ReplayDetected {
                nonce_hex: proof.nonce.clone(),
            })?;

    // 2. Expiry check; consume the nonce either way.
    if session.is_expired() {
        store.remove(&proof.nonce).await?;
        return Err(AuthProtocolError::ChallengeExpired {
            issued: session.created_at.to_rfc3339(),
            expiry: session.expires_at.to_rfc3339(),
            now: chrono::Utc::now().to_rfc3339(),
        });
    }

    // 3. Reconstruct the exact challenge that was issued and shape-check
    //    the proof against it.
    let challenge = IdentityChallenge::new(
        session.nonce.clone(),
        session.created_at.format("%Y-%m-%dT%H:%M:%SZ").to_string(),
        session.responder_did.clone(),
        config.realm.clone(),
    );
    handshake::validate_proof_shape(proof, &challenge)?;

    // 4. Verify the signature over the canonical challenge bytes. This
    //    server verifies Ed25519 only; a secp256k1 proof is refused with a
    //    named reason rather than misinterpreted.
    if proof.key_type != KeyType::Ed25519 {
        store.remove(&proof.nonce).await?;
        return Err(AuthProtocolError::InvalidProof {
            reason: format!("this server verifies ed25519 only; got {}", proof.key_type),
        });
    }

    let key_bytes: [u8; 32] = B64URL
        .decode(&proof.public_key)
        .map_err(|e| AuthProtocolError::InvalidProof {
            reason: format!("public_key is not valid base64url: {e}"),
        })?
        .try_into()
        .map_err(|_| AuthProtocolError::InvalidProof {
            reason: "public_key must decode to 32 bytes".to_string(),
        })?;
    let verifying_key =
        VerifyingKey::from_bytes(&key_bytes).map_err(|e| AuthProtocolError::InvalidProof {
            reason: format!("invalid Ed25519 public key: {e}"),
        })?;

    let sig_bytes: [u8; 64] = B64URL
        .decode(&proof.signature)
        .map_err(|e| AuthProtocolError::InvalidProof {
            reason: format!("signature is not valid base64url: {e}"),
        })?
        .try_into()
        .map_err(|_| AuthProtocolError::InvalidProof {
            reason: "signature must decode to 64 bytes".to_string(),
        })?;
    let signature = Signature::from_bytes(&sig_bytes);

    let payload = handshake::canonical_challenge_bytes(&challenge)?;

    let verified = verifying_key.verify(&payload, &signature);

    // The nonce is consumed on success and on failure alike.
    store.remove(&proof.nonce).await?;

    verified.map_err(|e| AuthProtocolError::SignatureVerificationFailed {
        reason: e.to_string(),
    })?;

    // 5. Establish: mint an opaque session token and store the session.
    let now = chrono::Utc::now();
    let session_expires = now + chrono::Duration::seconds(i64::from(config.session_ttl_secs));
    let session_token = generate_session_token();

    // The agent's DID: deployments that resolve DIDs do so above this layer;
    // the adapter reports the presented key as the subject placeholder until
    // a resolver names it.
    let subject_did = session.initiator_did.clone();

    let established = Session {
        id: session_token.clone(),
        state: SessionState::Established,
        initiator_did: subject_did.clone(),
        responder_did: session.responder_did.clone(),
        nonce: session.nonce.clone(),
        created_at: now,
        expires_at: session_expires,
        capabilities: session.capabilities.clone(),
    };
    store.put(established).await?;

    Ok(IdentityVerified {
        did: subject_did,
        trust_tier: config.trust_tier,
        session_token,
        session_expires: session_expires.format("%Y-%m-%dT%H:%M:%SZ").to_string(),
        capabilities: if session.capabilities.is_empty() {
            None
        } else {
            Some(session.capabilities)
        },
    })
}

/// Validate an authenticated request by checking the session store.
///
/// Looks up the session by its token, verifies it is established and not
/// expired, and returns it.
pub async fn validate_authenticated_request<S: SessionStore>(
    store: &S,
    session_token: &str,
) -> Result<Session, AuthProtocolError> {
    let session =
        store
            .get(session_token)
            .await?
            .ok_or_else(|| AuthProtocolError::SessionNotFound {
                session_id: session_token.to_owned(),
            })?;

    if session.state != SessionState::Established {
        return Err(AuthProtocolError::SessionNotFound {
            session_id: session_token.to_owned(),
        });
    }

    if session.is_expired() {
        store.remove(session_token).await?;
        return Err(AuthProtocolError::SessionExpired {
            session_id: session_token.to_owned(),
        });
    }

    Ok(session)
}

/// Opaque session token: 32 CSPRNG bytes as hex.
fn generate_session_token() -> String {
    let mut buf = [0u8; 32];
    rand::RngCore::fill_bytes(&mut rand::thread_rng(), &mut buf);
    hex::encode(buf)
}
