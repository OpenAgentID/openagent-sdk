"""The README quickstart, compiled by CI as the docs-truth gate.

If the README's sample stops compiling, the README has drifted from the
package — and CI says so. Every import and call here must match the README.
"""

import asyncio

from openagent_sdk import Agent, Scope, Verifier


async def main() -> None:
    # Mint or restore an identity (keys are generated/restored, not phoned home).
    agent = await Agent.create("my-agent")

    # Build a verifier (the four-line verify-first path).
    verifier = Verifier(
        [agent.keys.verifying_key],   # raw 32-byte Ed25519 keys
        "arsenal:broker:prod-1",       # expected issuer
        "my-service",                  # this service's audience
        required_scopes=[Scope.parse("tools:calendar:invoke")],
    )
    _ = verifier

    # The fluent builder shape, also documented.
    claims_builder = (
        __import__("openagent_sdk").verify_builder(b"")
        .issuer("arsenal:broker:prod-1")
        .for_audience("my-service")
        .trusted_keys([agent.keys.verifying_key])
        .require_scope(Scope.parse("tools:calendar:invoke"))
    )
    _ = claims_builder


if __name__ == "__main__":
    asyncio.run(main())
