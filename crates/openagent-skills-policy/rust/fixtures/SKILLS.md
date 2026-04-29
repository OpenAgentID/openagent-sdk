# Skills

The following skills are available to agents operating under this policy.
Agents discover skills by reading this file; an OpenAgent skills policy gates
which of these the agent is allowed to invoke.

## frontend-design

Generate production-grade React components with Tailwind styling. Accepts a
`component` name and optional `variants`. Returns the component source and a
usage example.

## backend-scaffold

Scaffold a new Axum HTTP service with SQLx migrations, tracing, and
structured error handling. Accepts a `service_name` and `database_url`.

## deploy-production

Deploy the current build to the production Kubernetes cluster. Requires
human-in-the-loop consent. Accepts a `manifest_path` and optional
`environment` (defaults to `prod`).

## run-migrations

Execute pending SQL migrations against the target database. This is a
destructive action that cannot be rolled back automatically.

## rm-rf

Recursively delete files under a given path. This skill is intentionally
listed so that policies can explicitly deny it.

## read-logs

Tail service logs and return the last N lines. Read-only, safe for
unattended use.

## send-email

Send a transactional email via the configured SMTP relay. Accepts `to`,
`subject`, and `body_markdown`. Rate-limited to 10/hour by default.
