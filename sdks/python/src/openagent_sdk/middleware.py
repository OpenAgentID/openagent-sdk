"""Verification middleware — one-liners for guarding routes with an ACT.

FastAPI / Starlette:

```python
from fastapi import FastAPI
from openagent_sdk import Verifier
from openagent_sdk.middleware import require_act

verifier = Verifier([broker_key], "arsenal:broker:prod-1", "my-service")

app = FastAPI()

@app.post("/tools/calendar", dependencies=[require_act(verifier, scopes=["tools:calendar:invoke"])])
async def handle():
    return {"ok": True}
```

A request with a missing, forged, expired, wrong-audience, or under-scoped
token gets a 401 with the reason; the route never runs.
"""

from __future__ import annotations

import base64
from typing import Any, Optional, Sequence

from .act import Verifier
from .errors import ActError
from .scope import Scope


def _extract_token(authorization: Optional[str]) -> Optional[bytes]:
    if not authorization:
        return None
    parts = authorization.strip().split(" ", 1)
    if len(parts) != 2:
        return None
    scheme, token = parts
    if scheme.lower() not in ("bearer", "openagent"):
        return None
    token = token.strip()
    if not token:
        return None
    # Reject characters outside the base64url alphabet: urlsafe_b64decode
    # silently discards them otherwise, and a garbage token must fail as
    # malformed, not decode into garbage bytes.
    if any(c not in "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_" for c in token):
        return None
    padded = token + "=" * (-len(token) % 4)
    try:
        return base64.urlsafe_b64decode(padded)
    except Exception:
        return None


def require_act(verifier: Verifier, scopes: Sequence[Scope | str] = ()) -> Any:
    """A FastAPI dependency that verifies the request's ACT.

    Returns the dependency; on success the verified claims are available to
    the route as the dependency's return value.
    """
    parsed_scopes = [Scope.parse(s) if isinstance(s, str) else s for s in scopes]
    bound = verifier.requiring_scopes(parsed_scopes) if parsed_scopes else verifier

    async def dependency(request: Any) -> Any:
        try:
            from fastapi import HTTPException
        except ImportError as e:  # pragma: no cover
            raise RuntimeError("require_act requires the fastapi extra") from e

        authorization = None
        headers = getattr(request, "headers", None)
        if headers is not None:
            authorization = headers.get("authorization")

        token = _extract_token(authorization)
        if token is None:
            raise HTTPException(
                status_code=401,
                detail="missing or malformed capability token",
                headers={"www-authenticate": "OpenAgent"},
            )

        try:
            return bound.verify(token)
        except ActError as e:
            raise HTTPException(
                status_code=401,
                detail=f"ACT verification failed: {e}",
                headers={"www-authenticate": "OpenAgent"},
            ) from e

    return dependency


def require_act_starlette(verifier: Verifier, scopes: Sequence[Scope | str] = ()) -> Any:
    """Starlette middleware class guarding an entire app or router."""

    parsed_scopes = [Scope.parse(s) if isinstance(s, str) else s for s in scopes]
    bound = verifier.requiring_scopes(parsed_scopes) if parsed_scopes else verifier

    class ActMiddleware:
        def __init__(self, app: Any) -> None:
            self.app = app

        async def __call__(self, scope: dict, receive: Any, send: Any) -> None:
            if scope["type"] != "http":
                await self.app(scope, receive, send)
                return

            headers = {k.decode(): v.decode() for k, v in scope.get("headers", [])}
            token = _extract_token(headers.get("authorization"))
            claims = None
            failure = None
            if token is None:
                failure = "missing or malformed capability token"
            else:
                try:
                    claims = bound.verify(token)
                except ActError as e:
                    failure = f"ACT verification failed: {e}"

            if failure is not None:
                import json

                body = json.dumps({"error": failure}).encode()
                await send(
                    {
                        "type": "http.response.start",
                        "status": 401,
                        "headers": [
                            (b"content-type", b"application/json"),
                            (b"www-authenticate", b"OpenAgent"),
                        ],
                    }
                )
                await send({"type": "http.response.body", "body": body})
                return

            scope["act_claims"] = claims
            await self.app(scope, receive, send)

    return ActMiddleware
