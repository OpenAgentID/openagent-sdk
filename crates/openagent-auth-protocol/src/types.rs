// Copyright (c) 2026 L1fe Labs, Inc. — Apache-2.0 OR MIT
//! Shared types for the OAAP protocol.
//!
//! Wire message types live in [`crate::message`]. This module contains the
//! supporting types referenced by messages and the post-handshake context.

use serde::{Deserialize, Serialize};

/// Conformance levels for entity classification (Bioagentic).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
pub enum ConformanceLevel {
    /// L0: Passive signals only (UA, TLS fingerprint).
    #[serde(rename = "L0")]
    L0,
    /// L1: Behavioral analysis (18-dim feature extraction).
    #[serde(rename = "L1")]
    L1,
    /// L2: Full cryptographic proof (Ed25519 / FIDO2).
    #[serde(rename = "L2")]
    L2,
}

impl ConformanceLevel {
    /// Returns the numeric ordering (L0=0, L1=1, L2=2).
    pub fn level(&self) -> u8 {
        match self {
            Self::L0 => 0,
            Self::L1 => 1,
            Self::L2 => 2,
        }
    }

    /// Returns true if `self` satisfies the `required` level.
    pub fn satisfies(&self, required: &Self) -> bool {
        self.level() >= required.level()
    }
}

impl std::fmt::Display for ConformanceLevel {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::L0 => write!(f, "L0"),
            Self::L1 => write!(f, "L1"),
            Self::L2 => write!(f, "L2"),
        }
    }
}

/// Minimal DID document fragment for the handshake.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DidDocument {
    /// Canonical DID (e.g. `did:oas:l1fe:agent:my-bot`).
    pub id: String,
    /// Multibase-encoded Ed25519 verification key.
    pub verification_key: String,
    /// Entity kind (`agent`, `tool`, `service`, etc.).
    pub kind: String,
    /// Optional parent DID for lineage.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub parent: Option<String>,
}

/// Cryptographic lineage proof linking an agent to its human root.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LineageProof {
    /// Chain of DID-to-DID attestations from the agent back to HMR.
    pub chain: Vec<LineageLink>,
}

/// A single link in the lineage chain.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LineageLink {
    /// DID of the parent (delegator).
    pub from: String,
    /// DID of the child (delegatee).
    pub to: String,
    /// Ed25519 signature by `from` over the delegation assertion.
    pub signature: String,
    /// ISO-8601 timestamp of the delegation.
    pub issued_at: String,
}

/// Server discovery response at `GET /.well-known/openagent`.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DiscoveryDocument {
    /// Auth endpoint path (default: `/.well-known/openagent/auth`).
    pub auth_endpoint: String,
    /// Supported protocol versions.
    pub supported_versions: Vec<u32>,
    /// Server's DID.
    pub server_did: String,
    /// Minimum conformance level required.
    pub required_conformance_level: ConformanceLevel,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn conformance_level_satisfies() {
        assert!(ConformanceLevel::L2.satisfies(&ConformanceLevel::L0));
        assert!(ConformanceLevel::L2.satisfies(&ConformanceLevel::L1));
        assert!(ConformanceLevel::L2.satisfies(&ConformanceLevel::L2));
        assert!(ConformanceLevel::L1.satisfies(&ConformanceLevel::L0));
        assert!(!ConformanceLevel::L0.satisfies(&ConformanceLevel::L1));
    }

    #[test]
    fn conformance_level_display() {
        assert_eq!(ConformanceLevel::L0.to_string(), "L0");
        assert_eq!(ConformanceLevel::L1.to_string(), "L1");
        assert_eq!(ConformanceLevel::L2.to_string(), "L2");
    }

    #[test]
    fn discovery_document_serializes() {
        let doc = DiscoveryDocument {
            auth_endpoint: "/.well-known/openagent/auth".into(),
            supported_versions: vec![1],
            server_did: "did:oas:l1fe:service:api".into(),
            required_conformance_level: ConformanceLevel::L2,
        };
        let json = serde_json::to_string(&doc);
        assert!(json.is_ok());
        let parsed: Result<DiscoveryDocument, _> = serde_json::from_str(&json.unwrap_or_default());
        assert!(parsed.is_ok());
    }

    #[test]
    fn did_document_round_trip() {
        let doc = DidDocument {
            id: "did:oas:l1fe:agent:test".into(),
            verification_key: "z6Mk...".into(),
            kind: "agent".into(),
            parent: Some("did:oas:l1fe:hmr:alice".into()),
        };
        let json = serde_json::to_string(&doc);
        assert!(json.is_ok());
    }
}
