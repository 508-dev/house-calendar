# ARCHITECTURE.md

## Overview

`house-calendar` is a single-owner-friendly web app for turning private house calendar inputs into redacted, shareable availability.

The system is designed around one central idea:

**events are inputs, not UI**

Private calendar data should be ingested and interpreted into typed internal facts. Public and friend-facing views should render derived availability, never raw event details.

The current exception is small and deliberate: short same-day timed events may
surface as viewer-facing day notes so the owner can communicate logistics like
cleaning windows without changing occupancy state.

This architecture matters because the product is doing three jobs at once:

1. privacy protection
2. occupancy interpretation
3. lightweight coordination for stay requests

If those concerns blur together, the app will leak details or become harder to reason about.

## Documentation Split

The docs are intentionally split by audience:

- [README.md](./README.md) explains the product in human terms and gives a short quickstart
- [DEVELOPMENT.md](./DEVELOPMENT.md) covers local setup, commands, and operator workflow
- This file keeps the technical model, boundaries, and future direction

## Product Boundaries

### What this app is

- a derived availability engine
- a privacy layer on top of private calendars
- a trusted-friends coordination tool
- a self-hostable instance with light branding and per-house rules

### What this app is not

- a public booking marketplace
- a generic Google Calendar clone
- a free-form natural language parser that trusts LLM guesses
- a multi-tenant SaaS control plane, at least not today

## Current State

The repo currently contains a working prototype shell with:

- TanStack Start frontend with TanStack Router file-based routes
- Bun-based local workflow
- Postgres Docker Compose setup for local persistence plumbing
- Tailwind CSS v4 plus shadcn/ui primitives
- Drizzle ORM schema and typed query layer
- deterministic parser and availability modules
- sample instance config and sample event data
- demo APIs at `/api/health` and `/api/demo`

What is real today:

- worktree-aware dev ports
- validated config schemas
- parser and availability logic
- ICS import for all-day feeds
- short-lived in-memory ICS cache with manual admin refresh
- development-only sample fallback when a site imports zero all-day ICS events
- DB-backed single-tenant admin auth
- Drizzle-backed auth table schema and queries
- shadcn/ui installed for reusable controls and overlays
- docs and local runtime setup

What is still scaffolding:

- database schema and persistence layer
- sync job
- share token implementation
- request submission and approval workflow

Stay requests are intentionally disabled in the current viewer UI. They should
not be presented as enabled until the product has a real owner notification
path or requester identity layer such as Google OAuth.

## Architectural Principles

### 1. Deterministic before intelligent

The core pipeline should use structured rules, normalization, and validation before any AI-assisted fallback.

Good fits for deterministic logic:

- title normalization
- room and person alias matching
- regex-based parsing rules
- tentative stay markers embedded in event titles
- date expansion
- occupancy derivation
- privacy masking

Possible future fit for AI:

- admin suggestions for ambiguous events
- parser override hints
- import diagnostics

AI should not be the source of truth for availability.

### 2. Separate source data from derived state

There are at least four conceptual layers:

1. raw source events
2. parsed internal facts
3. derived daily availability
4. viewer-facing redacted output

This separation is the main privacy boundary in the system.

Timed day notes are secondary annotations. They do not participate in stay or
presence derivation, and they should stay lightweight enough that the app does
not turn back into a full calendar mirror.

Shared-space crash notes are another narrow annotation: all-day couch, sofa, or
floor crash events block whole-house availability without occupying a configured
room. Viewers see only a generic shared-space note, not the raw source title or
guest details.

For privacy, timed notes only surface when the underlying ICS event is
effectively public from the feed's perspective. Events marked
`CLASS:PRIVATE` or `CLASS:CONFIDENTIAL` remain hidden from viewer-facing day
notes even though they may still exist in the imported source data.

### 3. Single-tenant deployment, reusable software

The deployment model is expected to be:

- one app instance per owner deployment
- one or more houses inside that deployment
- self-hosted via Coolify or similar
- private env-managed secrets
- local branding and configuration

This is still not a multi-tenant SaaS control plane. The current model is one
owner-operated deployment that may contain multiple houses such as Tokyo and
Taiwan, while keeping parsing, availability, sync, and admin views scoped to a
selected `siteId`.

