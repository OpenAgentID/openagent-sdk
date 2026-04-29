// Copyright (c) 2026 L1fe Labs, Inc. — Apache-2.0 OR MIT
//! Full 4-step OAAP handshake test over libp2p in-memory transport.
//!
//! This test creates two libp2p swarms (initiator and responder) connected
//! via in-memory transport and runs the complete PRESENT → CHALLENGE → PROVE →
//! ESTABLISHED handshake.

use std::time::Duration;

use futures::StreamExt;
use libp2p::identity::Keypair;
use libp2p::request_response;
use libp2p::swarm::{NetworkBehaviour, SwarmEvent};
use libp2p::{noise, yamux, Multiaddr, PeerId, SwarmBuilder};

use openagent_auth_protocol::types::{
    ConformanceLevel, DidDocument, EstablishedMessage, LineageProof, PresentMessage, ProveMessage,
};
use openagent_weave::config::WeaveAuthConfig;
use openagent_weave::protocol::{
    new_behaviour, HandshakeRequest, HandshakeResponse, WeaveAuthBehaviour, WeaveAuthEvent,
    OPENAGENT_AUTH_PROTOCOL,
};

/// Build a swarm with the WeaveAuth behaviour using in-memory transport.
fn build_swarm() -> libp2p::Swarm<WeaveAuthBehaviour> {
    let config = WeaveAuthConfig::default();
    let behaviour = new_behaviour(&config);

    let keypair = Keypair::generate_ed25519();

    SwarmBuilder::with_existing_identity(keypair)
        .with_tokio()
        .with_other_transport(|kp| {
            let noise_config = noise::Config::new(kp).expect("noise config");
            let yamux_config = yamux::Config::default();
            libp2p::core::transport::MemoryTransport::default()
                .upgrade(libp2p::core::upgrade::Version::V1)
                .authenticate(noise_config)
                .multiplex(yamux_config)
        })
        .expect("transport")
        .with_behaviour(|_kp| behaviour)
        .expect("behaviour")
        .with_swarm_config(|c| c.with_idle_connection_timeout(Duration::from_secs(30)))
        .build()
}

/// Wait for the first NewListenAddr event and return the address.
async fn listen_on_memory(swarm: &mut libp2p::Swarm<WeaveAuthBehaviour>) -> Multiaddr {
    let listen_addr: Multiaddr = format!("/memory/{}", rand::random::<u64>())
        .parse()
        .expect("valid multiaddr");
    swarm.listen_on(listen_addr).expect("listen");

    loop {
        if let SwarmEvent::NewListenAddr { address, .. } = swarm.select_next_some().await {
            return address;
        }
    }
}

