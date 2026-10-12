# Rust integration quickstart

For a complete first application using public dependencies, use the
[TypeScript/JavaScript starter](quickstart-typescript.md). The Rust crate has a
separate integration surface and dependency track; it does not expose the Node
local workspace or browser player.

## Dependency and feature requirements

The current [Rust package manifest](../../sdks/rust/Cargo.toml) is version 0.1.0
and requires Rust 1.78+. It references OAS and ACT Git dependencies, with optional
Arsenal and AEGIS Git dependencies. Access to those dependencies must be available
before treating this as a clean-clone onboarding path. Publishing the TypeScript
SDK does not make every integration crate public.

| Cargo feature | Actual effect |
| --- | --- |
| Default | Identity, ACT verification, configuration and skills interfaces; no configured credential broker or AEGIS verifier. |
| `arsenal` | Compiles the credential module and links the Arsenal dependencies. |
| `aegis` | Compiles the verification module and exposes its verifier/context types. |
| `axum` | Enables the crate's ACT middleware integration. |
| `full` | Enables `arsenal`, `aegis` and `axum`. |

## Wire the operations you need

Use `OpenAgentBuilder` and the actual configured provider clients for broker and
verification operations. `OpenAgent::create_agent(CreateAgentOptions)` uses
identity configuration, not an automatic remote login or token issue. With no
parent it creates an HMR identity; with a parent it follows the derivation path.
Creating that material is not proof of a real authenticated human owner.

The default creation path attaches no credential client or AEGIS verifier and
uses a deny-all skills policy. Selecting a feature compiles the subsystem; it
does not authorize a provider or initialize a service connection. Configure
custody, current lineage/revocation and the broker's scopes explicitly.

Under `aegis`, `authenticate_with_verifier` and `Verifier` consume the configured
verification contract. `VerifiedContext` and `LineageAuthorityContext` are the
actual context names; do not assume the TypeScript facade's methods or an
`OpenAgent::from_env()` constructor exists here.

Consult the current source before integrating:

- [Facade and CreateAgentOptions](../../sdks/rust/src/agent.rs)
- [Builder](../../sdks/rust/src/builder.rs)
- [ACT verifier and middleware](../../sdks/rust/src/act.rs)
- [Feature-gated verification](../../sdks/rust/src/verification.rs)
- [Public re-exports](../../sdks/rust/src/lib.rs)
- [Authority/anchor boundary](../architecture/lineage-finality.md)

This guide describes the source contract; it claims no running broker,
human-owner enrollment, Base backend or automatic credential issuance.
