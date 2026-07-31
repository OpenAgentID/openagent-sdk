"""The Agent façade: identity, grant request shape, challenge canonicalization."""

import pytest

from openagent_sdk import Agent, ConfigError
from openagent_sdk.agent import _canonical_challenge_bytes


@pytest.mark.asyncio
async def test_create_mints_identity_without_network():
    agent = await Agent.create("test-bot")
    assert agent.did == "did:oas:l1fe:agent:test-bot"
    assert len(agent.keys.verifying_key) == 32


@pytest.mark.asyncio
async def test_grant_enforces_scope_grammar():
    agent = await Agent.create("test-bot")
    session = _fake_session(agent)
    with pytest.raises(Exception):
        await session.grant("tools:invoke")  # two segments: invalid


@pytest.mark.asyncio
async def test_grant_enforces_ttl_bounds():
    agent = await Agent.create("test-bot")
    session = _fake_session(agent)
    with pytest.raises(ConfigError):
        await session.grant("tools:calendar:invoke", ttl_seconds=1)
    with pytest.raises(ConfigError):
        await session.grant("tools:calendar:invoke", ttl_seconds=100_000)


@pytest.mark.asyncio
async def test_grant_builds_the_request_document():
    agent = await Agent.create("test-bot")
    session = _fake_session(agent)
    doc = await session.grant("tools:calendar:invoke", ttl_seconds=300, audience="omerta")
    assert doc["sub"] == "did:oas:l1fe:agent:test-bot"
    assert doc["scope"] == ["tools:calendar:invoke"]
    assert doc["ttl_seconds"] == 300
    assert doc["audience"] == "omerta"


def _fake_session(agent):
    from openagent_sdk import Session

    return Session(
        base_url="https://api.example.com",
        session_token="tok",
        did=agent.did,
        expires_at=9999999999,
        trust_tier="anonymous",
        capabilities=(),
        _keys=agent.keys,
    )


def test_canonical_challenge_bytes_jcs_shape():
    challenge = {
        "type": "openagent-challenge-v1",
        "nonce": "a" * 64,
        "timestamp": "2026-03-21T12:00:00Z",
        "origin": "https://api.example.com",
    }
    payload = _canonical_challenge_bytes(challenge)
    expected = (
        '{"nonce":"' + "a" * 64 + '","origin":"https://api.example.com",'
        '"timestamp":"2026-03-21T12:00:00Z","type":"openagent-challenge-v1"}'
    )
    assert payload.decode() == expected


def test_canonical_challenge_bytes_places_realm_in_sorted_position():
    challenge = {
        "type": "openagent-challenge-v1",
        "nonce": "a" * 64,
        "timestamp": "2026-03-21T12:00:00Z",
        "origin": "https://api.example.com",
        "realm": "admin",
    }
    payload = _canonical_challenge_bytes(challenge).decode()
    assert payload.index('"realm"') < payload.index('"timestamp"')