#[tokio::test]
async fn full_handshake_over_memory_transport() {
    // -----------------------------------------------------------------------
    // Setup: two swarms (initiator + responder) on in-memory transport.
    // -----------------------------------------------------------------------
    let mut initiator = build_swarm();
    let mut responder = build_swarm();

    let responder_addr = listen_on_memory(&mut responder).await;
    let responder_peer_id = *responder.local_peer_id();

    initiator
        .dial(
            responder_addr
                .with(libp2p::multiaddr::Protocol::P2p(responder_peer_id)),
        )
        .expect("dial");

    // Wait for connection to establish.
    let mut initiator_connected = false;
    let mut responder_connected = false;

    while !initiator_connected || !responder_connected {
        tokio::select! {
            event = initiator.select_next_some() => {
                if matches!(event, SwarmEvent::ConnectionEstablished { .. }) {
                    initiator_connected = true;
                }
            }
            event = responder.select_next_some() => {
                if matches!(event, SwarmEvent::ConnectionEstablished { .. }) {
                    responder_connected = true;
                }
            }
        }
    }

    // -----------------------------------------------------------------------
    // Step 1: Initiator sends PRESENT.
    // -----------------------------------------------------------------------
    let present = PresentMessage {
        version: 1,
        did_document: DidDocument {
            id: "did:oas:test:agent:alice".into(),
            verification_key: "z6MkrJVnaZkeFzdQyMZu1cgjg7k1pZZ6pvBQ7XJPt4swbTQ2".into(),
            kind: "agent".into(),
            parent: Some("did:oas:test:hmr:root".into()),
        },
        lineage_proof: LineageProof { chain: vec![] },
        ephemeral_pubkey: base64::Engine::encode(
            &base64::engine::general_purpose::STANDARD,
            [42u8; 32],
        ),
    };

    let request_id = initiator
        .behaviour_mut()
        .send_request(&responder_peer_id, HandshakeRequest::Present(present.clone()));

    // -----------------------------------------------------------------------
    // Step 2: Responder receives PRESENT, sends CHALLENGE.
    // -----------------------------------------------------------------------
    let mut challenge_session_id = String::new();
    let mut challenge_nonce = String::new();

    // Drive both swarms until the responder gets the request and initiator gets the challenge.
    let mut responder_replied = false;
    let mut initiator_got_challenge = false;

    let timeout = tokio::time::sleep(Duration::from_secs(10));
    tokio::pin!(timeout);

    while !responder_replied || !initiator_got_challenge {
        tokio::select! {
            event = responder.select_next_some() => {
                if let SwarmEvent::Behaviour(WeaveAuthEvent::Message {
                    peer,
                    message: request_response::Message::Request { request, channel, .. },
                    ..
                }) = event {
                    match request {
                        HandshakeRequest::Present(p) => {
                            assert_eq!(p.did_document.id, "did:oas:test:agent:alice");

                            // Build a CHALLENGE response.
                            challenge_session_id = "sess-test-001".to_string();
                            challenge_nonce = base64::Engine::encode(
                                &base64::engine::general_purpose::STANDARD,
                                [99u8; 32],
                            );

                            let challenge = openagent_auth_protocol::types::ChallengeMessage {
                                session_id: challenge_session_id.clone(),
                                server_nonce: challenge_nonce.clone(),
                                server_did: "did:oas:test:agent:bob".into(),
                                server_ephemeral_pubkey: base64::Engine::encode(
                                    &base64::engine::general_purpose::STANDARD,
                                    [7u8; 32],
                                ),
                                required_conformance: ConformanceLevel::L2,
                                expires_in: 60,
                            };

                            responder.behaviour_mut()
                                .send_response(channel, HandshakeResponse::Challenge(challenge))
                                .expect("send challenge");
                            responder_replied = true;
                        }
                        _ => panic!("unexpected request type from initiator"),
                    }
                }
            }
            event = initiator.select_next_some() => {
                if let SwarmEvent::Behaviour(WeaveAuthEvent::Message {
                    message: request_response::Message::Response { response, .. },
                    ..
                }) = event {
                    match response {
                        HandshakeResponse::Challenge(c) => {
                            assert_eq!(c.session_id, "sess-test-001");
                            assert_eq!(c.server_did, "did:oas:test:agent:bob");
                            assert_eq!(c.required_conformance, ConformanceLevel::L2);
                            initiator_got_challenge = true;
                        }
                        _ => panic!("expected CHALLENGE, got something else"),
                    }
                }
            }
            _ = &mut timeout => panic!("handshake step 1-2 timed out"),
        }
    }

    // -----------------------------------------------------------------------
    // Step 3: Initiator sends PROVE.
    // -----------------------------------------------------------------------
    let prove = ProveMessage {
        session_id: challenge_session_id.clone(),
        signature: base64::Engine::encode(
            &base64::engine::general_purpose::STANDARD,
            [0xABu8; 64],
        ),
        initiator_nonce: base64::Engine::encode(
            &base64::engine::general_purpose::STANDARD,
            [0xCDu8; 32],
        ),
    };

    initiator
        .behaviour_mut()
        .send_request(&responder_peer_id, HandshakeRequest::Prove(prove.clone()));

    // -----------------------------------------------------------------------
    // Step 4: Responder receives PROVE, sends ESTABLISHED.
    // -----------------------------------------------------------------------
    let mut responder_proved = false;
    let mut initiator_established = false;

    let timeout2 = tokio::time::sleep(Duration::from_secs(10));
    tokio::pin!(timeout2);

    while !responder_proved || !initiator_established {
        tokio::select! {
            event = responder.select_next_some() => {
                if let SwarmEvent::Behaviour(WeaveAuthEvent::Message {
                    message: request_response::Message::Request { request, channel, .. },
                    ..
                }) = event {
                    match request {
                        HandshakeRequest::Prove(p) => {
                            assert_eq!(p.session_id, "sess-test-001");

                            let established = EstablishedMessage {
                                session_id: p.session_id.clone(),
                                session_token: "token-abc".into(),
                                server_signature: base64::Engine::encode(
                                    &base64::engine::general_purpose::STANDARD,
                                    [0xEFu8; 64],
                                ),
                                peer_did: "did:oas:test:agent:alice".into(),
                                conformance_level: ConformanceLevel::L2,
                                expires_in: 3600,
                            };

                            responder.behaviour_mut()
                                .send_response(channel, HandshakeResponse::Established(established))
                                .expect("send established");
                            responder_proved = true;
                        }
                        _ => panic!("expected PROVE request"),
                    }
                }
            }
            event = initiator.select_next_some() => {
                if let SwarmEvent::Behaviour(WeaveAuthEvent::Message {
                    message: request_response::Message::Response { response, .. },
                    ..
                }) = event {
                    match response {
                        HandshakeResponse::Established(e) => {
                            assert_eq!(e.session_id, "sess-test-001");
                            assert_eq!(e.peer_did, "did:oas:test:agent:alice");
                            assert_eq!(e.conformance_level, ConformanceLevel::L2);
                            assert_eq!(e.expires_in, 3600);
                            initiator_established = true;
                        }
                        _ => panic!("expected ESTABLISHED, got something else"),
                    }
                }
            }
            _ = &mut timeout2 => panic!("handshake step 3-4 timed out"),
        }
    }

    // Both sides completed the full 4-step handshake.
    assert!(responder_proved);
    assert!(initiator_established);
}

