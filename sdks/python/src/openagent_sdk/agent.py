"""The Agent façade — identity, authentication, and capability grants.

```python
from openagent_sdk import Agent

agent = await Agent.create("my-agent")
session = await agent.authenticate("https://api.example.com")
act = await session.grant(scope="tools:calendar:invoke", ttl_seconds=300)

# ...and on the other side:
claims = act_verify(token).issuer(...).for_audience("my-service").run()
```

The façade composes the pieces: key custody (`keys`), the Core Protocol
challenge-response flow (via the HTTP binding), and ACT verification
(`act`). Protocol internals stay reachable underneath — the façade is the
front door, not a reduced API.
"""

from __future__ import annotations

import base64
import json
from dataclasses import dataclass
from typing import Any, Optional
from urllib import request as urlrequest
from urllib.error import URLError

from .errors import ConfigError, OpenAgentError
from .keys import AgentKeys, generate as generate_keys, from_seed
from .scope import Scope

AUTH_ENDPOINT_PATH = "/.well-known/openagent/auth"
PROVE_ENDPOINT_PATH = "/.well-known/openagent/auth/prove"


def _canonical_challenge_bytes(challenge: dict[str, Any]) -> bytes:
    """JCS-canonical (RFC 8785) UTF-8 bytes of the challenge object.

    Scoped to the challenge shape: a flat object whose values are strings (or
    absent). JCS for that shape is lexicographic key order, no whitespace,
    JSON string escaping. Do not reuse for nested or numeric payloads.
    """
    return json.dumps(
        {k: challenge[k] for k in sorted(challenge)},
        separators=(",", ":"),
        ensure_ascii=False,
    ).encode("utf-8")


@dataclass(frozen=True)
class Session:
    """An authenticated session from the Core Protocol identity flow."""

    base_url: str
    session_token: str
    did: str
    expires_at: int
    trust_tier: str
    capabilities: tuple[str, ...]
    _keys: AgentKeys

    @property
    def authorization_header(self) -> str:
        return f"OpenAgent {self.session_token}"

    async def grant(
        self, scope: str, ttl_seconds: int = 300, *, audience: Optional[str] = None
    ) -> dict[str, Any]:
        """Request a capability grant from the credential broker.

        This is the broker-integration seam: the façade builds the grant
        request (subject DID, scope grammar, TTL bounds); the broker
        (Arsenal) mints the ACT. Until the broker endpoint is wired, grant
        returns the *request document* the caller can present to a broker.
        """
        parsed = Scope.parse(scope)  # grammar enforced here, not at the broker
        if ttl_seconds < 5 or ttl_seconds > 86_400:
            raise ConfigError("ttl_seconds must be within [5, 86400]")
        return {
            "sub": self.did,
            "scope": [str(parsed)],
            "ttl_seconds": ttl_seconds,
            "audience": audience,
            "session_token": self.session_token,
        }


class Agent:
    """A live agent: keys plus the flows."""

    def __init__(self, keys: AgentKeys, did: Optional[str] = None) -> None:
        self._keys = keys
        self._did = did

    @classmethod
    async def create(cls, name: str, *, did: Optional[str] = None) -> "Agent":
        """Create a fresh identity (keys, not network)."""
        return cls(generate_keys(), did=did or f"did:oas:l1fe:agent:{name}")

    @classmethod
    def from_seed(cls, seed: bytes, *, did: Optional[str] = None) -> "Agent":
        """Restore an identity from its seed."""
        return cls(from_seed(seed), did=did)

    @property
    def did(self) -> str:
        if not self._did:
            raise ConfigError("this agent has no DID bound; pass did= to create()")
        return self._did

    @property
    def keys(self) -> AgentKeys:
        return self._keys

    async def authenticate(self, base_url: str) -> Session:
        """Run the Core Protocol identity flow against a server.

        Fetch an `openagent-challenge-v1`, sign the JCS-canonical challenge
        bytes, prove, and hold the session.
        """
        base = base_url.rstrip("/")

        # Step 1: fetch the challenge.
        try:
            with urlrequest.urlopen(urlrequest.Request(base + AUTH_ENDPOINT_PATH, method="POST")) as resp:
                challenge = json.loads(resp.read())
        except (URLError, json.JSONDecodeError) as e:
            raise OpenAgentError(f"challenge request failed: {e}") from e

        if challenge.get("type") != "openagent-challenge-v1":
            raise OpenAgentError(f"unexpected challenge type: {challenge.get('type')!r}")

        # Step 2: sign the canonical bytes and prove.
        payload = _canonical_challenge_bytes(challenge)
        signature = self._keys.sign(payload)
        proof = {
            "signature": base64.urlsafe_b64encode(signature).rstrip(b"=").decode(),
            "public_key": base64.urlsafe_b64encode(self._keys.verifying_key)
            .rstrip(b"=")
            .decode(),
            "key_type": "ed25519",
            "nonce": challenge["nonce"],
        }

        try:
            req = urlrequest.Request(
                base + PROVE_ENDPOINT_PATH,
                data=json.dumps(proof).encode(),
                headers={"content-type": "application/json", "accept": "application/json"},
                method="POST",
            )
            with urlrequest.urlopen(req) as resp:
                verified = json.loads(resp.read())
        except (URLError, json.JSONDecodeError) as e:
            raise OpenAgentError(f"prove request failed: {e}") from e

        import datetime as _dt

        expires_raw = verified.get("session_expires", "")
        try:
            expires_at = int(
                _dt.datetime.fromisoformat(expires_raw.replace("Z", "+00:00")).timestamp()
            )
        except ValueError as e:
            raise OpenAgentError(f"invalid session_expires in response: {expires_raw!r}") from e

        return Session(
            base_url=base,
            session_token=verified["session_token"],
            did=self.did,
            expires_at=expires_at,
            trust_tier=verified.get("trust_tier", "anonymous"),
            capabilities=tuple(verified.get("capabilities") or ()),
            _keys=self._keys,
        )