This is not the same thing as hardcoding one personal deployment into the repo.
The codebase should stay reusable while supporting a small shared runtime for
one owner's houses.

### 4. App on host, services in containers

Local developer ergonomics matter.

The current preferred local split is:

- host-run app process
- Docker Compose Postgres

This keeps frontend iteration fast while still providing a realistic persistence service.

### 5. Password-first admin auth

This repo now ships a deliberately small owner-auth model:

- one-time bootstrap codes stored by hash in Postgres
- required admin email during setup
- password login for normal admin access
- Postgres-backed sessions
- Postgres-backed failed-login throttling keyed by HMACed email, trusted client IP, and their pair
- optional Cloudflare Turnstile verification for admin login
- optional future email flows, not required for v1
- a dev-only CLI bootstrap helper for local setup, disabled in production
- an explicit operator password reset command that revokes admin sessions

This is a better fit for a self-hosted template than requiring SMTP on day one.

Admin abuse protection policy is checked-in app config under `adminSecurity`.
Deployment wiring stays in env: Turnstile keys and the trusted client-IP header
depend on the operator's infrastructure. The reusable template should work
without Cloudflare, but public deployments should layer edge rate limiting in
front of the app. The app only trusts a configured client-IP header, because
headers like `x-forwarded-for` are spoofable when the origin is directly
reachable.

Owner auth and viewer access are separate systems:

- owner auth proves administrative identity
- viewer access should use signed share links later
- a temporary shared page password is acceptable for low-friction self-hosted viewer gating across all houses in one deployment

Do not collapse those into one mechanism.

## System Components

## 1. Web App

Location:

- `src/routes/*`
- `src/app/globals.css`
- `src/components/ui/*`

Responsibilities:

- render public or trusted-viewer availability pages for one selected house
- expose server routes for health, demo data, and later real APIs
- host house-scoped admin UI inside one shared deployment
- load branding metadata
- use shadcn/ui primitives for shared controls, forms, dialogs, popovers, tabs, and notifications

Current files:

- `src/routes/__root.tsx`
- `src/routes/index.tsx`
- `src/routes/$siteId.tsx`
- `src/routes/admin/$siteId.tsx`
- `src/routes/api/health.ts`
- `src/routes/api/demo.ts`
- `src/components/ui/*`

Expected future routes:

- public availability views
- request submission endpoints
- owner/admin auth endpoints
- sync/admin diagnostics
- share link management

The domain calendar remains custom UI because its display semantics are product-specific. shadcn/ui should provide the reusable primitive layer around it: buttons, inputs, labels, cards, dialogs, popovers, selects, tabs, textareas, calendar primitives, and toasts.

## 2. Domain Logic

Location:

- `src/lib/house/*`

Responsibilities:

- schema definitions for house config and parsed events
- title normalization
- deterministic event parsing
- daily availability derivation

Current files:

- `src/lib/house/types.ts`
- `src/lib/house/parser.ts`
- `src/lib/house/availability.ts`
- `src/lib/house/sample-data.ts`

This layer should remain framework-agnostic. It should not depend on React, route handlers, or database-specific code.

## 3. Instance Config Layer

Location:

- `config/config.example.json`
- `src/lib/config/config.ts`

Responsibilities:

- define structural, safe-to-version-control instance config
- validate deployment-level viewer access plus per-house branding, rooms, people, calendars, and parsing rules
- validate per-house calendar interpretation rules such as all-day end-date handling
- map one selected house config into the internal `HouseConfig` shape

This is the beginning of the hybrid config model.

### Config split

#### Structural config, checked in

Examples:

- `defaultSiteId`
- deployment-wide viewer access mode
- per-house names and timezones
- per-house rooms and people
- per-house parsing rules
- per-house calendar interpretation mode
- per-house branding
- per-house local favicon asset paths
- per-house share policy defaults

#### Secrets, env only

Examples:

- `ICS_URL_*`
- `VIEWER_PASSWORD`
- signing secrets
- mail credentials
- privileged owner tokens

For private local development only, `config/config.json` may inline an ICS
`url` because that file is gitignored. Checked-in config should still reference
env-managed URLs by variable name.

#### Mutable runtime state, Postgres

