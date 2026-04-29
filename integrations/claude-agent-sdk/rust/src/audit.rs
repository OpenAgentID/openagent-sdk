//! Hash-chained audit log.

use std::sync::Mutex;

use async_trait::async_trait;
use serde::{Deserialize, Serialize};
use time::OffsetDateTime;

use crate::error::Result;
use crate::hash::{canonical_json, hash_hex};

/// Sentinel for the head of the chain (64 zero hex chars).
pub const GENESIS_PREV_HASH: &str =
    "0000000000000000000000000000000000000000000000000000000000000000";

/// Categories of audit events.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum AuditKind {
    /// Session lifecycle: opened.
    SessionStart,
    /// Session lifecycle: closed.
    SessionStop,
    /// Tool call preflight (pre-execution scope check).
    ToolPreflight,
    /// Tool call completed.
    ToolComplete,
    /// Skill invocation preflight (policy check before body runs).
    SkillPreflight,
    /// Skill invocation completed.
    SkillComplete,
    /// Outbound / inbound message audit.
    MessageSigned,
    /// Generic policy denial.
    PolicyDeny,
}

/// Outcome of an audited operation.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Outcome {
    /// Operation was allowed (gating check).
    Allow,
    /// Operation was denied (gating check).
    Deny,
    /// Operation completed successfully.
    Ok,
    /// Operation failed.
    Error,
}

/// One audit record. Hash chained via `prev_hash` -> `hash`.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AuditRecord {
    /// Monotonic sequence within the session.
    pub seq: u64,
    /// ISO-8601 timestamp.
    pub timestamp: String,
    /// Session id.
    pub session_id: String,
    /// Agent DID.
    pub agent_did: String,
    /// Event category.
    pub kind: AuditKind,
    /// Tool / skill name when applicable.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub name: Option<String>,
    /// Outcome of the operation.
    pub outcome: Outcome,
    /// Hash of the request payload.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub input_hash: Option<String>,
    /// Hash of the response payload.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub output_hash: Option<String>,
    /// Pointer to the previous record's `hash` field.
    pub prev_hash: String,
    /// This record's hash (computed from every field except `hash` itself).
    pub hash: String,
    /// Free-form context.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub context: Option<serde_json::Value>,
}

/// Audit sink trait — implement to ship records to a durable backend.
#[async_trait]
pub trait AuditSink: Send + Sync {
    /// Append a single record. MUST be best-effort and non-throwing.
    async fn append(&self, record: AuditRecord);
}

/// Builds and signs (hash-chains) audit records for a single session.
pub struct AuditChain {
    seq: Mutex<u64>,
    prev_hash: Mutex<String>,
    sink: std::sync::Arc<dyn AuditSink>,
    session_id: String,
    agent_did: String,
}

impl AuditChain {
    /// Construct a new chain rooted at the genesis prev hash.
    pub fn new(
        session_id: impl Into<String>,
        agent_did: impl Into<String>,
        sink: std::sync::Arc<dyn AuditSink>,
    ) -> Self {
        Self {
            seq: Mutex::new(0),
            prev_hash: Mutex::new(GENESIS_PREV_HASH.to_string()),
            sink,
            session_id: session_id.into(),
            agent_did: agent_did.into(),
        }
    }

    /// Append a record. Sink errors are swallowed by design.
    pub async fn append(
        &self,
        kind: AuditKind,
        name: Option<&str>,
        outcome: Outcome,
        input_hash: Option<String>,
        output_hash: Option<String>,
        context: Option<serde_json::Value>,
    ) -> Result<AuditRecord> {
        let seq = {
            let mut s = self.seq.lock().map_err(|e| {
                crate::error::Error::Config(format!("audit seq lock poisoned: {e}"))
            })?;
            *s += 1;
            *s
        };
        let prev = {
            let p = self.prev_hash.lock().map_err(|e| {
                crate::error::Error::Config(format!("audit prev_hash lock poisoned: {e}"))
            })?;
            p.clone()
        };
        let mut record = AuditRecord {
            seq,
            timestamp: now_iso8601(),
            session_id: self.session_id.clone(),
            agent_did: self.agent_did.clone(),
            kind,
            name: name.map(ToString::to_string),
            outcome,
            input_hash,
            output_hash,
            prev_hash: prev,
            hash: String::new(),
            context,
        };
        record.hash = hash_record(&record)?;
        {
            let mut p = self.prev_hash.lock().map_err(|e| {
                crate::error::Error::Config(format!("audit prev_hash lock poisoned: {e}"))
            })?;
            *p = record.hash.clone();
        }
        self.sink.append(record.clone()).await;
        Ok(record)
    }

    /// Current chain head.
    pub fn head(&self) -> String {
        self.prev_hash
            .lock()
            .map(|p| p.clone())
            .unwrap_or_else(|_| GENESIS_PREV_HASH.to_string())
    }
}

/// Compute the hash of a record (excludes the `hash` field itself).
pub fn hash_record(record: &AuditRecord) -> Result<String> {
    let mut value = serde_json::to_value(record)?;
    if let serde_json::Value::Object(map) = &mut value {
        map.remove("hash");
    }
    let canon = canonical_json(&value)?;
    Ok(hash_hex(canon.as_bytes()))
}

/// Verify a previously emitted chain.
pub fn verify_chain(records: &[AuditRecord]) -> Result<()> {
    let mut prev = GENESIS_PREV_HASH.to_string();
    for (i, r) in records.iter().enumerate() {
        if r.prev_hash != prev {
            return Err(crate::error::Error::AuditBroken { index: i });
        }
        let expected = hash_record(r)?;
        if expected != r.hash {
            return Err(crate::error::Error::AuditBroken { index: i });
        }
        prev = r.hash.clone();
    }
    Ok(())
}

/// In-memory audit sink (handy for tests + dev).
#[derive(Debug, Default)]
pub struct InMemoryAuditSink {
    records: Mutex<Vec<AuditRecord>>,
}

impl InMemoryAuditSink {
    /// Construct a new in-memory sink.
    pub fn new() -> Self {
        Self::default()
    }

    /// Snapshot the buffered records (test helper).
    pub fn snapshot(&self) -> Vec<AuditRecord> {
        self.records
            .lock()
            .map(|r| r.clone())
            .unwrap_or_default()
    }
}

#[async_trait]
impl AuditSink for InMemoryAuditSink {
    async fn append(&self, record: AuditRecord) {
        if let Ok(mut r) = self.records.lock() {
            r.push(record);
        }
    }
}

/// Fan-out sink: dispatch each record to every inner sink.
pub struct FanOutAuditSink {
    sinks: Vec<std::sync::Arc<dyn AuditSink>>,
}

impl FanOutAuditSink {
    /// Construct a new fan-out sink.
    pub fn new(sinks: Vec<std::sync::Arc<dyn AuditSink>>) -> Self {
        Self { sinks }
    }
}

#[async_trait]
impl AuditSink for FanOutAuditSink {
    async fn append(&self, record: AuditRecord) {
        for s in &self.sinks {
            s.append(record.clone()).await;
        }
    }
}

fn now_iso8601() -> String {
    OffsetDateTime::now_utc()
        .format(&time::format_description::well_known::Rfc3339)
        .unwrap_or_else(|_| String::from("1970-01-01T00:00:00Z"))
}
