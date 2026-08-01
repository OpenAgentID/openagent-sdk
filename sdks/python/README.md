# OpenAgent SDK for Python

Identity, authentication, and Agent Capability Token (ACT) verification for
autonomous agents. The verify-first path is four lines; everything the
protocol offers stays reachable underneath.

```python
from openagent_sdk import Agent, Verifier, Scope

# Mint or restore an identity (keys are generated/restored, not phoned home).
agent = await Agent.create("my-agent")

# Run the Core Protocol challenge-response flow against a server.
session = await agent.authenticate("https://api.example.com")

# Build a capability grant request (scope grammar enforced client-side).
grant = await session.grant("tools:calendar:invoke", ttl_seconds=300)

# ...and on the verifying side - four lines, spec-exact:
verifier = Verifier(
    [broker_public_key],           # raw 32-byte Ed25519 keys
    "arsenal:broker:prod-1",       # expected issuer
    "my-service",                  # this service's audience
    required_scopes=[Scope.parse("tools:calendar:invoke")],
)
claims = verifier.verify(token_bytes)
```

## What you get

- **`Verifier` / `verify_builder()`** — canonical ACT verification per
  [act/SPECIFICATION.md](https://github.com/OpenAgentID/act): envelope decode,
  version/algorithm checks, Ed25519 signature verification *before* any
  claim check (the order is normative), temporal checks with leeway, and
  issuer/audience/scope policy. Distinct errors for forgery, expiry, and
  misconfiguration.
- **`Agent` / `Session`** — the façade: identity, the Core Protocol
  challenge-response flow, and grant requests.
- **Key custody** — `keys.generate()`, `keys.from_seed()`,
  `keys.from_seed_hex()`, `keys.from_seed_file()`, `keys.from_env()`,
  `keys.save_seed()`. Everything derives deterministically from one 32-byte
  seed (Ed25519 signing + X25519 encryption keypairs, the same BLAKE3
  context-separated derivation as the Rust/TS SDKs — install the optional
  `blake3` package for cross-SDK seed movement; HKDF-SHA256 is the fallback).
- **Middleware** — `require_act(verifier, scopes=[...])` FastAPI dependency
  and `require_act_starlette(verifier)` ASGI middleware. A missing, forged,
  expired, wrong-audience, or under-scoped token gets a 401 with the reason;
  the route never runs.

## Install

```bash
pip install openagentid-sdk            # core
pip install "openagentid-sdk[fastapi]" # with the FastAPI dependency
pip install blake3                    # optional: canonical cross-SDK key derivation
```

## Conformance

This SDK is gated by the same 13 canonical ACT vectors that gate Rust and
TypeScript (`conformance/vectors/arsenal/act-verify.json`):

```bash
python scripts/run_vectors.py
```

The drift rule: Python verifies through its own spec-exact implementation of
the published format, and the vectors prove it agrees with the canonical
crate — the suite that exists so three handwritten implementations never
drift again.

## License

Copyright © 2026 [L1fe Labs, Inc.](https://l1fe.ai)

Licensed under either of [Apache License 2.0](../../LICENSE-APACHE) or [MIT license](../../LICENSE-MIT), at your option.
