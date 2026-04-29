//! Hash-chained invocation receipts.
//!
//! Every successful `record_invocation` call produces a [`Receipt`] and
//! extends a BLAKE3 hash chain. The chain head is the most recent receipt's
//! hash; each new receipt hashes over `previous_hash || canonical_payload`
//! so that tampering with any past entry invalidates every subsequent hash.
//!
//! This is deliberately the same shape as Arsenal's audit log so that
//! downstream consumers (forensics tools, SIEM exporters) can use a single
//! verification routine.

use std::fmt;

use serde::{Deserialize, Serialize};
use time::OffsetDateTime;

use crate::policy::AuditLevel;

/// Length of a BLAKE3 hash in bytes.
pub const HASH_LEN: usize = 32;

/// A hex-encoded hash (used for JSON-friendly serialization).
#[derive(Clone, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(transparent)]
pub struct HashHex(String);

impl HashHex {
    /// Build from raw bytes.
    #[must_use]
    pub fn from_bytes(bytes: &[u8; HASH_LEN]) -> Self {
        Self(hex::encode(bytes))
    }

    /// Return the hex string.
    #[must_use]
    pub fn as_str(&self) -> &str {
        &self.0
    }
}

impl fmt::Debug for HashHex {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "HashHex({})", self.0)
    }
}

impl fmt::Display for HashHex {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "{}", self.0)
    }
}

/// A single invocation receipt.
///
/// Receipts are immutable. New invocations produce new receipts rather than
/// mutating existing ones.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Receipt {
    /// Monotonically increasing sequence number, starting at 0.
    pub sequence: u64,
    /// Skill that was invoked.
    pub skill: String,
    /// DID of the invoking agent.
    pub agent: String,
    /// Session ID the invocation happened under.
    pub session: String,
    /// When the invocation was recorded (UTC, RFC 3339).
    pub invoked_at: String,
    /// Audit level applied when recording.
    pub audit_level: AuditLevel,
    /// Hash of the arguments (always present; the argument payload itself is
    /// only included when `audit_level = Full`).
    pub arguments_hash: HashHex,
    /// Full arguments JSON — only populated when `audit_level = Full`.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub arguments: Option<serde_json::Value>,
    /// Hash of the previous receipt in the chain (or zero for the first).
    pub previous_hash: HashHex,
    /// Hash of *this* receipt — computed over all fields above plus
    /// `previous_hash`.
    pub receipt_hash: HashHex,
}

/// Append-only chain of invocation receipts.
#[derive(Debug, Default, Clone)]
pub struct AuditChain {
    receipts: Vec<Receipt>,
    head: [u8; HASH_LEN],
}

impl AuditChain {
    /// Create an empty chain.
    #[must_use]
    pub fn new() -> Self {
        Self::default()
    }

    /// Number of receipts in the chain.
    #[must_use]
    pub fn len(&self) -> usize {
        self.receipts.len()
    }

    /// Whether the chain is empty.
    #[must_use]
    pub fn is_empty(&self) -> bool {
        self.receipts.is_empty()
    }

    /// The current head hash (all-zero if the chain is empty).
    #[must_use]
    pub fn head(&self) -> HashHex {
        HashHex::from_bytes(&self.head)
    }

    /// Get a receipt by its sequence number.
    #[must_use]
    pub fn get(&self, sequence: u64) -> Option<&Receipt> {
        self.receipts.get(sequence as usize)
    }

    /// Iterate over all receipts in order.
    pub fn iter(&self) -> impl Iterator<Item = &Receipt> {
        self.receipts.iter()
    }

    /// Verify that every receipt's `receipt_hash` and `previous_hash`
    /// matches the recomputed chain. Returns `true` if intact.
    #[must_use]
    pub fn verify(&self) -> bool {
        let mut prev = [0u8; HASH_LEN];
        for r in &self.receipts {
            let got_prev = decode_hash(&r.previous_hash);
            if got_prev != prev {
                return false;
            }
            let canon = match canonical_payload(r) {
                Ok(c) => c,
                Err(_) => return false,
            };
            let expect = compute_receipt_hash(&prev, &canon);
            if decode_hash(&r.receipt_hash) != expect {
                return false;
            }
            prev = expect;
        }
        prev == self.head
    }

    /// Append a new receipt to the chain. Called only by the engine.
    pub(crate) fn append(
        &mut self,
        skill: &str,
        agent: &str,
        session: &str,
        invoked_at: OffsetDateTime,
        level: AuditLevel,
        arguments: &serde_json::Value,
    ) -> Result<Receipt, serde_json::Error> {
        let sequence = self.receipts.len() as u64;
        let invoked_at_str = format_iso(invoked_at);
        let args_hash_bytes = hash_arguments(arguments)?;
        let arguments_hash = HashHex::from_bytes(&args_hash_bytes);
        let arguments_field = match level {
            AuditLevel::Full => Some(arguments.clone()),
            AuditLevel::Hash | AuditLevel::None => None,
        };

        let mut draft = Receipt {
            sequence,
            skill: skill.to_string(),
            agent: agent.to_string(),
            session: session.to_string(),
            invoked_at: invoked_at_str,
            audit_level: level,
            arguments_hash,
            arguments: arguments_field,
            previous_hash: HashHex::from_bytes(&self.head),
            receipt_hash: HashHex::from_bytes(&[0u8; HASH_LEN]),
        };

        let canon = canonical_payload(&draft)?;
        let new_hash = compute_receipt_hash(&self.head, &canon);
        draft.receipt_hash = HashHex::from_bytes(&new_hash);
        self.head = new_hash;
        self.receipts.push(draft.clone());
        Ok(draft)
    }
}