Examples:

- imported events
- parser overrides
- share links
- booking requests
- audit events

Any future persisted product tables should be keyed by `site_id` so data for
Tokyo and Taiwan cannot bleed together accidentally.

Drizzle is the schema and query layer for Postgres. Current auth tables still self-initialize with explicit `create table if not exists` statements so fresh self-hosted installs work without a migration command. New persisted product tables should be added to `src/lib/server/db-schema.ts` first, with Drizzle migrations generated from that schema when runtime changes need durable migration history.

## 4. Server Runtime Helpers

Location:

- `src/lib/server/*`

Current file:

- `src/lib/server/env.ts`
- `src/lib/server/db.ts`
- `src/lib/server/db-schema.ts`

Current runtime behavior for calendar import:

- ICS data is fetched on-demand and cached in-memory for a short TTL
- admins can force a refresh through `/admin/{siteId}/sync`
- cache state is process-local and is cleared on restart

Responsibilities:

- validate server-only environment variables
- centralize sensitive runtime config access

This layer should grow to include:

- database client setup
- secret helpers
- auth/session helpers
- sync job runtime helpers

## Admin Auth Model

### Goals

- work for a single owner with minimal setup
- avoid SMTP as a v1 requirement
- keep local development identical enough to production
- store mutable auth state in Postgres, not checked-in config

### Environment

Required for first-run setup:

- `DATABASE_URL`

Not required for the shipped auth flow:

- SMTP
- password reset provider
- magic-link provider

### Data model

Current auth tables:

- `admin_users`
- `admin_sessions`
- `admin_bootstrap_codes`

Current invariants:

- the deployment is single-tenant
- first setup creates the first and only admin user
- bootstrap codes are short-lived and single-use
- admin email lives in the database
- password hashes are stored with scrypt
- sessions are opaque random tokens stored server-side by hash

### Request flows

#### `/admin/setup`

Use when the deployment has no admin user yet.

Flow:

1. run `bun run admin:bootstrap-code`
2. store only the code hash and expiry in Postgres
3. collect bootstrap code + admin email + admin password
4. atomically consume the code and create the only admin user
5. create the admin session
6. redirect into `/admin`

#### `/admin/login`

Use after setup is complete.

Flow:

1. collect email + password
2. verify against the single admin user
3. create a session row in Postgres
4. issue an httpOnly session cookie

#### `/admin/logout`

Flow:

1. delete the current session row by token hash
2. clear the session cookie

### Security posture

What this auth slice intentionally does:

- requires a valid unused bootstrap code for first-run setup
- requires email + password for the owner account
- keeps sessions server-side
- avoids leaking auth state into checked-in config

What it intentionally does not do yet:

- password reset emails
- magic-link login
- multiple admins
- 2FA
- rate limiting
- audit log UI

Those can be layered on later without replacing the core model.

## 5. Local Tooling

Location:

- `scripts/*`

Current files:

- `scripts/worktree-ports.ts`
- `scripts/dev.ts`
- `src/routeTree.gen.ts`

Responsibilities:

- derive stable per-worktree ports
- generate `.env`
- start Vite on the correct port
- keep TanStack Router route types generated for typechecking

These scripts are part of the architecture. They are not incidental glue.

Command usage and local setup steps live in [DEVELOPMENT.md](./DEVELOPMENT.md).

## Runtime Flows

## A. Current Demo Flow

1. `config/config.example.json` defines the example house
2. `configToHouseConfig()` maps it into internal house config
3. sample raw events are parsed into typed events
4. availability is derived from those parsed events
5. UI and demo API render the derived result

This is not production data flow. It is a domain prototype.

## B. Target Real Data Flow

1. private ICS URL is provided through env or imported instance bootstrap
2. sync job fetches ICS feed
3. raw events are normalized and stored
4. parser rules interpret raw titles into typed internal facts
5. derived occupancy table is materialized or computed
6. public/trusted viewer pages read only derived redacted state
7. request flow creates pending request records
8. owner approval turns a request into a real stay record or a source calendar action

## Data Model Direction

The database schema does not exist yet, but this is the intended shape.

### Likely core tables

#### `houses`

- `id`
- `slug`
- `name`
- `timezone`
- branding fields

