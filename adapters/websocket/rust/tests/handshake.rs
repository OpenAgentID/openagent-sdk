// Copyright (c) 2026 L1fe Labs, Inc. — Apache-2.0 OR MIT
//
//! Integration tests: full OAAP handshake over localhost WebSocket.

use std::time::Duration;

use tokio::net::TcpListener;
use tokio_tungstenite::accept_async;

use openagent_crypto_wasm::ed25519;
use openagent_ws::{OpenAgentWsClient, OpenAgentWsHandler};

/// Binds a random localhost TCP port and returns the listener + its address.
async fn bind_random() -> (TcpListener, String) {
    let listener = TcpListener::bind("127.0.0.1:0")
        .await
        .unwrap_or_else(|e| unreachable!("bind failed: {e}"));
    let addr = listener
        .local_addr()
        .unwrap_or_else(|e| unreachable!("addr failed: {e}"));
    (listener, format!("ws://127.0.0.1:{}", addr.port()))
}

#[tokio::test]
async fn full_handshake_encrypted_send_receive() {
    let server_kp = ed25519::generate_keypair();
    let client_kp = ed25519::generate_keypair();

    let (listener, url) = bind_random().await;

    let server_did = "did:oas:l1fe:agent:server-test";
    let client_did = "did:oas:l1fe:agent:client-test";

    let handler = OpenAgentWsHandler::new(
        server_did,
        server_kp.signing_key_bytes(),
        server_kp.verifying_key_bytes(),
    )
    .with_encryption(true)
    .with_timeout(Duration::from_secs(5));

    // Server task: accept one connection, run handshake, exchange messages.
    let server_task = tokio::spawn(async move {
        let (tcp_stream, _) = listener
            .accept()
            .await
            .unwrap_or_else(|e| unreachable!("accept failed: {e}"));
        let ws_stream = accept_async(tcp_stream)
            .await
            .unwrap_or_else(|e| unreachable!("ws upgrade failed: {e}"));

        let mut session = handler
            .accept(ws_stream)
            .await
            .unwrap_or_else(|e| unreachable!("handshake failed: {e}"));

        assert_eq!(session.peer_did(), client_did);
        assert!(session.is_encrypted());

        // Receive a message from the client.
        let msg = session
            .receive()
            .await
            .unwrap_or_else(|e| unreachable!("recv failed: {e}"));
        assert_eq!(msg, b"hello from client");

        // Send a reply.
        session
            .send(b"hello from server")
            .await
            .unwrap_or_else(|e| unreachable!("send failed: {e}"));
    });

    // Client: connect, run handshake, exchange messages.
    let client = OpenAgentWsClient::new(
        client_did,
        client_kp.signing_key_bytes(),
        client_kp.verifying_key_bytes(),
    )
    .with_timeout(Duration::from_secs(5));

    let mut session = client
        .connect(&url)
        .await
        .unwrap_or_else(|e| unreachable!("client connect failed: {e}"));

    assert_eq!(session.peer_did(), server_did);
    assert!(session.is_encrypted());

    // Send a message.
    session
        .send(b"hello from client")
        .await
        .unwrap_or_else(|e| unreachable!("client send failed: {e}"));

    // Receive server reply.
    let reply = session
        .receive()
        .await
        .unwrap_or_else(|e| unreachable!("client recv failed: {e}"));
    assert_eq!(reply, b"hello from server");

    server_task
        .await
        .unwrap_or_else(|e| unreachable!("server task panicked: {e}"));
}

