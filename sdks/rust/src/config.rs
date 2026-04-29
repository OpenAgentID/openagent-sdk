//! SDK-wide configuration types.
//!
//! These are intentionally small. The OpenAgent SDK is a facade — most knobs
//! live in the underlying OAS / Arsenal / AEGIS configurations and only the
//! few values that affect SDK behavior are surfaced here.

use std::path::PathBuf;

/// Top-level configuration for the OpenAgent SDK.
///
/// Most users can call [`OpenAgentConfig::default`] and never touch this type.
/// Advanced users construct it via [`crate::builder::OpenAgentBuilder`].
#[derive(Debug, Clone)]
pub struct OpenAgentConfig {
    /// The OAS namespace used when minting new identities. Default: `"openagent"`.
    pub namespace: String,

    /// Optional Arsenal broker URL for credential proxying.
    /// When `None`, agents are created with identity only and credential
    /// fetching will return [`crate::errors::OpenAgentError::Config`].
    pub broker_url: Option<String>,

    /// Optional broker mTLS configuration. Required when `broker_url` is set
    /// in production.
    pub broker_mtls: Option<BrokerMtlsConfig>,

    /// Default audience advertised on broker capability requests.
    pub default_audience: String,

    /// Default capability TTL in seconds. Default: 300 (5 minutes).
    pub default_ttl_seconds: i64,

    /// Whether to auto-renew capability tokens before expiry. Default: `true`.
    pub auto_renew: bool,

    /// Optional path to a key file for loading the SDK's master signing key.
    /// When `None`, a fresh ephemeral key is generated.
    pub key_file: Option<PathBuf>,
}

impl Default for OpenAgentConfig {
    fn default() -> Self {
        Self {
            namespace: "openagent".to_string(),
            broker_url: None,
            broker_mtls: None,
            default_audience: "default".to_string(),
            default_ttl_seconds: 300,
            auto_renew: true,
            key_file: None,
        }
    }
}

/// mTLS bundle for the Arsenal broker connection.
///
/// All three fields are file paths to PEM-encoded material on disk. The SDK
/// passes them through to [`arsenal_sdk::ArsenalClientBuilder::broker_mtls`].
#[derive(Debug, Clone)]
pub struct BrokerMtlsConfig {
    /// PEM-encoded client certificate chain.
    pub client_cert: PathBuf,
    /// PEM-encoded client private key.
    pub client_key: PathBuf,
    /// Optional PEM-encoded CA certificate to trust for the broker server.
    pub ca_cert: Option<PathBuf>,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn default_namespace_is_openagent() {
        let cfg = OpenAgentConfig::default();
        assert_eq!(cfg.namespace, "openagent");
        assert_eq!(cfg.default_ttl_seconds, 300);
        assert!(cfg.auto_renew);
        assert!(cfg.broker_url.is_none());
    }
}
