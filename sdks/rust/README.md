# openagent-sdk (Rust)

The Rust facade has its own source version (**0.1.0**, Rust 1.78 / edition
2021) and feature/dependency track. It wraps OAS identity and canonical ACT,
with optional Arsenal and AEGIS integration. It is not the Node local
workspace/browser-avatar API shipped as `@openagentid/sdk@0.7.2`.

Follow the [Rust integration quickstart](../../docs/getting-started/quickstart-rust.md)
for actual source/dependency and verifier setup. For the complete public
account-free Node application, use
[the developer tooling guide](../../docs/developer-tooling.md).

## Real Cargo features

| Feature | Default | Effect |
| --- | --- | --- |
| `arsenal` | off | Compiles credential/capability integration and links Arsenal dependencies. |
| `aegis` | off | Compiles verification integration and links the AEGIS SDK/core dependencies. |
| `axum` | off | Compiles the ACT extractor/layer integration with Axum. |
| `full` | off | Enables `arsenal`, `aegis` and `axum`. |

Disabled optional subsystems are absent from the relevant compiled module/type
surface; the features are not reserved/no-op flags. Dependencies include their
actual Git/version/access requirements. A source manifest is not proof of a
current public crate/dependency release.

## Creation and configured services

`OpenAgent::create_agent(CreateAgentOptions)` creates the source-specific local
identity record and deny-all default skills policy. With no parent, its current
helper creates an HMR-kind document; a valid local key/document does **not**
prove a real human or enroll a LifeID owner. Parent derivation needs the actual
OAS key/document contract. This is separate from the TypeScript verifier's
explicit owner/self-root approval policy.

Creation does not provision a broker or AEGIS verifier. Use `OpenAgentBuilder`
and the enabled feature's real client/registry/configuration before calling
its credential or verification operations. Supply current authority/finality
policy where a source operation requires it; historical Sigil interface names
do not establish an automatic Base migration or mandatory chain for the
current Node developer path.

## Skills policy

The implemented `SkillsPolicy` trait, `AllowListPolicy` and `SkillsPolicyHandle`
provide real allow/deny checks. `can_invoke` returns `Result<()>` and
`allowed_skills` enumerates allowed names. This small in-memory facade is
separate from the specialized `crates/openagent-skills-policy` component; it
has no automatic YAML DSL, remote consent service, spend oracle or durable
audit sink. Attach policy explicitly with `with_skills_policy` and check it
before the protected action.

## Source and license

[`Cargo.toml`](Cargo.toml), [`lib.rs`](src/lib.rs),
[`agent.rs`](src/agent.rs), [`builder.rs`](src/builder.rs) and
[`skills.rs`](src/skills.rs) define the actual contracts. Keep proof,
application permission, credentials and custody distinct.

Copyright © 2026 [L1fe Labs, Inc.](https://l1fe.ai).
Licensed under [Apache-2.0](../../LICENSE-APACHE) or
[MIT](../../LICENSE-MIT), at your option.
