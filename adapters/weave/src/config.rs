// Copyright (c) 2026 L1fe Labs, Inc. — Apache-2.0 OR MIT
//! Protocol configuration for the Weave auth adapter.

use std::time::Duration;

/// Configuration for the Weave OAAP protocol adapter.
#[derive(Debug, Clone)]
pub struct WeaveAuthConfig {
    /// Maximum size of a single CBOR-encoded message frame, in bytes.
    /// Prevents memory exhaustion from malicious peers.
    /// Default: 64 KiB.
    pub max_message_size: usize,

    /// How long to wait for each handshake round trip before timing out.
    /// Default: 30 seconds.
    pub handshake_timeout: Duration,

    /// How long an established session remains valid.
    /// Default: 1 hour.
    pub session_ttl: Duration,

    /// Maximum number of concurrent pending handshakes.
    /// Default: 128.
    pub max_pending_handshakes: usize,

    /// How long a challenge remains valid before the initiator must send PROVE.
    /// Default: 60 seconds.
    pub challenge_ttl: Duration,
}

impl Default for WeaveAuthConfig {
    fn default() -> Self {
        Self {
            max_message_size: 64 * 1024,
            handshake_timeout: Duration::from_secs(30),
            session_ttl: Duration::from_secs(3600),
            max_pending_handshakes: 128,
            challenge_ttl: Duration::from_secs(60),
        }
    }
}

impl WeaveAuthConfig {
    /// Creates a new config with default values.
    pub fn new() -> Self {
        Self::default()
    }

    /// Sets the maximum message size.
    pub fn with_max_message_size(mut self, size: usize) -> Self {
        self.max_message_size = size;
        self
    }

    /// Sets the handshake timeout.
    pub fn with_handshake_timeout(mut self, timeout: Duration) -> Self {
        self.handshake_timeout = timeout;
        self
    }

    /// Sets the session TTL.
    pub fn with_session_ttl(mut self, ttl: Duration) -> Self {
        self.session_ttl = ttl;
        self
    }

    /// Sets the maximum number of concurrent pending handshakes.
    pub fn with_max_pending_handshakes(mut self, max: usize) -> Self {
        self.max_pending_handshakes = max;
        self
    }

    /// Sets the challenge TTL.
    pub fn with_challenge_ttl(mut self, ttl: Duration) -> Self {
        self.challenge_ttl = ttl;
        self
    }
}
