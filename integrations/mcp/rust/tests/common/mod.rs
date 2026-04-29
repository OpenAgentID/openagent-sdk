//! Shared test fakes.
//!
//! Provides an in-memory `IdentityVerifier` and `Agent` so the tests can
//! exercise the middleware deterministically without depending on the
//! production `openagent-sdk` crate.

use async_trait::async_trait;
use std::collections::HashMap;
use std::sync::{
    atomic::{AtomicUsize, Ordering},
    Arc, Mutex,
};

use openagent_mcp::{
    Agent, Identity, IdentityVerifier, McpAuthError, VerifiedIdentity,
};

#[derive(Clone, Debug)]
pub struct FakeRecord {
    pub did: String,
    pub proof: String,
    pub scopes: Vec<String>,
}

#[derive(Default)]
pub struct FakeVerifier {
    records: HashMap<String, FakeRecord>,
    pub calls: Mutex<Vec<(Identity, Vec<String>)>>,
    counter: AtomicUsize,
}

impl FakeVerifier {
    pub fn new(records: impl IntoIterator<Item = FakeRecord>) -> Self {
        let mut map = HashMap::new();
        for record in records {
            map.insert(format!("{}::{}", record.did, record.proof), record);
        }
        Self {
            records: map,
            calls: Mutex::new(Vec::new()),
            counter: AtomicUsize::new(0),
        }
    }

    #[allow(dead_code)]
    pub fn call_count(&self) -> usize {
        self.calls.lock().unwrap().len()
    }
}

#[async_trait]
impl IdentityVerifier for FakeVerifier {
    async fn verify(
        &self,
        identity: &Identity,
        required_scopes: &[String],
    ) -> Result<VerifiedIdentity, McpAuthError> {
        self.calls
            .lock()
            .unwrap()
            .push((identity.clone(), required_scopes.to_vec()));
        let key = format!("{}::{}", identity.did, identity.proof);
        let record = self
            .records
            .get(&key)
            .ok_or_else(|| McpAuthError::VerificationFailed {
                tool: "<verifier>".to_owned(),
                reason: format!("unknown identity {}", identity.did),
            })?;
        let count = self.counter.fetch_add(1, Ordering::SeqCst) + 1;
        Ok(VerifiedIdentity {
            did: record.did.clone(),
            scopes: record.scopes.clone(),
            audit_id: format!("audit-{count}"),
            claims: serde_json::json!({}),
        })
    }
}

pub struct FakeAgent {
    pub did: String,
    pub proof: String,
    pub verifier: Arc<FakeVerifier>,
    pub sign_calls: Mutex<Vec<(String, Option<String>)>>,
}

impl FakeAgent {
    pub fn new(did: &str, proof: &str, verifier: Arc<FakeVerifier>) -> Arc<Self> {
        Arc::new(Self {
            did: did.to_owned(),
            proof: proof.to_owned(),
            verifier,
            sign_calls: Mutex::new(Vec::new()),
        })
    }
}

#[async_trait]
impl Agent for FakeAgent {
    fn did(&self) -> &str {
        &self.did
    }

    fn verifier(&self) -> Arc<dyn IdentityVerifier> {
        self.verifier.clone() as Arc<dyn IdentityVerifier>
    }

    async fn sign_request(
        &self,
        tool_name: &str,
        audience: Option<&str>,
    ) -> Result<Identity, McpAuthError> {
        self.sign_calls
            .lock()
            .unwrap()
            .push((tool_name.to_owned(), audience.map(str::to_owned)));
        Ok(Identity {
            did: self.did.clone(),
            proof: self.proof.clone(),
            nonce: Some(format!("nonce-{}", self.sign_calls.lock().unwrap().len())),
            context: None,
        })
    }
}

pub fn happy_path(did: &str, scopes: Vec<String>) -> (Arc<FakeVerifier>, Arc<FakeAgent>) {
    let verifier = Arc::new(FakeVerifier::new([FakeRecord {
        did: did.to_owned(),
        proof: "valid".to_owned(),
        scopes,
    }]));
    let agent = FakeAgent::new(did, "valid", verifier.clone());
    (verifier, agent)
}

pub fn meta_with_identity(did: &str, proof: &str) -> serde_json::Value {
    serde_json::json!({
        "openagent": {
            "identity": {
                "did": did,
                "proof": proof,
            }
        }
    })
}
