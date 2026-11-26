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

If admin login protection is enabled beyond the default app throttle, it may
also need:

- Cloudflare Turnstile site and secret keys
- a trusted client IP header from the reverse proxy or edge provider

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

Admin login throttling policy is configured in `config/config.json` under
`adminSecurity.loginThrottle`. It is enabled by default and stores
failed-attempt counters in Postgres.

To make IP-based limits meaningful, configure the app to read a client IP
header only from infrastructure you trust. For Cloudflare, keep the origin from
being directly reachable and use:

```bash
ADMIN_LOGIN_IP_HEADER=cf-connecting-ip
```

This also applies when the app is served through Cloudflare Tunnel, provided
clients cannot bypass the tunnel and connect to the app origin directly.

For another trusted reverse proxy, prefer a single-client-IP header, such as
`x-real-ip`, that your edge sets after canonicalizing the client address. If you
must use `x-forwarded-for`, ensure your edge strips untrusted incoming values and
forwards a sanitized canonical client IP value to the origin. Do not trust these
headers when clients can reach the app origin directly.

Login-attempt email and IP identifiers are HMACed before storage. Set a stable
deployment secret for that HMAC when possible:

```bash
ADMIN_LOGIN_IDENTIFIER_PEPPER=generate-a-long-random-secret
```

If this value is unset, the app falls back to `DATABASE_URL` as server-held
secret material. Rotating the pepper effectively resets historical
login-attempt throttling buckets.

Optional Cloudflare Turnstile protection is also configured in
`config/config.json` under `adminSecurity.loginChallenge`.

Supported `loginChallenge.mode` values are:

- `"off"`: do not show a Turnstile challenge. This is the default.
- `"after_failures"`: show Turnstile after repeated failed login attempts.
- `"always"`: require Turnstile on every admin login attempt.

```json
"adminSecurity": {
  "loginChallenge": {
    "mode": "after_failures"
  }
}
```

All `adminSecurity` fields are optional. If omitted, admin login throttling uses
reasonable defaults: `loginThrottle.enabled=true`, `windowMinutes=15`,
`lockoutMinutes=15`, `maxEmailFailures=8`, `maxEmailIpFailures=5`,
`maxIpFailures=30`, `maxIpDailyFailures=120`, and `failureDelayMs=500`.
Turnstile defaults to `loginChallenge.mode="off"`, `provider="turnstile"`, and
`afterFailures=3`.

If `adminSecurity.loginChallenge.mode` is not `off`, configure the
deployment-specific Turnstile keys in env:

```bash
ADMIN_TURNSTILE_SITE_KEY=...
ADMIN_TURNSTILE_SECRET_KEY=...
```

The browser renders the site key on `/admin/login`, and the server validates
`cf-turnstile-response` with Cloudflare before checking the password.

## Google Calendar event creation

### Create a Google OAuth project

