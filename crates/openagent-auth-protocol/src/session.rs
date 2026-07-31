// Copyright (c) 2026 L1fe Labs, Inc. — Apache-2.0 OR MIT
//! Session state management for authenticated Core Protocol connections.
//!
//! Server-side state for the identity flow: a session begins when a challenge
//! is issued and becomes usable when the proof verifies (Core Protocol
//! Specification, Section 12).

use std::collections::HashMap;
use std::sync::{Arc, RwLock};

use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};

use crate::error::AuthProtocolError;

/// Opaque session identifier (BLAKE3 of random bytes, hex-encoded).
pub type SessionId = String;

/// States a session transitions through during the handshake.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum SessionState {
    /// Challenge issued; waiting for PROVE.
    AwaitingProof,
    /// Handshake complete; session is usable.
    Established,
    /// Session revoked or expired.
    Closed,
}

/// An authenticated session between two agents.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Session {
    /// Unique session identifier.
    pub id: SessionId,
    /// Current handshake state.
    pub state: SessionState,
    /// DID of the initiator (client).
    pub initiator_did: String,
    /// DID of the responder (server).
    pub responder_did: String,
    /// Nonce issued in the CHALLENGE step.
    pub nonce: String,
    /// When the session was created.
    pub created_at: DateTime<Utc>,
    /// When the session expires.
    pub expires_at: DateTime<Utc>,
    /// Capabilities granted upon establishment.
    #[serde(default)]
    pub capabilities: Vec<String>,
}

impl Session {
    /// Returns `true` if the session has expired.
    pub fn is_expired(&self) -> bool {
        Utc::now() >= self.expires_at
    }

    /// Returns `true` if the session is established and not expired.
    pub fn is_valid(&self) -> bool {
        self.state == SessionState::Established && !self.is_expired()
    }
}

/// Trait for pluggable session storage backends.
///
/// Implementations must be `Send + Sync` for use with async runtimes.
#[async_trait::async_trait]
pub trait SessionStore: Send + Sync {
    /// Persist a new or updated session.
    async fn put(&self, session: Session) -> Result<(), AuthProtocolError>;
    /// Retrieve a session by its ID. Returns `None` if not found.
    async fn get(&self, id: &str) -> Result<Option<Session>, AuthProtocolError>;
    /// Remove a session by its ID.
    async fn remove(&self, id: &str) -> Result<(), AuthProtocolError>;
}

/// In-memory session store — suitable for tests and single-node deployments.
#[derive(Debug, Clone, Default)]
pub struct InMemorySessionStore {
    sessions: Arc<RwLock<HashMap<SessionId, Session>>>,
}

impl InMemorySessionStore {
    /// Creates a new empty session store.
    pub fn new() -> Self {
        Self::default()
    }
}

#[async_trait::async_trait]
impl SessionStore for InMemorySessionStore {
    async fn put(&self, session: Session) -> Result<(), AuthProtocolError> {
        let mut map = self
            .sessions
            .write()
            .map_err(|e| AuthProtocolError::Internal(format!("session lock poisoned: {e}")))?;
        map.insert(session.id.clone(), session);
        Ok(())
    }

    async fn get(&self, id: &str) -> Result<Option<Session>, AuthProtocolError> {
        let map = self
            .sessions
            .read()
            .map_err(|e| AuthProtocolError::Internal(format!("session lock poisoned: {e}")))?;
        Ok(map.get(id).cloned())
    }

    async fn remove(&self, id: &str) -> Result<(), AuthProtocolError> {
        let mut map = self
            .sessions
            .write()
            .map_err(|e| AuthProtocolError::Internal(format!("session lock poisoned: {e}")))?;
        map.remove(id);
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn put_and_get_session() {
        let store = InMemorySessionStore::new();
        let session = Session {
            id: "sess-001".into(),
            state: SessionState::AwaitingProof,
            initiator_did: "did:oas:test:agent:alice".into(),
            responder_did: "did:oas:test:agent:bob".into(),
            nonce: "test-nonce".into(),
            created_at: Utc::now(),
            expires_at: Utc::now() + chrono::Duration::hours(1),
            capabilities: vec![],
        };
        store.put(session.clone()).await.unwrap();
        let retrieved = store.get("sess-001").await.unwrap();
        assert!(retrieved.is_some());
        assert_eq!(retrieved.unwrap().initiator_did, "did:oas:test:agent:alice");
    }

    #[tokio::test]
    async fn get_missing_session_returns_none() {
        let store = InMemorySessionStore::new();
        let result = store.get("nonexistent").await.unwrap();
        assert!(result.is_none());
    }

    #[tokio::test]
    async fn remove_session() {
        let store = InMemorySessionStore::new();
        let session = Session {
            id: "sess-002".into(),
            state: SessionState::Established,
            initiator_did: "did:oas:test:agent:alice".into(),
            responder_did: "did:oas:test:agent:bob".into(),
            nonce: "nonce".into(),
            created_at: Utc::now(),
            expires_at: Utc::now() + chrono::Duration::hours(1),
            capabilities: vec![],
        };
        store.put(session).await.unwrap();
        store.remove("sess-002").await.unwrap();
        assert!(store.get("sess-002").await.unwrap().is_none());
    }

    #[test]
    fn expired_session_is_detected() {
        let session = Session {
            id: "sess-003".into(),
            state: SessionState::Established,
            initiator_did: "did:oas:test:agent:alice".into(),
            responder_did: "did:oas:test:agent:bob".into(),
            nonce: "nonce".into(),
            created_at: Utc::now() - chrono::Duration::hours(2),
            expires_at: Utc::now() - chrono::Duration::hours(1),
            capabilities: vec![],
        };
        assert!(session.is_expired());
        assert!(!session.is_valid());
    }

    #[test]
    fn valid_session_passes_check() {
        let session = Session {
            id: "sess-004".into(),
            state: SessionState::Established,
            initiator_did: "did:oas:test:agent:alice".into(),
            responder_did: "did:oas:test:agent:bob".into(),
            nonce: "nonce".into(),
            created_at: Utc::now(),
            expires_at: Utc::now() + chrono::Duration::hours(1),
            capabilities: vec![],
        };
        assert!(!session.is_expired());
        assert!(session.is_valid());
    }
}
