"""The ACT scope grammar (act/SPECIFICATION.md section 5).

A scope is exactly three non-empty, colon-separated segments:

    scope = service ":" resource ":" action

Matching is directional: `*` expands in a GRANT and is literal in a REQUEST.
Otherwise a holder of `tools:calendar:invoke` could request
`tools:calendar:*` and be authorized for actions it was never granted.
"""

from __future__ import annotations

from dataclasses import dataclass

from .errors import MalformedScope

SCOPE_SEGMENTS = 3
WILDCARD = "*"


@dataclass(frozen=True)
class Scope:
    """A parsed scope of exactly three segments."""

    service: str
    resource: str
    action: str

    @classmethod
    def parse(cls, text: str) -> "Scope":
        if not text or len(text) > 512:
            raise MalformedScope(text or "", "empty or over 512 characters")
        parts = text.split(":")
        if len(parts) != SCOPE_SEGMENTS:
            raise MalformedScope(
                text, f"must have exactly {SCOPE_SEGMENTS} segments, got {len(parts)}"
            )
        if any(part == "" for part in parts):
            raise MalformedScope(text, "segments must be non-empty")
        return cls(parts[0], parts[1], parts[2])

    def covers(self, requested: "Scope") -> bool:
        """Whether this GRANT covers the REQUESTED scope.

        `*` expands in the grant only. A `*` in the request matches literally
        (a grant must literally contain `*` in that segment).
        """
        granted = (self.service, self.resource, self.action)
        wanted = (requested.service, requested.resource, requested.action)
        return all(g == WILDCARD or g == w for g, w in zip(granted, wanted))

    def __str__(self) -> str:
        return f"{self.service}:{self.resource}:{self.action}"