fn canonical_payload(r: &Receipt) -> Result<Vec<u8>, serde_json::Error> {
    // Canonical form = JSON with fields in a stable order, `receipt_hash`
    // excluded (since we are computing it). We build a serde_json::Value
    // manually rather than rely on struct derives to keep the contract
    // independent of field reordering.
    let mut obj = serde_json::Map::new();
    obj.insert("sequence".to_string(), serde_json::json!(r.sequence));
    obj.insert("skill".to_string(), serde_json::json!(r.skill));
    obj.insert("agent".to_string(), serde_json::json!(r.agent));
    obj.insert("session".to_string(), serde_json::json!(r.session));
    obj.insert("invoked_at".to_string(), serde_json::json!(r.invoked_at));
    obj.insert(
        "audit_level".to_string(),
        serde_json::to_value(r.audit_level)?,
    );
    obj.insert(
        "arguments_hash".to_string(),
        serde_json::json!(r.arguments_hash.as_str()),
    );
    if let Some(ref a) = r.arguments {
        obj.insert("arguments".to_string(), a.clone());
    }
    obj.insert(
        "previous_hash".to_string(),
        serde_json::json!(r.previous_hash.as_str()),
    );
    serde_json::to_vec(&serde_json::Value::Object(obj))
}

fn compute_receipt_hash(prev: &[u8; HASH_LEN], payload: &[u8]) -> [u8; HASH_LEN] {
    let mut hasher = blake3::Hasher::new();
    hasher.update(prev);
    hasher.update(payload);
    let out = hasher.finalize();
    *out.as_bytes()
}

fn hash_arguments(value: &serde_json::Value) -> Result<[u8; HASH_LEN], serde_json::Error> {
    let bytes = serde_json::to_vec(value)?;
    let digest = blake3::hash(&bytes);
    Ok(*digest.as_bytes())
}

fn decode_hash(hex_str: &HashHex) -> [u8; HASH_LEN] {
    let mut out = [0u8; HASH_LEN];
    if let Ok(decoded) = hex::decode(hex_str.as_str()) {
        if decoded.len() == HASH_LEN {
            out.copy_from_slice(&decoded);
        }
    }
    out
}

fn format_iso(t: OffsetDateTime) -> String {
    // Use RFC 3339 / ISO 8601 with trailing Z.
    let format = time::format_description::well_known::Rfc3339;
    t.format(&format)
        .unwrap_or_else(|_| t.unix_timestamp().to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn ts() -> OffsetDateTime {
        OffsetDateTime::from_unix_timestamp(1_700_000_000).expect("ts")
    }

    #[test]
    fn empty_chain_head_is_zero() {
        let chain = AuditChain::new();
        assert_eq!(chain.head().as_str(), "0".repeat(64));
        assert!(chain.is_empty());
    }

    #[test]
    fn append_produces_verifiable_chain() {
        let mut chain = AuditChain::new();
        let args = serde_json::json!({ "component": "Button" });
        let r0 = chain
            .append(
                "frontend-design",
                "did:oas:l1fe:agent:a",
                "sess-1",
                ts(),
                AuditLevel::Hash,
                &args,
            )
            .expect("append");
        assert_eq!(r0.sequence, 0);
        assert_eq!(r0.previous_hash.as_str(), "0".repeat(64));

        let r1 = chain
            .append(
                "frontend-design",
                "did:oas:l1fe:agent:a",
                "sess-1",
                ts(),
                AuditLevel::Full,
                &args,
            )
            .expect("append");
        assert_eq!(r1.sequence, 1);
        assert_eq!(r1.previous_hash, r0.receipt_hash);
        assert!(r1.arguments.is_some());

        assert!(chain.verify());
    }

    #[test]
    fn tampering_breaks_verification() {
        let mut chain = AuditChain::new();
        let args = serde_json::json!({ "x": 1 });
        let _ = chain
            .append("s", "did:x:1", "sess", ts(), AuditLevel::Hash, &args)
            .expect("append");
        let _ = chain
            .append("s", "did:x:1", "sess", ts(), AuditLevel::Hash, &args)
            .expect("append");
        assert!(chain.verify());
        // Mutate a stored receipt.
        chain.receipts[0].skill = "malicious".to_string();
        assert!(!chain.verify());
    }

    #[test]
    fn audit_level_none_still_hashes_arguments() {
        let mut chain = AuditChain::new();
        let args = serde_json::json!({ "secret": "hunter2" });
        let r = chain
            .append("s", "did:x:1", "sess", ts(), AuditLevel::None, &args)
            .expect("append");
        assert!(r.arguments.is_none());
        assert_ne!(r.arguments_hash.as_str(), "0".repeat(64));
    }
}
