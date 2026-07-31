"""Agent Capability Token (ACT) verification, per act/SPECIFICATION.md.

This is the verify-first surface for Python. Verification follows the
normative procedure of section 4.1 *in order* — most importantly, signature
verification precedes every claim check, because until the signature
verifies the claim set is attacker-controlled.

The format is deliberately small: a CBOR envelope `{v, alg, claims, sig,
kid?}` where `claims` is a byte string holding the CBOR claim set, and `sig`
is the Ed25519 signature over those exact bytes.
"""

from __future__ import annotations

import time
from dataclasses import dataclass, field
from typing import Any, Optional, Sequence

import cbor2
from cryptography.exceptions import InvalidSignature
from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PublicKey

from .errors import (
    AudienceMismatch,
    ClaimsDecode,
    EnvelopeDecode,
    Expired,
    IssuerMismatch,
    MalformedScope,
    MalformedSignature,
    MissingScope,
    NotYetValid,
    ConfigError,
    SignatureInvalid,
    TooLarge,
    UnsupportedAlgorithm,
    UnsupportedVersion,
)
from .scope import Scope

#: The implemented format version (`v` field).
FORMAT_VERSION = 1
#: The implemented signature algorithm (`alg` field).
ALGORITHM_ED25519 = "Ed25519"
#: Hard cap on the envelope size (spec section 2.2).
MAX_ACT_BYTES = 16 * 1024


@dataclass(frozen=True)
class ActClaims:
    """The verified claim set (spec section 3).

    `ext` carries issuer-defined policy this verifier does not evaluate;
    its contents are signature-covered and passed through intact.
    """

    jti: str
    sub: str
    iss: str
    aud: list[str]
    iat: int
    nbf: int
    exp: int
    tenant_id: str
    scope: list[Scope]
    cnf: Optional[dict[str, Any]] = None
    delegation: Optional[dict[str, Any]] = None
    ext: dict[str, Any] = field(default_factory=dict)


def _decode_claims(raw: bytes) -> ActClaims:
    try:
        data = cbor2.loads(raw)
    except Exception as e:  # cbor2 raises CBORDecodeError variants
        raise ClaimsDecode(f"claims are not valid CBOR: {e}") from e
    if not isinstance(data, dict):
        raise ClaimsDecode("claim set is not a map")

    def need_text(name: str) -> str:
        value = data.get(name)
        if not isinstance(value, str) or not value:
            raise ClaimsDecode(f"missing or blank required claim {name!r}")
        return value

    def need_int(name: str) -> int:
        value = data.get(name)
        if not isinstance(value, int) or isinstance(value, bool):
            raise ClaimsDecode(f"missing or non-integer required claim {name!r}")
        return value

    jti = need_text("jti")
    sub = need_text("sub")
    iss = need_text("iss")
    iat = need_int("iat")
    nbf = data.get("nbf", 0)
    if not isinstance(nbf, int) or isinstance(nbf, bool):
        raise ClaimsDecode("claim 'nbf' must be an integer")
    exp = need_int("exp")
    tenant_id = need_text("tenant_id")

    aud_raw = data.get("aud")
    if isinstance(aud_raw, str):
        aud = [aud_raw]
    elif isinstance(aud_raw, list) and aud_raw and all(isinstance(a, str) for a in aud_raw):
        aud = list(aud_raw)
    else:
        raise ClaimsDecode("claim 'aud' must be a string or a non-empty array of strings")

    scope_raw = data.get("scope")
    if not isinstance(scope_raw, list) or not scope_raw or not all(
        isinstance(s, str) for s in scope_raw
    ):
        raise ClaimsDecode("claim 'scope' must be a non-empty flat array of strings")
    scope = [Scope.parse(s) for s in scope_raw]

    if nbf >= exp:
        raise ClaimsDecode(f"nbf ({nbf}) is not before exp ({exp})")

    ext = data.get("ext", {})
    if not isinstance(ext, dict):
        raise ClaimsDecode("claim 'ext' must be a map")

    return ActClaims(
        jti=jti,
        sub=sub,
        iss=iss,
        aud=aud,
        iat=iat,
        nbf=nbf,
        exp=exp,
        tenant_id=tenant_id,
        scope=scope,
        cnf=data.get("cnf"),
        delegation=data.get("delegation"),
        ext=ext,
    )


