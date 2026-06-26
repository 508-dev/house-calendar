# DEVELOPMENT.md

## Purpose

This file covers local setup, developer workflow, config handling, and operator commands.

If you want the product overview, start with [README.md](./README.md). If you want the technical model and system boundaries, use [ARCHITECTURE.md](./ARCHITECTURE.md).

## Runtime Model

- The app runs on the host with Bun, Vite, and TanStack Start
- Postgres runs in Docker Compose for local development
- Drizzle is the ORM and typed query layer for Postgres
- Per-worktree ports are derived by `scripts/worktree-ports.ts`, and app ports skip browser-blocked ports such as `5060` and `5061`
- In Conductor workspaces, `CONDUCTOR_PORT` is treated as the first port in the workspace's assigned 10-port range; the app uses that port and Postgres uses the next port in the range
- `bun run db:start`, `bun run admin:bootstrap-dev`, and `bun dev` pass derived local env directly instead of relying on `.env`
- `WORKTREE_DEV_PORT` and `WORKTREE_POSTGRES_PORT` are manual overrides only when `CONDUCTOR_PORT` is unset; generated `.env` files do not write them

## Prerequisites

- Bun
- Docker Desktop or another local Docker runtime

## Quick Setup

1. Install dependencies:

   ```bash
   bun install
   ```

   `bunfig.toml` applies a seven-day cooldown for newly published npm
   packages to reduce dependency supply-chain risk.

2. See the derived ports for this worktree:

   ```bash
   bun run ports
   ```

3. Start local Postgres:

   ```bash
   bun run db:start
   ```

4. Optional: create a private local config override:

   ```bash
   cp config/config.example.json config/config.json
   ```

   `config/config.json` is gitignored and may include local-only ICS `url` values.

5. Start the app:

   ```bash
   bun dev
   ```

6. Run `bun run ports` again if you need the exact local URL for this worktree.

## Config And Secrets

Treat config as three layers:

1. Checked-in structural config in `config/config.example.json`
2. Secrets in env such as `ICS_URL_*`, `DATABASE_URL`, `VIEWER_PASSWORD`
3. Mutable runtime state in Postgres

Important rules:

- Do not commit real ICS URLs, signing secrets, mail credentials, or private instance config files
- Checked-in config should keep using env-managed ICS URLs by variable name
- `config/config.json` may inline a direct ICS `url` for private local development only
- `HOUSE_CALENDAR_CONFIG_PATH` may point at a specific config file when you need
  a deterministic app config for local tooling or tests
- Viewer page passwords belong in env, not checked-in config
- The current deployment model supports multiple houses in one app instance, so keep viewer access global unless the feature explicitly changes that model

Useful config fields to know:

- `people[].defaultRoomId` sets the default occupied room for parsed `presence.in` events unless the title explicitly says `not staying`
- `calendarInterpretation.allDayEndDateMode` controls whether imported all-day ICS end dates use standard exclusive semantics or checkout-day semantics for availability
- `calendarDisplay.timedNotes.enabled` controls whether timed viewer notes appear in the calendar UI; it defaults to `true`
- Shared-space crash notes from all-day couch, sofa, or floor stay events are not timed notes. They remain visible as generic notes even when timed notes are disabled.
- `calendarDisplay.timedNotes.showTime` controls whether timed viewer notes show their time range
- `calendarDisplay.timedNotes.textSource` controls whether timed viewer notes use the event title, description, or both
- `site.branding.faviconPath` should point at a local asset under `public/`

## Day-To-Day Commands

Install dependencies:

```bash
bun install
```

See the derived worktree ports:

```bash
bun run ports
```

Optionally write `.env` for this worktree when you need to inspect or export the
derived local settings:

```bash
bun run ports:write
```

Start Postgres in Docker Compose:

```bash
bun run db:start
```

Stop Postgres:

```bash
bun run db:stop
```

Archive a worktree without leaving local dev processes or Compose containers
running:

```bash
bun run archive
```

The archive script only signals host processes that it can verify belong to the
current workspace by current working directory or command-line path. It then
runs `docker compose down --remove-orphans` for the workspace Compose project.
Use `bun run archive -- --dry-run` to inspect the matching processes and Compose
command without stopping anything.

Tail Postgres logs:

```bash
bun run db:logs
```

Start the app on the host:

```bash
bun dev
```

Run the full local verification flow:

```bash
bun run check
```

Run post-build regression checks for privacy markers, build output, and route/auth smoke tests:

```bash
bun run build
bun run regression
```

To check an already-running app, pass its base URL:

```bash
bun run regression -- --url http://127.0.0.1:5223
```

To also verify a real admin login without committing credentials, pass them via
env:

```bash
REGRESSION_ADMIN_EMAIL=owner@example.com \
REGRESSION_ADMIN_PASSWORD='correct horse battery staple' \
bun run regression -- --url http://127.0.0.1:5223
```

Run lint only:

```bash
bun run lint
```

Run browser integration tests for the viewer UI:

```bash
bun run test:integration
```

The Playwright config starts `bun dev` on the derived worktree app port and
uses `config/config.example.json` so private local config does not change test
coverage. By default it does not reuse an existing server on that port. If you
know the existing server was started with the same deterministic config, set
`PLAYWRIGHT_REUSE_EXISTING_SERVER=1` to opt into reuse. To run against an
already-running app, pass `PLAYWRIGHT_BASE_URL`, for example:

