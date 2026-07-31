"""Scope grammar and matching (spec section 5)."""

import pytest

from openagent_sdk import MalformedScope, Scope


def test_parse_three_segments():
    scope = Scope.parse("tools:calendar:invoke")
    assert (scope.service, scope.resource, scope.action) == ("tools", "calendar", "invoke")
    assert str(scope) == "tools:calendar:invoke"


def test_parse_rejects_two_segments():
    with pytest.raises(MalformedScope):
        Scope.parse("tools:invoke")


def test_parse_rejects_empty_segment():
    with pytest.raises(MalformedScope):
        Scope.parse("tools::invoke")


def test_parse_rejects_blank():
    with pytest.raises(MalformedScope):
        Scope.parse("")


def test_exact_match_covers():
    grant = Scope.parse("tools:calendar:invoke")
    assert grant.covers(Scope.parse("tools:calendar:invoke"))


def test_wildcard_in_grant_expands():
    grant = Scope.parse("tools:*:invoke")
    assert grant.covers(Scope.parse("tools:calendar:invoke"))
    assert grant.covers(Scope.parse("tools:email:invoke"))
    assert not grant.covers(Scope.parse("tools:calendar:delete"))


def test_wildcard_in_request_is_literal_no_widening():
    # The non-widening rule: holding tools:calendar:invoke must NOT authorize
    # a request for tools:calendar:*.
    grant = Scope.parse("tools:calendar:invoke")
    assert not grant.covers(Scope.parse("tools:calendar:*"))


def test_wildcard_request_matches_literal_wildcard_grant():
    grant = Scope.parse("tools:calendar:*")
    assert grant.covers(Scope.parse("tools:calendar:*"))
    assert grant.covers(Scope.parse("tools:calendar:invoke"))