#[tokio::test]
async fn full_handshake_plaintext_send_receive() {
    let server_kp = ed25519::generate_keypair();
    let client_kp = ed25519::generate_keypair();

    let (listener, url) = bind_random().await;

    let handler = OpenAgentWsHandler::new(
        "did:oas:l1fe:agent:srv-pt",
        server_kp.signing_key_bytes(),
        server_kp.verifying_key_bytes(),
    )
    .with_encryption(false);

    let server_task = tokio::spawn(async move {
        let (tcp, _) = listener
            .accept()
            .await
            .unwrap_or_else(|e| unreachable!("{e}"));
        let ws = accept_async(tcp)
            .await
            .unwrap_or_else(|e| unreachable!("{e}"));

        let mut session = handler
            .accept(ws)
            .await
            .unwrap_or_else(|e| unreachable!("{e}"));

        assert!(!session.is_encrypted());

        let msg = session
            .receive()
            .await
            .unwrap_or_else(|e| unreachable!("{e}"));
        assert_eq!(msg, b"plaintext msg");

        session
            .send(b"plaintext reply")
            .await
            .unwrap_or_else(|e| unreachable!("{e}"));
    });

    let client = OpenAgentWsClient::new(
        "did:oas:l1fe:agent:cli-pt",
        client_kp.signing_key_bytes(),
        client_kp.verifying_key_bytes(),
    );

    let mut session = client
        .connect(&url)
        .await
        .unwrap_or_else(|e| unreachable!("{e}"));

    assert!(!session.is_encrypted());

    session
        .send(b"plaintext msg")
        .await
        .unwrap_or_else(|e| unreachable!("{e}"));

    let reply = session
        .receive()
        .await
        .unwrap_or_else(|e| unreachable!("{e}"));
    assert_eq!(reply, b"plaintext reply");

    server_task
        .await
        .unwrap_or_else(|e| unreachable!("{e}"));
}

#[tokio::test]
async fn multiple_messages_sequence_tracking() {
    let server_kp = ed25519::generate_keypair();
    let client_kp = ed25519::generate_keypair();

    let (listener, url) = bind_random().await;

    let handler = OpenAgentWsHandler::new(
        "did:oas:l1fe:agent:srv-multi",
        server_kp.signing_key_bytes(),
        server_kp.verifying_key_bytes(),
    )
    .with_encryption(true);

    let server_task = tokio::spawn(async move {
        let (tcp, _) = listener
            .accept()
            .await
            .unwrap_or_else(|e| unreachable!("{e}"));
        let ws = accept_async(tcp)
            .await
            .unwrap_or_else(|e| unreachable!("{e}"));

        let mut session = handler
            .accept(ws)
            .await
            .unwrap_or_else(|e| unreachable!("{e}"));

        for i in 0..5u32 {
            let msg = session
                .receive()
                .await
                .unwrap_or_else(|e| unreachable!("{e}"));
            let expected = format!("msg-{i}");
            assert_eq!(msg, expected.as_bytes());
        }

        for i in 0..5u32 {
            let reply = format!("reply-{i}");
            session
                .send(reply.as_bytes())
                .await
                .unwrap_or_else(|e| unreachable!("{e}"));
        }
    });

    let client = OpenAgentWsClient::new(
        "did:oas:l1fe:agent:cli-multi",
        client_kp.signing_key_bytes(),
        client_kp.verifying_key_bytes(),
    );

    let mut session = client
        .connect(&url)
        .await
        .unwrap_or_else(|e| unreachable!("{e}"));

    for i in 0..5u32 {
        let msg = format!("msg-{i}");
        session
            .send(msg.as_bytes())
            .await
            .unwrap_or_else(|e| unreachable!("{e}"));
    }

    for i in 0..5u32 {
        let reply = session
            .receive()
            .await
            .unwrap_or_else(|e| unreachable!("{e}"));
        let expected = format!("reply-{i}");
        assert_eq!(reply, expected.as_bytes());
    }

    server_task
        .await
        .unwrap_or_else(|e| unreachable!("{e}"));
}

#[tokio::test]
async fn handshake_timeout_on_no_client() {
    let server_kp = ed25519::generate_keypair();
    let (listener, url) = bind_random().await;

    let handler = OpenAgentWsHandler::new(
        "did:oas:l1fe:agent:srv-timeout",
        server_kp.signing_key_bytes(),
        server_kp.verifying_key_bytes(),
    )
    .with_timeout(Duration::from_millis(200));

    // Server: accept connection but client will not send any OAAP frames.
    let server_task = tokio::spawn(async move {
        let (tcp, _) = listener
            .accept()
            .await
            .unwrap_or_else(|e| unreachable!("{e}"));
        let ws = accept_async(tcp)
            .await
            .unwrap_or_else(|e| unreachable!("{e}"));

        let result = handler.accept(ws).await;
        assert!(result.is_err(), "expected handshake timeout");
    });

    // Client: connect but send nothing (just a raw WS connection).
    let (_ws, _resp) = tokio_tungstenite::connect_async(&url)
        .await
        .unwrap_or_else(|e| unreachable!("{e}"));

    // Wait a bit for the server timeout to fire.
    tokio::time::sleep(Duration::from_millis(500)).await;

    server_task
        .await
        .unwrap_or_else(|e| unreachable!("{e}"));
}
