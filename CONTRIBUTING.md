# CONTRIBUTING.md

## Purpose

This repo is small enough that contribution guidance should stay concrete.

Use this file for day-to-day contribution expectations. Use [README.md](./README.md) for the product overview, [DEVELOPMENT.md](./DEVELOPMENT.md) for setup and commands, and [ARCHITECTURE.md](./ARCHITECTURE.md) for system boundaries.

## Before You Change Anything

Read these first for non-trivial changes:

- [README.md](./README.md)
- [DEVELOPMENT.md](./DEVELOPMENT.md)
- [ARCHITECTURE.md](./ARCHITECTURE.md)
- [config/config.example.json](./config/config.example.json)

Do not treat this as a generic calendar app. The privacy model and domain rules are the product.

## Core Product Guardrails

- Raw event titles are inputs, not UI
- Guest names should stay private in public or shared views
- Housemate visibility is explicit, never assumed
- All-day stay end dates are exclusive unless a house is explicitly configured for checkout-day interpretation
- Requests are proposals, not holds
- Parsing should be deterministic first
- Viewer access is deployment-global today, not house-scoped

If your change pushes against one of those rules, update [ARCHITECTURE.md](./ARCHITECTURE.md) in the same change and explain the tradeoff clearly.

## Local Workflow

Use the repo scripts instead of improvising:

- `bun run ports`
- `bun run ports:write`
- `bun run db:start`
- `bun run db:stop`
- `bun dev`
- `bun run lint`
- `bun run format`
- `bun run check`

`bun run typecheck` runs `tsc --noEmit`. If routes change, make sure the TanStack-generated `src/routeTree.gen.ts` stays current by running the Vite dev server or build.

Full setup and operator commands are in [DEVELOPMENT.md](./DEVELOPMENT.md).

## Config And Secrets

- Never commit real ICS URLs, signing secrets, mail credentials, or private instance config files
- Keep checked-in config structural and non-secret
- Put sensitive values in env or clearly sensitive database fields
- Keep admin login protection policy in `adminSecurity`, but keep Turnstile keys and trusted proxy headers in env
- `config/config.json` is gitignored and never committed; use it for local overrides or deployment-specific config supplied by your deploy mechanism, and only inline secrets or ICS URLs when that file is treated as private
- Repo automation that pushes changes back to `main` from GitHub Actions should prefer a `GH_AUTOMATION_TOKEN` repository secret when workflow files under `.github/workflows/**` may be edited, and fall back to `github.token` otherwise; ensure `GH_AUTOMATION_TOKEN` has permission to update workflow files, for example `workflow` scope or permission where applicable

## Code Boundaries

Keep reusable domain logic out of route handlers and page components.

Current boundaries:

- `src/lib/house/*` for parsing, availability derivation, and sample domain data
- `src/lib/config/*` for config schema and mapping
- `src/lib/server/*` for server-only helpers
- `src/lib/server/db-schema.ts` for Drizzle table definitions
- `src/routes/*` for TanStack Start routes and server route handlers
- `src/app/globals.css` for app-wide CSS consumed by TanStack Start
- `scripts/*` for workflow and tooling glue

UI should consume derived state rather than reimplement domain logic.

## Validation

Before opening a PR, run the smallest useful verification set for your change. For most code changes that means:

```bash
bun run check
```

For formatting-only or docs-only changes, say so plainly in the PR and note what you did verify.

## Pull Requests

Prefer small, defensible changes.

Call out these risks explicitly when relevant:

- privacy leaks
- cross-house data leakage
- auth mistakes
- incorrect date semantics
- config or secret confusion
- worktree port collisions
- accidental coupling between sample data and real runtime behavior

If the change affects architecture, workflow, or operating assumptions, update the matching docs in the same PR:

- [README.md](./README.md) for product overview and entrypoint docs
- [DEVELOPMENT.md](./DEVELOPMENT.md) for developer workflow
- [ARCHITECTURE.md](./ARCHITECTURE.md) for system design
- [AGENTS.md](./AGENTS.md) for agent operating rules
