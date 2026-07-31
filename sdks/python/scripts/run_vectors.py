#!/usr/bin/env python3
"""Run the canonical ACT conformance vectors against this SDK.

The drift control for the Python SDK: the same 13 vectors that gate the
Rust and TypeScript implementations must pass here, through this package's
own verifier. Usage:

    python scripts/run_vectors.py [vectors-file]

Exits non-zero on any failure, printing the failing vector name and reason.
"""

from __future__ import annotations

import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "src"))

from openagent_sdk import ActError, ConfigError, Scope, Verifier  # noqa: E402


def run_vector(vector: dict) -> None:
    inp = vector["input"]
    expected = vector["expected_output"]

    envelope = bytes.fromhex(inp["envelope_hex"])
    trusted_key = bytes.fromhex(inp["trusted_key_hex"])
    scopes = [Scope.parse(s) for s in inp.get("scopes", [])]
    verifier = Verifier(
        [trusted_key],
        inp["issuer"],
        inp["audience"],
        required_scopes=scopes,
        leeway_seconds=inp.get("leeway_seconds", 0),
        now_unix_seconds=inp["now_unix_seconds"],
    )

    verdict = expected.get("verdict")
    claims = None
    failure = None
    try:
        claims = verifier.verify(envelope)
    except (ActError, ConfigError) as e:
        failure = e

    if verdict == "accept":
        if failure is not None:
            raise AssertionError(f"expected accept, verification failed: {failure}")
        assert claims is not None
        for field in ("sub", "jti", "tenant_id"):
            if field in expected and getattr(claims, field) != expected[field]:
                raise AssertionError(
                    f"{field} mismatch: got {getattr(claims, field)} expected {expected[field]}"
                )
        return

    if verdict == "reject":
        if failure is None:
            raise AssertionError(f"expected reject, token verified (sub {claims.sub})")
        reason_class = expected.get("reason_class", "")
        if reason_class and reason_class not in str(failure):
            raise AssertionError(
                f'reason class mismatch: error "{failure}" does not contain "{reason_class}"'
            )
        return

    raise AssertionError(f"unknown verdict {verdict!r}")


def main() -> int:
    vectors_path = (
        Path(sys.argv[1])
        if len(sys.argv) > 1
        else Path(__file__).resolve().parent.parent.parent.parent
        / "conformance"
        / "vectors"
        / "arsenal"
        / "act-verify.json"
    )
    data = json.loads(vectors_path.read_text())
    vectors = data["vectors"]

    failures = 0
    for vector in vectors:
        name = vector.get("name", "<unnamed>")
        try:
            run_vector(vector)
            print(f"  PASS  {name}")
        except AssertionError as e:
            failures += 1
            print(f"  FAIL  {name}: {e}")

    total = len(vectors)
    passed = total - failures
    print(f"\nact-verify: {passed}/{total} passed")
    return 1 if failures else 0


if __name__ == "__main__":
    raise SystemExit(main())