#[tokio::test]
async fn responder_rejects_with_error_response() {
    let mut initiator = build_swarm();
    let mut responder = build_swarm();

    let responder_addr = listen_on_memory(&mut responder).await;
    let responder_peer_id = *responder.local_peer_id();

    initiator
        .dial(responder_addr.with(libp2p::multiaddr::Protocol::P2p(responder_peer_id)))
        .expect("dial");

    // Wait for connection.
    let mut i_conn = false;
    let mut r_conn = false;
    while !i_conn || !r_conn {
        tokio::select! {
            event = initiator.select_next_some() => {
                if matches!(event, SwarmEvent::ConnectionEstablished { .. }) { i_conn = true; }
            }
            event = responder.select_next_some() => {
                if matches!(event, SwarmEvent::ConnectionEstablished { .. }) { r_conn = true; }
            }
        }
    }

    // Send PRESENT with wrong protocol version.
    let bad_present = PresentMessage {
        version: 999,
        did_document: DidDocument {
            id: "did:oas:test:agent:bad".into(),
            verification_key: "z6MkBAD".into(),
            kind: "agent".into(),
            parent: None,
        },
        lineage_proof: LineageProof { chain: vec![] },
        ephemeral_pubkey: "AAAA".into(),
    };

    initiator
        .behaviour_mut()
        .send_request(&responder_peer_id, HandshakeRequest::Present(bad_present));

    let mut got_error = false;
    let timeout = tokio::time::sleep(Duration::from_secs(10));
    tokio::pin!(timeout);

    while !got_error {
        tokio::select! {
            event = responder.select_next_some() => {
                if let SwarmEvent::Behaviour(WeaveAuthEvent::Message {
                    message: request_response::Message::Request { request, channel, .. },
                    ..
                }) = event {
                    if let HandshakeRequest::Present(p) = request {
                        // Reject: wrong version.
                        let _ = responder.behaviour_mut().send_response(
                            channel,
                            HandshakeResponse::Error {
                                code: "unsupported_version".into(),
                                reason: format!("version {} not supported", p.version),
                            },
                        );
                    }
                }
            }
            event = initiator.select_next_some() => {
                if let SwarmEvent::Behaviour(WeaveAuthEvent::Message {
                    message: request_response::Message::Response { response, .. },
                    ..
                }) = event {
                    match response {
                        HandshakeResponse::Error { code, reason } => {
                            assert_eq!(code, "unsupported_version");
                            assert!(reason.contains("999"));
                            got_error = true;
                        }
                        _ => panic!("expected Error response"),
                    }
                }
            }
            _ = &mut timeout => panic!("error response test timed out"),
        }
    }

    assert!(got_error);
}

use base64;
use rand;