@dataclass(frozen=True)
class ActEnvelope:
    """The decoded (but unverified) envelope."""

    version: int
    alg: str
    claims: bytes
    sig: bytes
    kid: Optional[str]

    @classmethod
    def decode(cls, token_bytes: bytes) -> "ActEnvelope":
        if len(token_bytes) > MAX_ACT_BYTES:
            raise TooLarge(len(token_bytes), MAX_ACT_BYTES)
        try:
            data = cbor2.loads(token_bytes)
        except Exception as e:
            raise EnvelopeDecode(f"envelope is not valid CBOR: {e}") from e
        if not isinstance(data, dict):
            raise EnvelopeDecode("envelope is not a map")

        version = data.get("v")
        if not isinstance(version, int) or isinstance(version, bool):
            raise EnvelopeDecode("envelope has no integer 'v'")
        if version != FORMAT_VERSION:
            raise UnsupportedVersion(version)

        alg = data.get("alg")
        if not isinstance(alg, str):
            raise EnvelopeDecode("envelope has no text 'alg'")
        if alg != ALGORITHM_ED25519:
            raise UnsupportedAlgorithm(f"unsupported ACT signature algorithm: {alg}")

        claims = data.get("claims")
        sig = data.get("sig")
        if not isinstance(claims, bytes):
            raise EnvelopeDecode("envelope 'claims' is not a byte string")
        if not isinstance(sig, bytes):
            raise EnvelopeDecode("envelope 'sig' is not a byte string")
        if len(sig) != 64:
            raise MalformedSignature(f"signature must be exactly 64 bytes, got {len(sig)}")

        kid = data.get("kid")
        if kid is not None and not isinstance(kid, str):
            raise EnvelopeDecode("envelope 'kid' must be text when present")

        return cls(version=version, alg=alg, claims=claims, sig=sig, kid=kid)


class Verifier:
    """An ACT verifier: trusted keys plus policy bindings.

    An empty trusted key set fails at construction (spec section 4.2): such a
    verifier would reject every token, and a startup error must not disguise
    a misconfiguration as an attack.
    """

    def __init__(
        self,
        trusted_keys: Sequence[bytes],
        expected_issuer: str,
        expected_audience: str,
        *,
        required_scopes: Sequence[Scope] = (),
        leeway_seconds: int = 0,
        now_unix_seconds: Optional[int] = None,
    ) -> None:
        if not trusted_keys:
            raise ConfigError("at least one trusted key is required")
        for i, key in enumerate(trusted_keys):
            if len(key) != 32:
                raise ConfigError(f"trusted key {i} must be 32 bytes, got {len(key)}")
        if not expected_issuer:
            raise ConfigError("expected_issuer is required")
        if not expected_audience:
            raise ConfigError("expected_audience is required")
        self._keys = [Ed25519PublicKey.from_public_bytes(bytes(k)) for k in trusted_keys]
        self._issuer = expected_issuer
        self._audience = expected_audience
        self._scopes = list(required_scopes)
        self._leeway = abs(leeway_seconds)
        self._now = now_unix_seconds

    def with_clock(self, now_unix_seconds: int) -> "Verifier":
        """Pin the verification clock (tests, decision replay)."""
        return Verifier(
            [k.public_bytes_raw() for k in self._keys],
            self._issuer,
            self._audience,
            required_scopes=self._scopes,
            leeway_seconds=self._leeway,
            now_unix_seconds=now_unix_seconds,
        )

    def requiring_scopes(self, scopes: Sequence[Scope]) -> "Verifier":
        """Return a verifier that additionally requires these scopes."""
        return Verifier(
            [k.public_bytes_raw() for k in self._keys],
            self._issuer,
            self._audience,
            required_scopes=[*self._scopes, *scopes],
            leeway_seconds=self._leeway,
            now_unix_seconds=self._now,
        )

    def _time(self) -> int:
        return self._now if self._now is not None else int(time.time())

    def verify(self, token_bytes: bytes) -> ActClaims:
        """Verify an ACT envelope (spec section 4.1, in order)."""
        # Steps 1-3: size, decode, version/algorithm, signature shape.
        envelope = ActEnvelope.decode(token_bytes)

        # Step 4: the signature, BEFORE any claim check. `kid` is a hint for
        # audit and rotation, never authoritative for key selection - every
        # trusted key is tried.
        for key in self._keys:
            try:
                key.verify(envelope.sig, envelope.claims)
                break
            except InvalidSignature:
                continue
        else:
            raise SignatureInvalid(
                f"signature verification failed against all {len(self._keys)} trusted keys"
            )

        # Step 5: decode and structurally validate the claim set.
        claims = _decode_claims(envelope.claims)

        # Step 6: temporal checks with leeway.
        now = self._time()
        if claims.exp <= now - self._leeway:
            raise Expired(claims.exp, now)
        if claims.nbf > now + self._leeway:
            raise NotYetValid(claims.nbf, now)

        # Steps 7-8: issuer and audience.
        if claims.iss != self._issuer:
            raise IssuerMismatch(self._issuer, claims.iss)
        if self._audience not in claims.aud:
            raise AudienceMismatch(self._audience)

        # Step 9: required scopes covered per section 5.2 (directional).
        for required in self._scopes:
            if not any(granted.covers(required) for granted in claims.scope):
                raise MissingScope(str(required))

        return claims


