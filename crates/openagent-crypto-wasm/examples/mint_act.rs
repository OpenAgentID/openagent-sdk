//! Mint a canonical ACT envelope for the WASM smoke test.
//!
//! Prints two hex lines: the Ed25519 public key (32 bytes) and the signed
//! envelope (CBOR). The claims are fixed so the smoke test can assert exact
//! temporal behavior with a pinned clock.

use agent_capability_token::{sign, ActClaims, Scope};
use ed25519_dalek::SigningKey;

fn main() {
    // Deterministic key so the smoke test is reproducible.
    let signing_key = SigningKey::from_bytes(&[7u8; 32]);

    let scope = Scope::parse("tools:calendar:invoke").expect("scope parses");
    let wildcard = Scope::parse("tools:*:invoke").expect("wildcard parses");

    let claims = ActClaims {
        jti: "smoke-act-1".to_string(),
        sub: "did:oas:l1fe:agent:smoke".to_string(),
        iss: "arsenal:broker:test-1".to_string(),
        aud: vec!["omerta".to_string()],
        iat: 1_800_000_000,
        nbf: 1_800_000_000,
        exp: 1_800_000_600,
        tenant_id: "tenant-a".to_string(),
        scope: vec![scope, wildcard],
        cnf: None,
        delegation: None,
        ext: Default::default(),
    };

    let envelope = sign(&claims, &signing_key, None).expect("signs");

    println!("{}", hex::encode(signing_key.verifying_key().to_bytes()));
    println!("{}", hex::encode(envelope));
}
