# AGENTS.md

## Project Intent

This repo is for a privacy-preserving house availability app.

The product is not a public calendar mirror. The core job is:

1. ingest private calendar data
2. parse it into typed internal facts
3. derive redacted availability for trusted viewers
4. support lightweight stay requests without becoming a booking marketplace

If a change pushes the app toward exposing raw calendar details, that is probably the wrong direction.

## Ground Truth

Before making non-trivial changes, read:

- `README.md` for product overview and quickstart
- `DEVELOPMENT.md` for developer workflow
- `DEPLOYMENT.md` for deployment requirements and config/env expectations
- `CONTRIBUTING.md` for contribution expectations
- `ARCHITECTURE.md` for system boundaries and future direction
- `config/config.example.json` for the current config shape

Do not assume this is a generic starter app. The domain model matters here.

## Runtime Model

- The app runs on the host with Bun, Vite, and TanStack Start.
- Postgres runs in Docker Compose for local development.
- Drizzle is the ORM and typed query layer for Postgres.
- shadcn/ui is installed for shared React UI primitives.
- Per-worktree ports are derived by `scripts/worktree-ports.ts`, and app ports skip browser-blocked ports such as `5060` and `5061`.
- `bun dev` already handles writing `.env` and starting Vite on the derived port.

Use these commands instead of improvising:

- `bun run ports`
- `bun run ports:write`
- `bun run db:start`
- `bun run db:stop`
- `bun run db:generate`
- `bun run db:push`
- `bun dev`
- `bun run admin:bootstrap-dev -- --email <email> --password '<password>'`
- `bun run admin:reset-password -- --email <email> --password '<password>'`
- `bun run lint`
- `bun run format`
- `bun run check`

`bun run typecheck` runs `tsc --noEmit`. TanStack Router route types live in the generated `src/routeTree.gen.ts`; keep it current when routes change.

Current calendar sync behavior:

- ICS imports are cached in-process with a short TTL
- `/admin/{siteId}/sync` forces a refresh and resets that house cache entry
- cache state is not persisted yet, so restart clears it
- sample fallback is development-only when a site imports zero all-day ICS events; production should surface the real empty state with warnings

## Config Rules

Treat configuration as three layers:

1. checked-in structural config
2. secrets in env
3. mutable runtime state in Postgres

Current checked-in example:

- `config/config.example.json`

Planned private local variant:

- `config/config.json`

Never commit:

- real ICS URLs
- signing secrets
- mail credentials
- private instance config files

For private local development only, `config/config.json` may include a
direct ICS `url` because the file is gitignored. Checked-in config should keep
using env-managed URLs by variable name.

If you add new secret-bearing fields, keep them in env or clearly marked sensitive DB columns.

Known housemates may also define `defaultRoomId` in checked-in config. That is
the room occupied by default when a `presence.in` event is parsed for them,
unless the title explicitly says `not staying`.

Each house may also define `calendarInterpretation.allDayEndDateMode` to
control whether imported all-day ICS end dates follow standard exclusive
semantics or are treated as checkout days for availability.

Each house may also define `site.branding.faviconPath` as an app-relative path
to a local asset under `public/`. Keep favicon assets local to the app rather
than pointing metadata at third-party hosts.

Viewer page passwords belong in env, not checked-in config.

The repo now supports one deployment with multiple houses. Keep viewer access
global unless the change explicitly adds house-scoped viewer permissions.

## Domain Rules

These are not optional stylistic preferences. They are product invariants.

- Raw event titles are inputs, not UI.
- Guest names should stay private in public or shared views.
- Housemate visibility is explicit, never assumed.
- All-day stay end dates are exclusive. Departure date is not a booked night.
- Requests are proposals, not holds.
- Parsing should be deterministic first. Do not lead with LLM parsing for core availability logic.
- Admin auth is single-tenant and password-first right now. Do not reintroduce SMTP as a required dependency without updating docs and architecture.
- Global admin auth is acceptable for one owner's multi-house deployment. If you add per-house admin permissions later, document the authorization model clearly.

If you change any of these assumptions, update `ARCHITECTURE.md` and explain why.

## Code Boundaries

Keep reusable domain logic out of route handlers and page components.

Current boundaries:

- `src/lib/house/*` for parsing, availability derivation, and sample domain data
- `src/lib/config/*` for instance config schema and mapping
- `src/lib/server/*` for server-only runtime helpers
- `src/lib/server/db-schema.ts` for Drizzle table definitions
- `src/routes/*` for TanStack Start routes and server route handlers
- `src/app/globals.css` for app-wide CSS consumed by TanStack Start
- `src/components/ui/*` for generated shadcn/ui primitives
- `scripts/*` for local workflow and build/tooling glue

Preferred direction:

- parsing and availability remain framework-agnostic
- persistence and sync layers can change without rewriting core rules
- UI should consume derived state, not reimplement domain logic
- Use shadcn/ui for shared controls and overlays, but keep product-specific surfaces like the availability calendar custom.
- Keep app-specific CSS tokens under `--app-*` so they do not collide with shadcn semantic tokens.

## TanStack Start Rules

This repo uses TanStack Start and TanStack Router. Do not rely on stale routing or server-function assumptions.

Before framework-level edits, check current TanStack Start and Router docs.

Especially if changing:

- server route handlers
- metadata
- type generation
- build and dev workflow

## Documentation Rules

When architecture or workflow changes, update the docs in the same change:

- `README.md` for product overview and entrypoint docs
- `DEVELOPMENT.md` for developer workflow
- `DEPLOYMENT.md` for deployment requirements
- `CONTRIBUTING.md` for contributor expectations
- `ARCHITECTURE.md` for system design
- `AGENTS.md` for agent operating rules

Do not leave the docs describing a different app than the code.

## Review Standard

Prefer small, defensible changes.

Call out:

- privacy leaks
- cross-house data leakage
- auth mistakes
- incorrect date semantics
- config/secret confusion
- hidden multi-worktree port collisions
- accidental coupling between demo data and real runtime paths

If something is still scaffolding, say so plainly.