```bash
PLAYWRIGHT_BASE_URL=http://127.0.0.1:5223 bun run test:integration
```

Format the repo:

```bash
bun run format
```

Generate a Drizzle migration from schema changes:

```bash
bun run db:generate
```

Push schema changes directly to the database:

```bash
bun run db:push
```

`bun run typecheck` runs `tsc --noEmit`. TanStack Router route types are generated by the Vite/TanStack Start plugin and committed in `src/routeTree.gen.ts`.

## Admin Auth And Local Operator Flow

The app uses a small password-first admin model. SMTP is not required.
Failed admin logins are throttled in Postgres by default. The login form can
also require Cloudflare Turnstile when configured, but the default local
developer flow does not require a CAPTCHA service.

Generate a one-time bootstrap code:

```bash
bun run admin:bootstrap-code
```

Create a local-only admin account without using the setup page:

```bash
bun run admin:bootstrap-dev -- --email owner@example.com --password 'correct horse battery staple'
```

Reset the existing admin password and revoke all admin sessions:

```bash
bun run admin:reset-password -- --email owner@example.com --password 'new strong password'
```

When you are already signed in, you can also change the admin password from the
selected house admin page. The in-app flow requires the current password,
stores a new password hash, revokes other admin sessions, and keeps the current
browser signed in with a replacement session.

Minimal local setup flow:

1. Run `bun run db:start`
2. Run `bun run admin:bootstrap-code`
3. Open `/admin/setup`
4. Create the single admin account
5. Use `/admin/login` for normal password login afterward

Admin login protection policy belongs in app config, so template users can see
and change it without touching code:

```json
"adminSecurity": {
  "loginThrottle": {
    "enabled": true,
    "windowMinutes": 15,
    "lockoutMinutes": 15,
    "maxEmailFailures": 8,
    "maxEmailIpFailures": 5,
    "maxIpFailures": 30,
    "maxIpDailyFailures": 120,
    "failureDelayMs": 500
  },
  "loginChallenge": {
    "mode": "off",
    "provider": "turnstile",
    "afterFailures": 3
  }
}
```

Only deployment wiring and provider keys belong in env:

```bash
# Optional. Only set this when the app is behind a trusted proxy or Cloudflare.
ADMIN_LOGIN_IP_HEADER=cf-connecting-ip

# Optional but recommended. Used to HMAC login-attempt email/IP identifiers.
# Falls back to DATABASE_URL when unset.
ADMIN_LOGIN_IDENTIFIER_PEPPER=generate-a-long-random-secret

# Required only when adminSecurity.loginChallenge.mode is not "off".
ADMIN_TURNSTILE_SITE_KEY=...
ADMIN_TURNSTILE_SECRET_KEY=...
```

## Current Calendar Sync Behavior

- ICS imports are cached in-process with a short TTL
- `POST /admin/{siteId}/sync` forces a refresh and resets that house cache entry
- Cache state is not persisted yet, so restarting the app clears it
- Sample fallback is development-only when a site imports zero all-day ICS events; production should show the real empty state with warnings

## Calendar Authoring Tips

When you want to control what viewers see, treat the source calendar as having
two different jobs:

- All-day events drive occupancy interpretation.
- Short timed events can act as optional day notes for viewers.

Recommended patterns:

- Use all-day titles like `Someone stays (guest room)` or `Someone stays (whole house)` for actual overnight occupancy.
- Use `crashes` as a stay keyword when that matches how you write the event.
- Use couch, sofa, or floor language for shared-space crashes that should block the whole house without occupying a configured room.
- Use `maybe stay` or `(tentative)` when the stay is not confirmed.
- Use housemate presence titles that match your configured rules, such as `Michael (TPE)` or `Michael in Tokyo (not staying)`.
- Use timed events like `Cleaner 1pm-3:30pm JST` only for logistics you are comfortable showing to trusted viewers.

Privacy rules for timed events:

- Timed notes are displayed to viewers using the event title as written.
- ICS events with `CLASS:PRIVATE` or `CLASS:CONFIDENTIAL` are imported but skipped in the viewer note UI.
- Timed notes never mark a room occupied and never change whole-house availability on their own.

## Local Database Notes

Only Postgres is containerized locally.

- [compose.yml](./compose.yml) starts a local `postgres:18-alpine`
- [scripts/worktree-ports.ts](./scripts/worktree-ports.ts) derives unique app and database ports from the worktree path, or uses `CONDUCTOR_PORT` and the next port in Conductor's assigned range
- [scripts/db.ts](./scripts/db.ts) passes derived env to Docker Compose without writing `.env`
- [scripts/dev.ts](./scripts/dev.ts) passes derived env to Vite and starts it on the derived port
- [src/lib/server/db-schema.ts](./src/lib/server/db-schema.ts) is the Drizzle schema source

For local dev, the generated defaults are:

- `POSTGRES_DB=house_calendar`
- `POSTGRES_USER=house_calendar`
- `POSTGRES_PASSWORD=house_calendar`

You can override those by exporting env vars before running the scripts.
