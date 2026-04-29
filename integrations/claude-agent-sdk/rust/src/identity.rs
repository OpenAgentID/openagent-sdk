//! OpenAgent identity abstraction.
//!
//! Production code wraps an [`openagent_sdk::OpenAgent`] via
//! [`OpenAgentSdkIdentity`]. Tests can use [`Identity`], a deterministic
//! in-process implementation.

use async_trait::async_trait;

use crate::error::{Error, Result};

/// A signing key + DID, structurally compatible with the OAS identity
/// surface. Implementations must NOT expose the secret key directly —
/// signing operations go through the [`OpenAgentIdentity::sign`] method.
#[async_trait]
pub trait OpenAgentIdentity: Send + Sync {
    /// The fully-qualified DID, e.g. `did:oas:test:agent:foo`.
    fn did(&self) -> &str;

    /// Entity kind: `hmr`, `mhr`, `agent`, `tool`, `skill`, ...
    fn kind(&self) -> &str;

    /// 32-byte Ed25519 public key. Returned by value (32 bytes is cheap)
    /// so adapters that wrap an external SDK don't need to cache.
    fn public_key(&self) -> [u8; 32];

    /// Optional lineage chain (HMR -> ... -> this agent).
    fn lineage(&self) -> Vec<String> {
        Vec::new()
    }

    /// Sign a payload. Implementations must never log or expose the key.
    async fn sign(&self, payload: &[u8]) -> Result<Vec<u8>>;
}

/// Default in-process identity used by tests and dev harnesses.
///
/// Signing is intentionally a deterministic stub — production deployments
/// must replace this with an OAS-backed implementation that holds a real
/// Ed25519 key.
#[derive(Debug, Clone)]
pub struct Identity {
    did: String,
    kind: String,
    public_key: [u8; 32],
    lineage: Vec<String>,
}

impl Identity {
    /// Construct a new identity.
    pub fn new(did: impl Into<String>, kind: impl Into<String>, public_key: [u8; 32]) -> Self {
        Self {
            did: did.into(),
            kind: kind.into(),
            public_key,
            lineage: Vec::new(),
        }
    }

    /// Set the lineage chain (builder).
    #[must_use]
    pub fn with_lineage(mut self, lineage: Vec<String>) -> Self {
        self.lineage = lineage;
        self
    }
}

#[async_trait]
impl OpenAgentIdentity for Identity {
    fn did(&self) -> &str {
        &self.did
    }
    fn kind(&self) -> &str {
        &self.kind
    }
    fn public_key(&self) -> [u8; 32] {
        self.public_key
    }
    fn lineage(&self) -> Vec<String> {
        self.lineage.clone()
    }

    async fn sign(&self, payload: &[u8]) -> Result<Vec<u8>> {
        // Deterministic stub: a 64-byte fold over the payload bytes. NOT a
        // cryptographic signature — replace with an Ed25519 signer in
        // production. Returns an Err on empty payloads so the API surface
        // can demonstrate proper error handling.
        if payload.is_empty() {
            return Err(Error::Sign("empty payload".into()));
        }
        let mut out = vec![0u8; 64];
        for (i, b) in payload.iter().enumerate() {
            let idx = i % 64;
            out[idx] = out[idx].wrapping_add(*b);
        }
        Ok(out)
    }
}

/// Adapter that exposes an [`openagent_sdk::OpenAgent`] as an
/// [`OpenAgentIdentity`].
///
/// This is the production wiring: hand the plugin an `OpenAgent` built
/// via `OpenAgentBuilder` and it will pull DID, public key, and Ed25519
/// signing through the wrapped SDK.
pub struct OpenAgentSdkIdentity {
    inner: openagent_sdk::OpenAgent,
}

impl OpenAgentSdkIdentity {
    /// Wrap an existing `openagent_sdk::OpenAgent`.
    pub fn new(inner: openagent_sdk::OpenAgent) -> Self {
        Self { inner }
    }

    /// Borrow the underlying SDK agent (escape hatch for advanced users).
    pub fn inner(&self) -> &openagent_sdk::OpenAgent {
        &self.inner
    }
}

#[async_trait]
impl OpenAgentIdentity for OpenAgentSdkIdentity {
    fn did(&self) -> &str {
        self.inner.did()
    }

    fn kind(&self) -> &str {
        // OAS DIDs follow `did:oas:<namespace>:<kind>:<id>`. Extract the
        // kind segment defensively without panicking.
        self.inner.did().split(':').nth(3).unwrap_or("agent")
    }

    fn public_key(&self) -> [u8; 32] {
        self.inner.keypair().verifying_key_bytes()
    }

    async fn sign(&self, payload: &[u8]) -> Result<Vec<u8>> {
        if payload.is_empty() {
            return Err(Error::Sign("empty payload".into()));
        }
        Ok(self.inner.keypair().sign(payload))
    }
}
