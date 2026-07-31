"""Key custody — the piece of agent identity nobody else has an answer for.

Everything derives deterministically from one 32-byte seed: the Ed25519
signing keypair and an X25519 encryption keypair via the same BLAKE3
context-separated derivation as Arsenal's `identity_loader` and the other
SDKs. Persist the seed; restore the whole identity.
"""

from __future__ import annotations

import os
from dataclasses import dataclass
from pathlib import Path

from cryptography.hazmat.primitives.asymmetric.ed25519 import (
    Ed25519PrivateKey,
    Ed25519PublicKey,
)
from cryptography.hazmat.primitives.asymmetric.x25519 import (
    X25519PrivateKey,
    X25519PublicKey,
)
from cryptography.hazmat.primitives import hashes
from cryptography.hazmat.primitives.kdf.hkdf import HKDF

from .errors import ConfigError

#: The derivation context for the encryption keypair (matches Arsenal).
ENCRYPTION_DERIVE_CONTEXT = b"arsenal.agent.encryption_key"


def _derive_seed(context: bytes, seed: bytes) -> bytes:
    # BLAKE3 context-separated derivation. Python's stdlib has no BLAKE3, so
    # this uses the `blake3` package when present and falls back to HKDF-
    # SHA256 with the same context string otherwise. The canonical derivation
    # for cross-SDK seed movement is BLAKE3; install the blake3 package for
    # production key custody shared with the Rust/TS SDKs.
    try:
        import blake3  # type: ignore

        return blake3.derive_key(context.decode(), seed)
    except ImportError:
        return HKDF(
            algorithm=hashes.SHA256(),
            length=32,
            salt=None,
            info=context,
        ).derive(seed)


@dataclass(frozen=True)
class AgentKeys:
    """An agent's key material, derived from one seed."""

    seed: bytes
    signing_key: bytes
    verifying_key: bytes
    encryption_secret_key: bytes
    encryption_public_key: bytes

    def sign(self, message: bytes) -> bytes:
        """Sign with the Ed25519 signing key."""
        return Ed25519PrivateKey.from_private_bytes(self.signing_key).sign(message)

    def public_key(self) -> Ed25519PublicKey:
        return Ed25519PublicKey.from_public_bytes(self.verifying_key)

    def encryption_public(self) -> X25519PublicKey:
        return X25519PublicKey.from_public_bytes(self.encryption_public_key)


def from_seed(seed: bytes) -> AgentKeys:
    """Restore an identity from its 32-byte seed."""
    if len(seed) != 32:
        raise ConfigError(f"seed must be exactly 32 bytes, got {len(seed)}")

    # The signing keypair IS the seed (Ed25519 signing keys are 32-byte seeds).
    signing = Ed25519PrivateKey.from_private_bytes(seed)
    verifying = signing.public_key().public_bytes_raw()

    # The encryption keypair is derived, deterministically, so it restores
    # across restarts without persisting additional key material.
    derived = _derive_seed(ENCRYPTION_DERIVE_CONTEXT, seed)
    encryption_secret = X25519PrivateKey.from_private_bytes(derived)
    encryption_public = encryption_secret.public_key().public_bytes_raw()

    return AgentKeys(
        seed=bytes(seed),
        signing_key=bytes(seed),
        verifying_key=verifying,
        encryption_secret_key=derived,
        encryption_public_key=encryption_public,
    )


def generate() -> AgentKeys:
    """Generate a fresh identity. The seed is the only thing to persist."""
    seed = Ed25519PrivateKey.generate().private_bytes_raw()
    return from_seed(seed)


def from_seed_hex(hex_seed: str) -> AgentKeys:
    """Restore from a 64-character hex seed."""
    trimmed = hex_seed.strip()
    if len(trimmed) != 64:
        raise ConfigError("seed must be 64 hex characters")
    try:
        return from_seed(bytes.fromhex(trimmed))
    except ValueError as e:
        raise ConfigError(f"seed is not valid hex: {e}") from e


def from_env(env_var: str) -> AgentKeys:
    """Restore from an environment variable holding the hex seed."""
    value = os.environ.get(env_var)
    if not value:
        raise ConfigError(f"environment variable {env_var} is not set")
    return from_seed_hex(value)


def save_seed(keys: AgentKeys, path: str | Path) -> None:
    """Persist the seed to a file with owner-only (0600) permissions.

    The file contains the raw 32 bytes, matching Arsenal's `identity_loader`
    seed-file format so a seed moves between SDKs.
    """
    p = Path(path)
    p.write_bytes(keys.seed)
    p.chmod(0o600)


def from_seed_file(path: str | Path) -> AgentKeys:
    """Restore from a seed file written by [`save_seed`]."""
    return from_seed(Path(path).read_bytes())


def seed_to_hex(seed: bytes) -> str:
    """Hex-encode a seed for env vars and config files."""
    return seed.hex()
