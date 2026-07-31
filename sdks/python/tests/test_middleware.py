"""Middleware behavior: extraction, 401-with-reason, claims pass-through."""

import base64

import pytest

from openagent_sdk import Verifier
from openagent_sdk.middleware import _extract_token, require_act_starlette

KEY = bytes([7] * 32)


def _b64url(data: bytes) -> str:
    return base64.urlsafe_b64encode(data).rstrip(b"=").decode()


def test_extract_bearer_and_openagent_schemes():
    token = _b64url(b"token-bytes")
    assert _extract_token(f"Bearer {token}") == b"token-bytes"
    assert _extract_token(f"OpenAgent {token}") == b"token-bytes"


def test_extract_rejects_other_schemes():
    assert _extract_token("Basic abc") is None
    assert _extract_token("") is None
    assert _extract_token(None) is None
    assert _extract_token("Bearer") is None


def test_extract_rejects_bad_base64():
    assert _extract_token("Bearer !!!not-b64!!!") is None


class _Capture:
    def __init__(self):
        self.scope = None

    async def __call__(self, scope, receive, send):
        self.scope = scope


@pytest.mark.asyncio
async def test_starlette_middleware_401s_missing_token():
    verifier = Verifier([KEY], "iss", "aud")
    app = _Capture()
    middleware = require_act_starlette(verifier)(app)

    sent = []

    async def send(message):
        sent.append(message)

    await middleware({"type": "http", "headers": []}, None, send)

    assert sent[0]["status"] == 401
    assert app.scope is None  # the app never ran


@pytest.mark.asyncio
async def test_starlette_middleware_401s_bad_token():
    verifier = Verifier([KEY], "iss", "aud")
    app = _Capture()
    middleware = require_act_starlette(verifier)(app)

    sent = []

    async def send(message):
        sent.append(message)

    bad = _b64url(b"not-an-act-envelope")
    await middleware({"type": "http", "headers": [(b"authorization", f"Bearer {bad}".encode())]}, None, send)

    assert sent[0]["status"] == 401
    assert b"ACT verification failed" in sent[1]["body"]
    assert app.scope is None
