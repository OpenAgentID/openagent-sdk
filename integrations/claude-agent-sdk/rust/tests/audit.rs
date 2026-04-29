//! Unit tests for the audit chain.
#![allow(clippy::expect_used)]
#![allow(clippy::unwrap_used)]
#![allow(clippy::panic)]

use std::sync::Arc;

use openagent_claude_agent::audit::{
    hash_record, verify_chain, AuditChain, AuditKind, FanOutAuditSink, InMemoryAuditSink,
    Outcome, GENESIS_PREV_HASH,
};

#[tokio::test]
async fn chain_links_records_via_prev_hash() {
    let sink = Arc::new(InMemoryAuditSink::new());
    let chain = AuditChain::new("s1", "did:oas:test:agent:x", sink.clone());
    chain
        .append(AuditKind::SessionStart, None, Outcome::Ok, None, None, None)
        .await
        .expect("append");
    chain
        .append(
            AuditKind::ToolPreflight,
            Some("bash"),
            Outcome::Allow,
            None,
            None,
            None,
        )
        .await
        .expect("append");
    chain
        .append(
            AuditKind::ToolComplete,
            Some("bash"),
            Outcome::Ok,
            None,
            None,
            None,
        )
        .await
        .expect("append");

    let records = sink.snapshot();
    assert_eq!(records.len(), 3);
    assert_eq!(records[0].prev_hash, GENESIS_PREV_HASH);
    assert_eq!(records[1].prev_hash, records[0].hash);
    assert_eq!(records[2].prev_hash, records[1].hash);
    verify_chain(&records).expect("chain should verify");
}

#[tokio::test]
async fn chain_detects_tampering() {
    let sink = Arc::new(InMemoryAuditSink::new());
    let chain = AuditChain::new("s1", "did:oas:test:agent:x", sink.clone());
    chain
        .append(AuditKind::SessionStart, None, Outcome::Ok, None, None, None)
        .await
        .expect("append");
    chain
        .append(
            AuditKind::ToolPreflight,
            Some("bash"),
            Outcome::Allow,
            None,
            None,
            None,
        )
        .await
        .expect("append");

    let mut records = sink.snapshot();
    if let Some(r) = records.get_mut(1) {
        r.name = Some("rm-rf".into());
    }
    let result = verify_chain(&records);
    assert!(result.is_err());
}

#[tokio::test]
async fn fan_out_dispatches_to_every_sink() {
    let a: Arc<InMemoryAuditSink> = Arc::new(InMemoryAuditSink::new());
    let b: Arc<InMemoryAuditSink> = Arc::new(InMemoryAuditSink::new());
    let fan = Arc::new(FanOutAuditSink::new(vec![a.clone(), b.clone()]));
    let chain = AuditChain::new("s", "did:oas:test:x", fan);
    chain
        .append(AuditKind::SessionStart, None, Outcome::Ok, None, None, None)
        .await
        .expect("append");
    assert_eq!(a.snapshot().len(), 1);
    assert_eq!(b.snapshot().len(), 1);
}

#[test]
fn hash_record_excludes_hash_field() {
    let mut r = openagent_claude_agent::audit::AuditRecord {
        seq: 1,
        timestamp: "2026-01-01T00:00:00Z".into(),
        session_id: "s".into(),
        agent_did: "did:oas:test:x".into(),
        kind: AuditKind::SessionStart,
        name: None,
        outcome: Outcome::Ok,
        input_hash: None,
        output_hash: None,
        prev_hash: GENESIS_PREV_HASH.into(),
        hash: "placeholder".into(),
        context: None,
    };
    let h1 = hash_record(&r).expect("hash ok");
    r.hash = "different placeholder".into();
    let h2 = hash_record(&r).expect("hash ok");
    assert_eq!(h1, h2);
}
