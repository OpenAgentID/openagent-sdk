//! Minimal DID wrapper used for binding a policy to an agent.
//!
//! The full W3C DID parser lives in the OAS SDK; here we only need enough
//! validation to accept `did:oas:<namespace>:<kind>:<identifier>` strings and
//! similar simple DIDs, and to fail fast on obviously malformed values.
//!
//! This is intentionally minimal — a production deployment would reuse
//! `oas-sdk::Did` — but keeping it local avoids a hard dep on OAS for this
//! narrow use case.

use std::fmt;
use std::str::FromStr;

use serde::{Deserialize, Serialize};

use crate::error::SkillsPolicyError;

/// Maximum length for a DID string (prevents oversized inputs).
const MAX_DID_LENGTH: usize = 512;

/// A Decentralized Identifier (DID) that identifies the agent a policy
/// applies to.
///
/// Format: `did:<method>:<method-specific-id>`. For L1fe agents this is
/// typically `did:oas:l1fe:agent:<id>`.
#[derive(Clone, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(transparent)]
pub struct Did(String);

impl Did {
    /// Create a new DID with validation.
    ///
    /// # Errors
    /// Returns [`SkillsPolicyError::InvalidPolicy`] if the input does not
    /// look like a DID.
    pub fn new(input: impl Into<String>) -> Result<Self, SkillsPolicyError> {
        let raw = input.into();
        Self::validate(&raw)?;
        Ok(Self(raw))
    }

    /// Return the raw DID string.
    #[must_use]
    pub fn as_str(&self) -> &str {
        &self.0
    }

    fn validate(input: &str) -> Result<(), SkillsPolicyError> {
        if input.is_empty() {
            return Err(SkillsPolicyError::InvalidPolicy(
                "DID cannot be empty".to_string(),
            ));
        }
        if input.len() > MAX_DID_LENGTH {
            return Err(SkillsPolicyError::InvalidPolicy(format!(
                "DID length {} exceeds maximum {}",
                input.len(),
                MAX_DID_LENGTH
            )));
        }
        if !input.starts_with("did:") {
            return Err(SkillsPolicyError::InvalidPolicy(format!(
                "DID `{input}` must start with `did:`"
            )));
        }
        // Require at least `did:method:id` (3 colon-separated parts).
        let parts: Vec<&str> = input.splitn(3, ':').collect();
        if parts.len() != 3 || parts[1].is_empty() || parts[2].is_empty() {
            return Err(SkillsPolicyError::InvalidPolicy(format!(
                "DID `{input}` must have format `did:method:id`"
            )));
        }
        // Restrict characters to the DID grammar subset we accept.
        for ch in input.chars() {
            if !(ch.is_ascii_alphanumeric() || matches!(ch, ':' | '-' | '_' | '.' | '%')) {
                return Err(SkillsPolicyError::InvalidPolicy(format!(
                    "DID `{input}` contains invalid character `{ch}`"
                )));
            }
        }
        Ok(())
    }
}

impl fmt::Debug for Did {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "Did({})", self.0)
    }
}

impl fmt::Display for Did {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "{}", self.0)
    }
}

impl FromStr for Did {
    type Err = SkillsPolicyError;

    fn from_str(s: &str) -> Result<Self, Self::Err> {
        Self::new(s)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn accepts_valid_dids() {
        assert!(Did::new("did:oas:l1fe:agent:my-bot").is_ok());
        assert!(Did::new("did:key:z6Mki").is_ok());
        assert!(Did::new("did:web:example.com").is_ok());
    }

    #[test]
    fn rejects_malformed() {
        assert!(Did::new("").is_err());
        assert!(Did::new("my-bot").is_err());
        assert!(Did::new("did:").is_err());
        assert!(Did::new("did::id").is_err());
        assert!(Did::new("did:oas:").is_err());
        assert!(Did::new("did:oas:agent with space").is_err());
    }

    #[test]
    fn roundtrips_as_str() {
        let did = Did::new("did:oas:l1fe:agent:foo").expect("valid");
        assert_eq!(did.as_str(), "did:oas:l1fe:agent:foo");
        assert_eq!(did.to_string(), "did:oas:l1fe:agent:foo");
    }
}
