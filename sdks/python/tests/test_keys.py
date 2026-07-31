"""Key custody: seed-derived identity, file and env restore."""

import pytest

from openagent_sdk import ConfigError
from openagent_sdk import keys as keys_mod


def test_generate_produces_full_key_set():
    keys = keys_mod.generate()
    assert len(keys.seed) == 32
    assert len(keys.signing_key) == 32
    assert len(keys.verifying_key) == 32
    assert len(keys.encryption_secret_key) == 32
    assert len(keys.encryption_public_key) == 32


def test_from_seed_restores_deterministically():
    seed = bytes(range(32))
    a = keys_mod.from_seed(seed)
    b = keys_mod.from_seed(seed)
    assert a.signing_key == b.signing_key
    assert a.verifying_key == b.verifying_key
    assert a.encryption_secret_key == b.encryption_secret_key
    assert a.encryption_public_key == b.encryption_public_key


def test_encryption_keys_differ_from_signing_keys():
    keys = keys_mod.from_seed(bytes([7] * 32))
    assert keys.encryption_secret_key != keys.signing_key


def test_from_seed_rejects_wrong_length():
    with pytest.raises(ConfigError):
        keys_mod.from_seed(b"\x00" * 16)


def test_sign_and_verify_round_trip():
    from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PublicKey

    keys = keys_mod.generate()
    message = b"openagent python test"
    signature = keys.sign(message)
    Ed25519PublicKey.from_public_bytes(keys.verifying_key).verify(signature, message)


def test_hex_round_trip():
    keys = keys_mod.generate()
    hex_seed = keys_mod.seed_to_hex(keys.seed)
    assert len(hex_seed) == 64
    restored = keys_mod.from_seed_hex(hex_seed)
    assert restored.signing_key == keys.signing_key


def test_from_seed_hex_rejects_malformed():
    with pytest.raises(ConfigError):
        keys_mod.from_seed_hex("not-hex")
    with pytest.raises(ConfigError):
        keys_mod.from_seed_hex("abcd")


def test_from_env(monkeypatch):
    keys = keys_mod.generate()
    monkeypatch.setenv("TEST_AGENT_SEED", keys_mod.seed_to_hex(keys.seed))
    restored = keys_mod.from_env("TEST_AGENT_SEED")
    assert restored.seed == keys.seed


def test_from_env_fails_closed(monkeypatch):
    monkeypatch.delenv("DEFINITELY_UNSET_VAR", raising=False)
    with pytest.raises(ConfigError):
        keys_mod.from_env("DEFINITELY_UNSET_VAR")


def test_save_and_load_seed_file(tmp_path):
    keys = keys_mod.generate()
    path = tmp_path / "agent.seed"
    keys_mod.save_seed(keys, path)
    assert path.stat().st_mode & 0o777 == 0o600
    restored = keys_mod.from_seed_file(path)
    assert restored.signing_key == keys.signing_key
