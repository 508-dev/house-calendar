# DEPLOYMENT.md

## Purpose

This guide covers the minimum pieces needed to run `house-calendar` outside local development without assuming a specific host or platform.

Use [DEVELOPMENT.md](./DEVELOPMENT.md) for local setup and [ARCHITECTURE.md](./ARCHITECTURE.md) for the system model.

## What A Deployment Needs

At a minimum, a deployment needs:

- one running app instance
- one Postgres database
- a `DATABASE_URL` that points at that database
- a real app config file at `config/config.json`
- any secret env vars referenced by that config, such as `ICS_URL_*`

If viewer password protection is enabled, it also needs:

- `VIEWER_PASSWORD`

## Required Environment

Set `DATABASE_URL` to your production or hosted Postgres connection string.

Example:

```bash
DATABASE_URL=postgres://user:password@db-host:5432/house_calendar
```

If your config uses password-protected viewer access, also set:

```bash
VIEWER_PASSWORD=choose-a-strong-shared-password
```

Other env vars depend on your config. Common examples are:

```bash
ICS_URL_TOKYO=https://example.com/private-feed.ics
ICS_URL_TAIWAN=https://example.com/private-feed.ics
```

`ICS_SYNC_TTL_MINUTES` is optional if you want to override the default in-memory sync cache TTL.

## App Config

Do not rely on `config/config.example.json` as your real deployment config.

For deployment, make sure `config/config.json` is provided somehow. The app reads that file when present and falls back to the checked-in example only when it is missing.

Common ways to provide `config/config.json`:

- build it into the deployed artifact as a non-secret structural config file
- mount it at runtime from a volume or file secret
- generate it during deploy from a template and deployment variables
- sync it onto the host as part of your release process

The exact mechanism is up to your hosting setup. The important part is that the file exists at:

```text
config/config.json
```

If your deployment needs to place the config somewhere else, set
`HOUSE_CALENDAR_CONFIG_PATH` to that app-relative or absolute file path.

## Config Rules For Deployment

Keep the config split intact:

- checked-in structure can live in `config/config.example.json`
- deployment-specific structure should live in `config/config.json`
- secrets should stay in env, not in checked-in files

In practice that usually means:

- keep house/site structure, branding, rooms, people, and parsing rules in `config/config.json`
- keep sensitive ICS URLs in env by using `envVar` references in the config
- only inline ICS `url` values in `config/config.json` if your deployment model treats that file as private

If you use `viewerAccess.mode: "password"` in config, `VIEWER_PASSWORD` must also be set in env.

## Database

The app expects Postgres.

Before treating the deployment as live, make sure:

- the database is reachable from the app
- `DATABASE_URL` is set correctly
- schema changes have been applied

If you are managing schema changes manually, use the repo’s Drizzle workflow rather than ad hoc SQL.

## Basic Rollout Shape

1. Provision Postgres
2. Set `DATABASE_URL`
3. Provide `config/config.json`
4. Set any referenced secret env vars such as `ICS_URL_*`
5. Set `VIEWER_PASSWORD` if viewer password gating is enabled
6. Deploy the app
7. Apply any required database schema changes
8. Open the app and verify the default site loads
9. Visit `/admin/setup` or use the bootstrap helper flow if admin auth has not been initialized yet

## Post-Deploy Checks

After deployment, verify:

- the app starts without config or env errors
- the expected house pages resolve
- calendar feeds load for each configured site
- viewer access behaves as intended for `public` or `password` mode
- admin login or setup works
- the sync action at `/admin/{siteId}/sync` completes successfully

For a programmatic post-deploy smoke check, run:

```bash
bun run regression -- --url https://your-deployed-app.example
```

This checks viewer privacy markers, public build output, health, viewer routing,
and safe admin auth redirects. It does not submit admin credentials or mutate
calendar data.

If you want it to verify a real admin login, provide credentials through
deployment-local env vars:

```bash
REGRESSION_ADMIN_EMAIL=owner@example.com \
REGRESSION_ADMIN_PASSWORD='admin-password' \
bun run regression -- --url https://your-deployed-app.example
```

Do not commit these values.

## Notes

- The current calendar cache is in-memory and process-local, so restarts clear it
- Viewer access is deployment-global today, not house-scoped
- `config/config.json` should be treated as deployment state even when it contains only non-secret structure
