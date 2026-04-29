//! # OpenAgent Skills Policy
//!
//! Governance for agent skills.
//!
//! Agents in the L1fe ecosystem discover specialized capabilities via
//! `SKILLS.md` files and the Claude Code `Skill` tool. By default, every
//! agent can invoke every discovered skill — there is no auth, no rate
//! limiting, and no audit trail. This crate closes that gap.
//!
//! ## Design
//!
//! `openagent-skills-policy` is a **specialized Arsenal policy**, not a
//! new primitive. It extends Arsenal's scope grammar with `skills:*`
//! scopes and composes:
//!
//! - [`arsenal_core::scope::Scope`] — resource grammar
//! - [`arsenal_core::identity::AgentIdentity`] — agent binding
//! - [`arsenal_core::limits::RateLimits`] — quota surface
//! - [`arsenal_core::audit::AuditEvent`] — receipt shape
//!
//! The six policy dimensions it adds per-skill:
//!
//! | Dimension          | What it gates                                 |
//! |--------------------|-----------------------------------------------|
//! | `allow` / `deny`   | Whether the skill can be invoked at all       |
//! | `rate_limit`       | Max invocations per sliding window (GCRA)     |
//! | `arg_constraints`  | JSON Schema applied to invocation arguments   |
//! | `time_windows`     | Hours/weekdays during which invocation is ok  |
//! | `require_consent`  | HITL approval must accompany the invocation   |
//! | `audit_level`      | How much detail lands in the audit chain      |
//!
//! ## Usage
//!
//! ```no_run
//! use openagent_skills_policy::{Did, InvocationContext, SkillsPolicy};
//! use serde_json::json;
//!
//! let yaml = r#"
//! version: 1
//! agent: did:oas:l1fe:agent:my-bot
//! skills:
//!   frontend-design:
//!     allow: true
//!     rate_limit: { window: 1h, max: 10 }
//!     arg_constraints:
//!       type: object
//!       required: [component]
//!   rm-rf:
//!     allow: false
//! default:
//!   allow: false
//! "#;
//!
//! let mut policy = SkillsPolicy::from_yaml(yaml)?;
//! let ctx = InvocationContext::new(
//!     Did::new("did:oas:l1fe:agent:my-bot")?,
//!     "sess-42",
//!     json!({ "component": "Button" }),
//! );
//!
//! let receipt = policy.record_invocation("frontend-design", &ctx)?;
//! assert_eq!(receipt.sequence, 0);
//! # Ok::<(), openagent_skills_policy::SkillsPolicyError>(())
//! ```

#![forbid(unsafe_code)]
#![deny(clippy::unwrap_used, clippy::expect_used, clippy::panic)]

pub mod audit;
pub mod did;
pub(crate) mod duration;
pub mod engine;
pub mod error;
pub mod policy;
pub mod rate;
pub mod skills_md;

pub use audit::{AuditChain, HashHex, Receipt};
pub use did::Did;
pub use engine::{arsenal_error_from, InvocationContext, SkillsPolicy};
pub use error::{Result, SkillsPolicyError};
pub use policy::{
    AuditLevel, DefaultRule, RateLimit, SkillRule, SkillsPolicyDoc, TimeWindow,
    CURRENT_VERSION, MAX_SKILL_RULES,
};
pub use skills_md::{SkillEntry, SkillsManifest};