def verify(token_bytes: bytes, verifier: Verifier) -> ActClaims:
    """Verify an ACT envelope against `verifier`. Module-level convenience."""
    return verifier.verify(token_bytes)


class VerifyBuilder:
    """Fluent ACT verifier, mirroring the other SDKs' builder shape.

    ```python
    claims = await_verifier  # see act.verify(...) below
    ```
    """

    def __init__(self, token: bytes) -> None:
        self._token = token
        self._issuer: Optional[str] = None
        self._audience: Optional[str] = None
        self._keys: list[bytes] = []
        self._scopes: list[Scope] = []
        self._leeway = 0
        self._now: Optional[int] = None

    def issuer(self, iss: str) -> "VerifyBuilder":
        self._issuer = iss
        return self

    def for_audience(self, audience: str) -> "VerifyBuilder":
        self._audience = audience
        return self

    def trusted_keys(self, keys: Sequence[bytes]) -> "VerifyBuilder":
        self._keys.extend(keys)
        return self

    def require_scope(self, scope: Scope | str) -> "VerifyBuilder":
        self._scopes.append(Scope.parse(scope) if isinstance(scope, str) else scope)
        return self

    def require_scopes(self, scopes: Sequence[Scope | str]) -> "VerifyBuilder":
        for s in scopes:
            self.require_scope(s)
        return self

    def with_leeway(self, seconds: int) -> "VerifyBuilder":
        self._leeway = seconds
        return self

    def at_time(self, unix_seconds: int) -> "VerifyBuilder":
        self._now = unix_seconds
        return self

    def run(self) -> ActClaims:
        if not self._issuer:
            raise ConfigError("act verify: issuer() is required")
        if not self._audience:
            raise ConfigError("act verify: for_audience() is required")
        if not self._keys:
            raise ConfigError("act verify: trusted_keys() is required (at least one key)")
        verifier = Verifier(
            self._keys,
            self._issuer,
            self._audience,
            required_scopes=self._scopes,
            leeway_seconds=self._leeway,
            now_unix_seconds=self._now,
        )
        return verifier.verify(self._token)


def verify_builder(token: bytes) -> VerifyBuilder:
    """Begin verifying an ACT envelope (fluent shape)."""
    return VerifyBuilder(token)


def decode_unverified(token_bytes: bytes) -> tuple[str, ActClaims]:
    """Decode claims WITHOUT verifying the signature, for diagnostics.

    Returns a ("UNVERIFIED", claims) tuple: the marker is mandatory so the
    output cannot be mistaken for verified claims. Never use this for
    authorization - unverified claims are attacker controlled.
    """
    envelope = ActEnvelope.decode(token_bytes)
    return ("UNVERIFIED", _decode_claims(envelope.claims))
