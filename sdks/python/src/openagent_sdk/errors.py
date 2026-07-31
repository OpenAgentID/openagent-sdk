"""Error types for the OpenAgent SDK.

`ActError` mirrors the canonical error surface of the ACT specification
(act/SPECIFICATION.md section 4), so a forged token reports distinctly from
an expired one, and a misconfigured verifier fails at construction rather
than presenting as a stream of signature failures.
"""

from __future__ import annotations


class OpenAgentError(Exception):
    """Base error for the SDK."""


class ConfigError(OpenAgentError):
    """A verifier or client was constructed with an unusable policy."""


class ActError(OpenAgentError):
    """Base class for ACT verification failures (spec section 4)."""


class TooLarge(ActError):
    """The input exceeds the 16 KiB envelope cap."""

    def __init__(self, size: int, maximum: int) -> None:
        super().__init__(f"token is {size} bytes, exceeding the {maximum}-byte maximum")


class EnvelopeDecode(ActError):
    """The outer envelope failed to decode."""


class UnsupportedVersion(ActError):
    """The envelope version is not implemented by this verifier."""

    def __init__(self, version: int) -> None:
        super().__init__(
            f"unsupported ACT format version {version}; this verifier implements version 1"
        )


class UnsupportedAlgorithm(ActError):
    """The envelope declares a signature algorithm this verifier does not implement."""


class SignatureInvalid(ActError):
    """No trusted key validated the signature."""


class MalformedSignature(ActError):
    """The signature is absent or not exactly 64 bytes."""


class ClaimsDecode(ActError):
    """The claims byte string failed to decode, or a structurally invalid claim set."""

    def __init__(self, reason: str) -> None:
        super().__init__(f"invalid claim set: {reason}")


class Expired(ActError):
    """The token is expired at evaluation time."""

    def __init__(self, exp: int, now: int) -> None:
        super().__init__(f"token expired at {exp} (now {now})")


class NotYetValid(ActError):
    """The token's not-before is in the future."""

    def __init__(self, nbf: int, now: int) -> None:
        super().__init__(f"token not valid until {nbf} (now {now})")


class IssuerMismatch(ActError):
    """The issuer does not match the expected issuer."""

    def __init__(self, expected: str, actual: str) -> None:
        super().__init__(f'issuer mismatch: expected "{expected}", got "{actual}"')


class AudienceMismatch(ActError):
    """The expected audience is absent from the token's audience list."""

    def __init__(self, expected: str) -> None:
        super().__init__(f'audience mismatch: "{expected}" is not among the token audiences')


class MissingScope(ActError):
    """A required scope is not covered by the grant."""

    def __init__(self, scope: str) -> None:
        super().__init__(f"missing required scope: {scope}")


class MalformedScope(ActError):
    """A scope string violates the three-segment grammar (spec section 5.1)."""

    def __init__(self, scope: str, reason: str) -> None:
        super().__init__(f'malformed scope "{scope}": {reason}')