#### `rooms`

- `id`
- `house_id`
- `slug`
- `name`

#### `people`

- `id`
- `house_id`
- `name`
- `default_room_id`
- visibility mode

#### `calendar_sources`

- `id`
- `house_id`
- provider type
- secret source reference or stored sensitive URL
- sync metadata

#### `raw_events`

- `id`
- `calendar_source_id`
- source event identifier
- raw title
- start date
- end date
- all-day flag
- raw payload snapshot if needed

#### `parsed_events`

- `id`
- `raw_event_id`
- event type
- scope
- room reference
- person reference
- confidence
- visibility
- parse strategy

#### `daily_availability`

- `house_id`
- date
- aggregate status
- room-level occupancy snapshot
- visible presence snapshot

This could be materialized for fast reads or computed on demand first.

#### `share_links`

- `id`
- `house_id`
- token hash
- scope
- expiry
- revocation timestamp
- viewer label
- request permission flag

#### `stay_requests`

- `id`
- `house_id`
- `share_link_id` or viewer identity reference
- requested room
- arrival date
- departure date
- note
- status
- decision metadata

#### `parser_overrides`

- `id`
- `raw_event_id`
- override payload
- creator
- timestamps

## Privacy Model

The privacy model is not a frontend concern. It must be built into the data pipeline.

### Required rules

- raw titles should never be directly rendered to public viewers
- guest identities should be masked by default
- housemate presence should only be shown when explicitly configured
- housemate location presence does not always imply room occupancy; explicit `not staying` annotations must keep the default room free
- sensitive calendar source values must be treated as secrets
- logs should not dump ICS URLs or signed share tokens

### Redaction boundary

The public and trusted viewer UI should consume already-redacted derived state.

Do not push raw event objects to the client and try to hide fields there.

## Date Semantics

This is a critical domain rule.

All-day stays use end-exclusive ranges:

- arrival date is included
- departure date is excluded

Example:

- `2026-04-11` to `2026-04-14` means nights of April 11, 12, and 13

If this rule breaks, occupancy will be wrong.

## Request Flow Model

Requests should not reserve dates on submission.

Tentative stay titles imported from calendars are a separate concept. They
should render as tentative availability markers, not as pending request state.

Target flow:

1. viewer opens a signed link
2. viewer sees redacted availability
3. if the link allows requests, viewer submits desired dates
4. request is stored as `pending`
5. owner reviews and approves or declines
6. only approval creates a real stay record or calendar-side action

This protects against accidental holds, spam reservations, and confusing state.

## Deployment Model

### Local development

- app on host
- Postgres in Compose
- worktree-aware port derivation, using `CONDUCTOR_PORT` and the next port in Conductor's assigned 10-port range when present

Relevant files:

- `compose.yml`
- `scripts/worktree-ports.ts`
- `scripts/dev.ts`

### Self-hosted deployment

Expected target:

- Coolify or similar
- one app service
- one Postgres service
- env-managed secrets
- optional bootstrap/import step for private instance config

No external image registry is required for the current plan.

## Config Strategy, Current and Future

### Current

- checked-in example config is used directly by the demo app

### Near future

- private local config file for each deployment
- bootstrap command validates and imports config into DB
- runtime reads house/site settings from DB

### Important constraint

If a bootstrap command is added, it must be idempotent.

Repeated deploys should upsert, not duplicate:

- house
- rooms
- people
- calendar sources
- share policy defaults

## Testing Strategy

Current coverage:

- parser behavior
- availability derivation

Missing but expected later:

- ICS ingestion tests
- parser override tests
- share token auth tests
- request workflow tests
- redaction tests
- DB integration tests

The most important bugs to catch early are:

- privacy leaks
- off-by-one date logic
- room/house conflict errors
- request auto-booking mistakes

## Near-Term Build Order

The next sensible sequence is:

1. choose DB layer, likely Drizzle + Postgres
2. create schema for houses, rooms, calendar sources, share links, requests
3. add bootstrap/import command for instance config
4. implement ICS fetch and parse sync path
5. persist parsed and derived state
6. add signed share links
7. add request submission and approval

That order keeps the system honest. It avoids building UI shells for data models that do not exist yet.
