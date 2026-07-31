"""Verifier and builder behavior beyond the conformance vectors."""

import pytest

from openagent_sdk import ConfigError, Scope, Verifier, verify_builder


KEY = bytes([7] * 32)


def test_empty_trusted_keys_fail_at_construction():
    # Spec section 4.2: a verifier with no keys must fail at startup, not
    # present as a stream of signature failures.
    with pytest.raises(ConfigError):
        Verifier([], "iss", "aud")


def test_wrong_length_key_fails_at_construction():
    with pytest.raises(ConfigError):
        Verifier([b"\x00" * 16], "iss", "aud")


def test_blank_issuer_fails_at_construction():
    with pytest.raises(ConfigError):
        Verifier([KEY], "", "aud")


def test_blank_audience_fails_at_construction():
    with pytest.raises(ConfigError):
        Verifier([KEY], "iss", "")


def test_builder_requires_issuer():
    with pytest.raises(ConfigError):
        verify_builder(b"\x00").for_audience("aud").trusted_keys([KEY]).run()


def test_builder_requires_audience():
    with pytest.raises(ConfigError):
        verify_builder(b"\x00").issuer("iss").trusted_keys([KEY]).run()


def test_builder_requires_keys():
    with pytest.raises(ConfigError):
        verify_builder(b"\x00").issuer("iss").for_audience("aud").run()


def test_requiring_scopes_is_additive():
    v = Verifier([KEY], "iss", "aud")
    v2 = v.requiring_scopes([Scope.parse("tools:calendar:invoke")])
    assert len(v2._scopes) == 1
    v3 = v2.requiring_scopes([Scope.parse("tools:email:send")])
    assert len(v3._scopes) == 2
    # The original is unchanged.
    assert len(v._scopes) == 0