1. Sign in to Google Cloud as the Google account that owns the calendar. Open
   [Personal mode onboarding](https://console.cloud.google.com/auth/overview/personal)
   and create a new Personal mode project. Google keeps this project owner-only
   and skips verification and the seven-day testing limit. An existing External
   project cannot switch to Personal mode.
2. Choose **Web application**. Add the exact authorized redirect URI for your
   deployment, for example `https://house.example.com/admin/google-calendar/callback`.
   For local development, use `http://127.0.0.1:<port>/admin/google-calendar/callback`
   with the app port from `bun run ports`. Use that same browser origin when
   connecting or creating events in admin.
3. Save the generated client ID and client secret. In that project, enable the
   **Google Calendar API** under **APIs & Services → Library**. Under **Google
   Auth Platform → Data Access**, add
   `https://www.googleapis.com/auth/calendar.events.owned` if prompted to define
   the app’s requested scopes. This is the only scope requested by the app.
4. In Google Calendar, open **Settings → Settings for my calendars → your
   calendar → Integrate calendar**. Copy the **Calendar ID** and use the
   **Secret address in iCal format** for the same calendar’s existing ICS
   source. Keep both out of checked-in config. The ID must identify the calendar
   explicitly, including for a primary calendar.

Google documents the setup and the Personal audience restrictions in its
[OAuth onboarding guide](https://support.google.com/cloud/answer/15544987#zippy=%2Cquick-setup-for-personal-use-personal-mode).

### Enable writes for a house

Set the deployment variables below. Generate a 32-byte hex key with
`openssl rand -hex 32` and keep it stable across deploys. Generate a separate
random API token for each allowed house with the same command. Omit the API
token env var reference for browser-only access.

```bash
GOOGLE_CALENDAR_CLIENT_ID=...
GOOGLE_CALENDAR_CLIENT_SECRET=...
GOOGLE_CALENDAR_OAUTH_REDIRECT_URI=https://house.example.com/admin/google-calendar/callback
GOOGLE_CALENDAR_TOKEN_KEY=...
GOOGLE_CALENDAR_ID_TOKYO=...
GOOGLE_CALENDAR_API_TOKEN_TOKYO=...
```

Add this to the applicable entry in `sites` in `config/config.json`. Set
`icsSourceId` to the ID in that house’s `calendars` list for the same calendar.

```json
{
  "googleCalendarWrite": {
    "icsSourceId": "primary",
    "calendarIdEnvVar": "GOOGLE_CALENDAR_ID_TOKYO",
    "apiTokenEnvVar": "GOOGLE_CALENDAR_API_TOKEN_TOKYO"
  }
}
```

Apply the additive Google Calendar SQL migration in `drizzle/` before enabling
the pilot. On an existing database where the app created the admin tables,
apply just the new migration with `psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f
drizzle/0002_google_calendar_connection.sql`. A local development database can
use `bun run db:push`.

Open the house’s admin page, choose **Connect Google Calendar**, and approve
event access. This grant is shared across enabled houses. If it is revoked,
choose **Reconnect Google Calendar**. Disconnecting disables writes for all
houses and leaves their availability feeds active. Rotating the encryption key
requires reconnecting.

### API usage

`POST /api/sites/{siteId}/events` accepts JSON and the house’s API bearer token.
Supply a new UUID in `Idempotency-Key` for each intended event. On a timeout,
retry the same body and key against the same house and calendar. A new event
returns `201` and a replay returns `200`, both with `eventId` and `eventUrl`.
Reusing a key with different event data returns `409`. Failures return
`error.code` and `error.message`.

```bash
curl --fail-with-body https://house.example.com/api/sites/tokyo/events \
  -H "Authorization: Bearer $GOOGLE_CALENDAR_API_TOKEN_TOKYO" \
  -H "Idempotency-Key: $EVENT_REQUEST_UUID" \
  -H 'Content-Type: application/json' \
  --data '{"title":"Someone stays (guest room)","startDate":"2026-12-04","checkoutDate":"2026-12-06"}'
```

For timed events, supply `startDateTime` and `endDateTime` with RFC 3339 offsets
and optionally `showAsViewerNote: true`. The default is private. Both event
types accept an optional `description`. Google Calendar shows checkout day
for houses using `checkout_day` while availability ends the night before.
The viewer updates when Google publishes the event to ICS and the house’s
feed is fetched again.

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
- admin throttling and any Turnstile challenge mode behave as intended

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

## Edge Protection

App-level throttling should not be the only control on a public deployment.
When using Cloudflare, put the app behind proxied DNS and add WAF rate limiting
rules for admin endpoints.

Good starting rules:

- Rate limit `POST /admin/login/submit`, for example 5 requests per 5 minutes per client, with a Managed Challenge or temporary block action.
- Rate limit `POST /admin/setup/submit` more strictly if setup is exposed before the admin account exists.
- Add a broader, softer rule for `/admin/*` to slow scanning.

Example expressions:

```text
http.request.method eq "POST" and http.request.uri.path eq "/admin/login/submit"
```

```text
http.request.uri.path starts_with "/admin/"
```

Keep Cloudflare as the first layer. Keep the Postgres-backed app throttle
enabled because it still protects the origin when edge settings are incomplete
and it can key abuse by email as well as IP.
