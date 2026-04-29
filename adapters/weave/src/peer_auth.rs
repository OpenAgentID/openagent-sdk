// Copyright (c) 2026 L1fe Labs, Inc. — Apache-2.0 OR MIT
//! Per-peer authentication state tracking.
//!
//! After a successful OAAP handshake, the peer's authentication state is stored
//! so subsequent protocol streams are recognized as authenticated.

use std::collections::HashMap;
use std::sync::{Arc, RwLock};
use std::time::Instant;

use libp2p::PeerId;

use crate::error::WeaveAuthError;

/// Authentication state for a single peer.
#[derive(Debug, Clone)]
pub struct PeerAuthState {
    /// The authenticated DID of the peer.
    pub did: String,
    /// The session ID from the ESTABLISHED step.
    pub session_id: String,
    /// When the session was established.
    pub established_at: Instant,
    /// When the session expires.
    pub expires_at: Instant,
    /// Current state of the handshake.
    pub phase: HandshakePhase,
}

/// Which phase of the handshake this peer is in.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum HandshakePhase {
    /// PRESENT sent, awaiting CHALLENGE.
    PresentSent,
    /// CHALLENGE issued by us, awaiting PROVE.
    ChallengeIssued,
    /// PROVE sent, awaiting ESTABLISHED.
    ProveSent,
    /// Handshake complete.
    Established,
}

impl PeerAuthState {
    /// Returns `true` if the session is established and not expired.
    pub fn is_valid(&self) -> bool {
        self.phase == HandshakePhase::Established && Instant::now() < self.expires_at
    }

    /// Returns `true` if the session has expired.
    pub fn is_expired(&self) -> bool {
        Instant::now() >= self.expires_at
    }
}

/// Thread-safe store for per-peer authentication state.
///
/// Keyed by libp2p `PeerId`. Handles concurrent access from the swarm event
/// loop and application code.
#[derive(Debug, Clone, Default)]
pub struct PeerAuthStore {
    inner: Arc<RwLock<HashMap<PeerId, PeerAuthState>>>,
}

impl PeerAuthStore {
    /// Creates a new empty peer auth store.
    pub fn new() -> Self {
        Self::default()
    }

    /// Record or update a peer's auth state.
    pub fn put(&self, peer: PeerId, state: PeerAuthState) -> Result<(), WeaveAuthError> {
        let mut map = self
            .inner
            .write()
            .map_err(|e| WeaveAuthError::Internal(format!("peer auth lock poisoned: {e}")))?;
        map.insert(peer, state);
        Ok(())
    }

    /// Retrieve a peer's auth state.
    pub fn get(&self, peer: &PeerId) -> Result<Option<PeerAuthState>, WeaveAuthError> {
        let map = self
            .inner
            .read()
            .map_err(|e| WeaveAuthError::Internal(format!("peer auth lock poisoned: {e}")))?;
        Ok(map.get(peer).cloned())
    }

    /// Remove a peer's auth state (on disconnect or session revocation).
    pub fn remove(&self, peer: &PeerId) -> Result<(), WeaveAuthError> {
        let mut map = self
            .inner
            .write()
            .map_err(|e| WeaveAuthError::Internal(format!("peer auth lock poisoned: {e}")))?;
        map.remove(peer);
        Ok(())
    }

    /// Returns `true` if the peer has a valid, non-expired established session.
    pub fn is_authenticated(&self, peer: &PeerId) -> bool {
        self.get(peer)
            .ok()
            .flatten()
            .map_or(false, |s| s.is_valid())
    }

    /// Remove all expired sessions. Returns the number removed.
    pub fn gc_expired(&self) -> Result<usize, WeaveAuthError> {
        let mut map = self
            .inner
            .write()
            .map_err(|e| WeaveAuthError::Internal(format!("peer auth lock poisoned: {e}")))?;
        let before = map.len();
        map.retain(|_, state| !state.is_expired());
        Ok(before - map.len())
    }

    /// Returns the number of peers in the store.
    pub fn len(&self) -> usize {
        self.inner.read().map_or(0, |m| m.len())
    }

    /// Returns `true` if the store has no entries.
    pub fn is_empty(&self) -> bool {
        self.len() == 0
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::time::Duration;

    fn test_peer_id() -> PeerId {
        PeerId::random()
    }

    #[test]
    fn put_and_get_peer_auth() {
        let store = PeerAuthStore::new();
        let peer = test_peer_id();
        let state = PeerAuthState {
            did: "did:oas:test:agent:alice".into(),
            session_id: "sess-001".into(),
            established_at: Instant::now(),
            expires_at: Instant::now() + Duration::from_secs(3600),
            phase: HandshakePhase::Established,
        };

        store.put(peer, state).unwrap_or_else(|e| panic!("put failed: {e}"));
        let retrieved = store.get(&peer).unwrap_or_else(|e| panic!("get failed: {e}"));
        assert!(retrieved.is_some());
        let s = retrieved.unwrap_or_else(|| panic!("expected Some"));
        assert_eq!(s.did, "did:oas:test:agent:alice");
        assert!(s.is_valid());
    }

    #[test]
    fn is_authenticated_returns_true_for_established() {
        let store = PeerAuthStore::new();
        let peer = test_peer_id();
        let state = PeerAuthState {
            did: "did:oas:test:agent:bob".into(),
            session_id: "sess-002".into(),
            established_at: Instant::now(),
            expires_at: Instant::now() + Duration::from_secs(3600),
            phase: HandshakePhase::Established,
        };
        store.put(peer, state).unwrap_or_else(|e| panic!("{e}"));
        assert!(store.is_authenticated(&peer));
    }

    #[test]
    fn is_authenticated_returns_false_for_pending() {
        let store = PeerAuthStore::new();
        let peer = test_peer_id();
        let state = PeerAuthState {
            did: "did:oas:test:agent:carol".into(),
            session_id: "sess-003".into(),
            established_at: Instant::now(),
            expires_at: Instant::now() + Duration::from_secs(3600),
            phase: HandshakePhase::ChallengeIssued,
        };
        store.put(peer, state).unwrap_or_else(|e| panic!("{e}"));
        assert!(!store.is_authenticated(&peer));
    }

    #[test]
    fn remove_clears_peer() {
        let store = PeerAuthStore::new();
        let peer = test_peer_id();
        let state = PeerAuthState {
            did: "did:oas:test:agent:dave".into(),
            session_id: "sess-004".into(),
            established_at: Instant::now(),
            expires_at: Instant::now() + Duration::from_secs(3600),
            phase: HandshakePhase::Established,
        };
        store.put(peer, state).unwrap_or_else(|e| panic!("{e}"));
        store.remove(&peer).unwrap_or_else(|e| panic!("{e}"));
        assert!(!store.is_authenticated(&peer));
    }

    #[test]
    fn gc_expired_removes_stale_entries() {
        let store = PeerAuthStore::new();
        let peer = test_peer_id();
        let state = PeerAuthState {
            did: "did:oas:test:agent:expired".into(),
            session_id: "sess-005".into(),
            established_at: Instant::now() - Duration::from_secs(7200),
            // Already expired.
            expires_at: Instant::now() - Duration::from_secs(1),
            phase: HandshakePhase::Established,
        };
        store.put(peer, state).unwrap_or_else(|e| panic!("{e}"));
        let removed = store.gc_expired().unwrap_or_else(|e| panic!("{e}"));
        assert_eq!(removed, 1);
        assert!(store.is_empty());
    }
}
