// Copyright (c) 2026 L1fe Labs, Inc. — Apache-2.0 OR MIT
//! libp2p `NetworkBehaviour` for the OpenAgent auth protocol.
//!
//! The [`WeaveAuthBehaviour`] wraps a libp2p `request_response::Behaviour`
//! configured with the CBOR codec and protocol `/openagent/auth/1.0.0`.

use libp2p::request_response::{self, ProtocolSupport};
use libp2p::swarm::NetworkBehaviour;
use libp2p::{PeerId, StreamProtocol};
use serde::{Deserialize, Serialize};
use std::iter;

use openagent_auth_protocol::types::{
    ChallengeMessage, EstablishedMessage, PresentMessage, ProveMessage,
};

use crate::codec::CborCodec;
use crate::config::WeaveAuthConfig;

/// The protocol identifier for OpenAgent auth on libp2p.
pub const OPENAGENT_AUTH_PROTOCOL: &str = "/openagent/auth/1.0.0";

// ---------------------------------------------------------------------------
// Wire types — the request/response envelopes carried over libp2p
// ---------------------------------------------------------------------------

/// A handshake request (sent by the initiator).
///
/// Maps to Steps 1 (PRESENT) and 3 (PROVE) of the OAAP handshake.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub enum HandshakeRequest {
    /// Step 1: Initiator presents identity.
    Present(PresentMessage),
    /// Step 3: Initiator proves ownership of the DID private key.
    Prove(ProveMessage),
}

/// A handshake response (sent by the responder).
///
/// Maps to Steps 2 (CHALLENGE) and 4 (ESTABLISHED) of the OAAP handshake.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub enum HandshakeResponse {
    /// Step 2: Responder issues a challenge.
    Challenge(ChallengeMessage),
    /// Step 4: Authentication established.
    Established(EstablishedMessage),
    /// Error during handshake — the responder rejected the request.
    Error {
        /// Machine-readable error code.
        code: String,
        /// Human-readable reason.
        reason: String,
    },
}

// ---------------------------------------------------------------------------
// NetworkBehaviour wrapper
// ---------------------------------------------------------------------------

/// Events emitted by [`WeaveAuthBehaviour`].
pub type WeaveAuthEvent = request_response::Event<HandshakeRequest, HandshakeResponse>;

/// libp2p `NetworkBehaviour` for the OpenAgent auth protocol.
///
/// This is a thin wrapper around `request_response::Behaviour` configured with
/// the CBOR codec and the `/openagent/auth/1.0.0` protocol. Compose it into
/// your swarm alongside other behaviours (Kademlia, Identify, etc.).
///
/// # Example
///
/// ```ignore
/// use openagent_weave::{WeaveAuthBehaviour, WeaveAuthConfig};
///
/// let config = WeaveAuthConfig::default();
/// let auth_behaviour = WeaveAuthBehaviour::new(config);
/// // Include `auth_behaviour` in your composed NetworkBehaviour struct.
/// ```
pub type WeaveAuthBehaviour = request_response::Behaviour<CborCodec>;

/// Create a new [`WeaveAuthBehaviour`] with the given configuration.
///
/// Both inbound and outbound support is enabled so the node can both
/// initiate and accept handshakes.
pub fn new_behaviour(config: &WeaveAuthConfig) -> WeaveAuthBehaviour {
    let codec = CborCodec::new(config);
    let protocol = StreamProtocol::new(OPENAGENT_AUTH_PROTOCOL);
    let rr_config = request_response::Config::default()
        .with_request_timeout(config.handshake_timeout);

    request_response::Behaviour::new(
        iter::once((protocol, ProtocolSupport::Full)),
        codec,
        rr_config,
    )
}

/// Send a handshake request to a specific peer.
///
/// Returns the `OutboundRequestId` for correlating the response.
pub fn send_request(
    behaviour: &mut WeaveAuthBehaviour,
    peer: &PeerId,
    request: HandshakeRequest,
) -> request_response::OutboundRequestId {
    behaviour.send_request(peer, request)
}

/// Send a handshake response for an inbound request.
///
/// `channel` comes from the `request_response::Event::Message::Request` variant.
pub fn send_response(
    behaviour: &mut WeaveAuthBehaviour,
    channel: request_response::ResponseChannel<HandshakeResponse>,
    response: HandshakeResponse,
) -> Result<(), HandshakeResponse> {
    behaviour.send_response(channel, response)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn protocol_id_matches_spec() {
        assert_eq!(OPENAGENT_AUTH_PROTOCOL, "/openagent/auth/1.0.0");
    }

    #[test]
    fn new_behaviour_creates_without_panic() {
        let config = WeaveAuthConfig::default();
        let _behaviour = new_behaviour(&config);
    }
}
