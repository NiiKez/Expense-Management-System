# Expense Management

A full-stack expense management system: employees submit expenses, managers approve or reject them, and admins have organisation-wide oversight. Authentication is delegated to Microsoft Entra ID; the manager hierarchy is sourced from Microsoft Graph.

- **Backend** — Express 4 + TypeScript, MySQL 8, Entra ID JWT auth (`jwks-rsa`), Zod validation, structured Winston JSON logs with secret redaction, Prometheus metrics on a separate internal listener.
- **Frontend** — React 19 + TypeScript + Vite 8, Tailwind CSS v4 + shadcn/ui (Radix) with a dark-by-default theme, Recharts dashboards, MSAL (PKCE) **or** a localhost-only stub-auth path, React Router, TanStack Query for server-state/data fetching, Axios with a token interceptor, react-hook-form + Zod, sonner toasts.
- **Database** — MySQL with optimistic concurrency on `expenses.version`, append-only `audit_logs`, soft delete on expenses.
- **Observability** — Prometheus + Grafana + Loki + Promtail, all wired in Docker Compose.
- **Tests** — Jest (server unit + integration against a real MySQL container), a lighter Jest + React Testing Library suite on the client, and Playwright e2e against a stub-auth dev server.
- **CI/CD** — GitHub Actions: lint → unit → build → (integration ‖ e2e), with client lint/test/build in parallel, then docker build → push to GHCR on `main`.

## Repository Layout

```
client/      Vite React frontend (MSAL + stub auth, Tailwind/shadcn, Recharts)
server/      Express API (TypeScript, MySQL, Prometheus)
database/    schema.sql, stored-procedures.sql, seed.sql, migrations/
docker/      Compose files, Dockerfile(s), Prometheus/Grafana/Loki/Promtail config
e2e/         Playwright specs and fixtures
docs/        Design specs and implementation plans (git-ignored, not shipped)
.github/     CI workflow
```

Each workspace (`server/`, `client/`, `e2e/`) has its own `package.json` and is run independently — this is **not** an npm-workspaces monorepo. The root `package.json` orchestrates the e2e MySQL container and the Playwright runner, and also carries the client's Jest test toolchain.

## Prerequisites

- Node.js 20+ (20.19+ recommended — the Vite 8 client requires it)
- Docker Desktop (for the full stack and integration / e2e tests)
- An Entra ID tenant + app registration with the `EMPLOYEE`, `MANAGER`, `ADMIN` app roles (only required to run with real auth — local dev and e2e use the stub-auth path)

## Quick Start (Docker Compose)

1. Copy the env template and fill in real secrets:
   ```powershell
   Copy-Item server/.env.example server/.env
   ```
   At minimum set `DB_PASSWORD`, `MYSQL_ROOT_PASSWORD`, `GRAFANA_ADMIN_PASSWORD`, `ENTRA_TENANT_ID`, and `ENTRA_CLIENT_ID`. `ENTRA_CLIENT_SECRET` is only needed for Graph API (manager hierarchy) calls.

2. Bring up the full stack from the repo root:
   ```powershell
   docker compose --env-file server/.env -f docker/docker-compose.yml up --build
   ```

3. Published ports (all bound to `127.0.0.1`; only the **API**'s bind address is configurable — set `APP_BIND_HOST=0.0.0.0` when fronting it with a reverse proxy. Prometheus and Grafana stay loopback-only):

   | Service     | Default port (env override)        | Notes                                          |
   | ----------- | ---------------------------------- | ---------------------------------------------- |
   | API         | `3000` (`PORT`)                    | Public app port                                |
   | Prometheus  | `9090` (`PROMETHEUS_PORT`)         |                                                |
   | Grafana     | `3001` (`GRAFANA_PORT`)            | Login with `GRAFANA_ADMIN_USER` / password     |
   | MySQL       | not published                      | Internal Compose network only                  |
   | Loki        | not published                      | Consumed by Grafana via internal network       |
   | Promtail    | not published                      | Ships container logs to Loki internally        |
   | API metrics | `9464` (internal listener, `METRICS_PORT`) | Scraped by Prometheus, never published to host |

   The API runs as a non-root user (with `tini` as PID 1 for clean signal handling) on a read-only root filesystem, with dropped Linux capabilities and per-container CPU, memory, and PID limits; the application and primary MySQL images are pinned by digest (the observability images use fixed version tags) and container logs are size-capped (`max-size: 10m`, `max-file: 3`). Receipt uploads persist to the named `app_uploads` volume.

4. Use `docker/docker-compose.override.yml` for ad-hoc local debugging overrides (e.g. publishing the MySQL port on `127.0.0.1:3306`). That file is gitignored.

## Local Development (without Docker)

The API runs on bare Node (`npm run dev`) but still needs a reachable MySQL 8. The
simplest path is to run **only** the Compose MySQL service with its port published to
the host — no need to bring up the rest of the stack.

### Database (MySQL for `npm run dev`)

1. Start just the MySQL container, with the port published to `127.0.0.1:3306`:
   ```bash
   docker compose --env-file server/.env \
     -f docker/docker-compose.yml \
     -f docker/docker-compose.override.yml \
     up -d mysql
   ```
   The base compose file keeps MySQL on the internal Docker network only;
   `docker/docker-compose.override.yml` adds the `127.0.0.1:3306:3306` mapping so the
   bare-node API can reach it. Schema + stored procedures load automatically on first
   start, and data persists in the `mysql_data` volume.

2. Wait until it reports `(healthy)`:
   ```bash
   docker compose --env-file server/.env \
     -f docker/docker-compose.yml \
     -f docker/docker-compose.override.yml \
     ps mysql
   ```

3. Load the demo seed **once** — the base compose file does not load it (unlike the e2e
   compose). Skip this if `users` is already populated, since the seed uses fixed IDs and
   re-running it is a no-op (each insert is guarded by `WHERE NOT EXISTS`):
   ```bash
   mysql -h 127.0.0.1 -P 3306 -u expense_app -p"$DB_PASSWORD" expense_management < database/seed.sql
   ```
   Use the `DB_USER` / `DB_PASSWORD` values from `server/.env`. PowerShell has no `<`
   redirect — pipe instead: `Get-Content database/seed.sql | mysql -h 127.0.0.1 -P 3306 -u expense_app -p"$env:DB_PASSWORD" expense_management`.

After first-time setup, the daily routine is just step 1 (start MySQL) then the backend
below. Stop MySQL with the same `-f` flags + `stop mysql`; `down -v` wipes the container
**and** the seeded data.

### Backend
```powershell
cd server
npm install
npm run dev          # nodemon + ts-node, hot-reloads on changes
npm run build        # tsc → dist/
npm test             # jest --forceExit --detectOpenHandles
npm run lint
```
With MySQL up (see above), `npm run dev` should log `MySQL pool connected`. The API listens on `PORT` (default `3000`). When running on bare Node, `METRICS_HOST` defaults to `127.0.0.1`; Compose overrides it to `0.0.0.0` so Prometheus on the internal network can scrape.

### Frontend
```powershell
cd client
npm install
npm run dev          # vite dev server on :5173
npm run build        # tsc -b && vite build
npm run preview
npm run lint
npm test             # jest + React Testing Library
```
The client reads its own `VITE_*` env vars from `client/.env` (template in `client/.env.example`):

- `VITE_AUTH_MODE` — `msal` (Entra ID, default) or `stub` (localhost-only test login)
- `VITE_API_URL` — backend base URL; point this at the running API (e.g. `http://localhost:3000/api/v1`). HTTPS is enforced unless the host is localhost. *(The shipped `.env.example` default is `http://localhost:4444/api/v1`; change it to match your server's `PORT`.)*
- `VITE_ENTRA_CLIENT_ID`, `VITE_ENTRA_TENANT_ID`, `VITE_REDIRECT_URI` — MSAL config (required for real auth; ignored in stub mode)

In stub mode (`VITE_AUTH_MODE=stub`, localhost only) the login page lists the seeded users and signs in via an `X-Stub-User-Id` header instead of MSAL — this is the path Playwright drives.

## Environment Configuration

`server/.env.example` documents the core backend variables. Highlights below — a handful of optional code- and Compose-only knobs (`DB_POOL_SIZE`, `JSON_BODY_LIMIT`, `ENTRA_TOKEN_AUDIENCE`, `TRUST_PROXY`, `APP_BIND_HOST`, `PROMETHEUS_PORT`, `GRAFANA_PORT`, `COMPOSE_PROJECT_NAME`) fall back to the defaults noted here when left unset, so they may not all appear in the template:

- **Database** — `DB_HOST`, `DB_PORT`, `DB_USER`, `DB_PASSWORD`, `DB_NAME`, `DB_POOL_SIZE` (default 20)
- **API** — `PORT`, `NODE_ENV`, `LOG_LEVEL`, `CORS_ORIGIN` (comma-separated allowlist), `JSON_BODY_LIMIT` (default 100 kB)
- **Metrics** — `METRICS_PORT`, `METRICS_HOST`
- **Proxying** — `TRUST_PROXY_HOPS` (set to the exact number of proxies in front of the API; using `true` would let any client spoof `X-Forwarded-For`). `TRUST_PROXY=true` is a coarse fallback (one hop) when the hop count is unset.
- **Rate limits** (per 15 min unless noted) — `API_RATE_LIMIT_MAX` (1000), `STRICT_RATE_LIMIT_MAX` (100, applied to `/approvals` and `/admin`), `UPLOAD_RATE_LIMIT_MAX` (20, per-user on `POST /expenses`), `HEALTH_RATE_LIMIT_MAX` (60/min)
- **Entra ID** — `ENTRA_TENANT_ID`, `ENTRA_CLIENT_ID`, `ENTRA_CLIENT_SECRET` (optional, Graph OBO only), `ENTRA_TOKEN_AUDIENCE` (optional override of accepted audiences; defaults to `api://{clientId}` and `{clientId}`)
- **Stub auth** — `ALLOW_STUB_AUTH=true` enables a loopback-only test login path used by Playwright (also requires `NODE_ENV=development`). The server refuses to boot if this is set outside development. Never set it in production.
- **Compose** — `MYSQL_ROOT_PASSWORD`, `GRAFANA_ADMIN_USER`, `GRAFANA_ADMIN_PASSWORD`, `APP_BIND_HOST`, `PROMETHEUS_PORT`, `GRAFANA_PORT`, `COMPOSE_PROJECT_NAME`

The frontend has its own `client/.env` / `client/.env.example` with the `VITE_*` vars listed under [Frontend](#frontend) above.

Never commit `.env`, `.npmrc`, certificates, private keys, database dumps, or Docker data directories.

## Database

Schema lives in `database/schema.sql`. Six tables (all InnoDB):

- `users` — Entra-synced (`entra_id` unique), `role` ENUM (`EMPLOYEE` / `MANAGER` / `ADMIN`), self-referencing `manager_id` (ON DELETE SET NULL), `is_active` flag, plus self-service preference columns (`default_currency`, `notify_on_submission`, `notify_on_decision`, `notify_on_comment`)
- `expenses` — `amount` DECIMAL(10,2) with a `CHECK (amount > 0)` (max 99,999,999.99), `currency`, `category` ENUM, `status` ENUM, `version` (optimistic concurrency), soft-delete columns (`deleted_at`, `deleted_by`), and a conditional CHECK requiring `rejection_reason` when status is `REJECTED`
- `receipts` — file metadata, FK to `expenses` with CASCADE
- `comments` — discussion thread on an expense (submitter ↔ approver), FK to `expenses` with CASCADE
- `notifications` — per-user in-app notifications (no email), generated on lifecycle events + comments; FK to `expenses` with CASCADE
- `audit_logs` — append-only (UPDATE/DELETE blocked by triggers `trg_audit_logs_no_update` / `trg_audit_logs_no_delete`), FK to `expenses` with RESTRICT — expense deletion is therefore soft and handled transactionally in the expense model. The `action` ENUM includes `RESUBMITTED` for the reject→fix→resubmit flow.

Stored procedures (`database/stored-procedures.sql`) — `sp_approve_expense`, `sp_reject_expense`, `sp_override_expense`, `sp_get_team_expenses`, `sp_delete_expense`, and `sp_submit_expense` — are all loaded by Compose. Approve and reject run through `sp_approve_expense` / `sp_reject_expense` (which perform the optimistic-concurrency `version` check inside the proc); the remaining four are currently unused — those flows (team listing, override, soft-delete, submit) use inline SQL in transactions instead.

`database/migrations/` holds dated, manually-applied additive SQL (not a migration framework): one migration adds the `comments`/`notifications` tables and the `RESUBMITTED` audit action; another adds the user preference columns. Both are already folded into `schema.sql`, so a fresh database built from `schema.sql` needs neither.

`database/seed.sql` is sample dev data (7 users — Alice (ADMIN) / Bob & Carol (MANAGER) / Dave, Eve, Frank, Grace (EMPLOYEE), in a two-manager hierarchy under Alice; 6 expenses across categories and statuses) and is **not** loaded by the production Compose file. Each insert is guarded with `WHERE NOT EXISTS`, so it only populates empty tables. To use it locally, run it explicitly against a disposable dev database after schema initialisation. The e2e compose file does load it.

## API

All routes live under `/api/v1/`:

| Route                                       | Auth          | Notes                                                          |
| ------------------------------------------- | ------------- | -------------------------------------------------------------- |
| `GET  /health`                              | public        | DB connectivity check                                          |
| `GET  /me`                                  | any role      | Current user profile (created/synced from JWT on first call)   |
| `PATCH /me/preferences`                     | any role      | Update own preferences (default currency, notification toggles)|
| `GET  /me/stats`                            | any role      | Personal aggregate stats for the dashboard                     |
| `POST /expenses`                            | any role      | Create expense, multipart receipt upload (PDF/JPG/PNG, 5 MB)   |
| `GET  /expenses`                            | any role      | List own expenses (filter, sort, paginate)                     |
| `GET  /expenses/export`                     | any role      | CSV of own expenses (respects filters + sort)                  |
| `GET  /expenses/:id`                        | any role      | Get one (own only for employees)                               |
| `GET  /expenses/:id/receipts/:receiptId`    | any role      | Download a receipt file                                        |
| `PUT  /expenses/:id`                        | any role      | Update own PENDING expense (optimistic concurrency)            |
| `POST /expenses/:id/resubmit`               | any role      | Resubmit own REJECTED expense (edits + back to PENDING)        |
| `DELETE /expenses/:id`                       | any role      | Delete own PENDING expense (soft delete)                       |
| `GET  /expenses/:id/comments`               | any role      | List comments (anyone who can view the expense)                |
| `POST /expenses/:id/comments`               | any role      | Add a comment                                                  |
| `GET  /notifications`                       | any role      | Current user's in-app notifications (paginated)                |
| `GET  /notifications/unread-count`          | any role      | Unread badge count                                             |
| `PATCH /notifications/:id/read`             | any role      | Mark one read                                                  |
| `POST /notifications/read-all`              | any role      | Mark all read                                                  |
| `GET  /approvals/pending`                   | MANAGER/ADMIN | Pending expenses for direct reports                            |
| `PATCH /approvals/:id/approve`              | MANAGER/ADMIN |                                                                |
| `PATCH /approvals/:id/reject`               | MANAGER/ADMIN | Requires `reason` in the request body                          |
| `GET  /manager/employees`                   | MANAGER       | Direct-report directory (Graph-backed)                         |
| `GET  /manager/stats`                       | MANAGER       | Team rollup aggregates                                         |
| `GET  /admin/expenses`                      | ADMIN         | Org-wide ledger with filters, sort, pagination                 |
| `GET  /admin/expenses/export`               | ADMIN         | CSV of the filtered org ledger                                 |
| `GET  /admin/users`                         | ADMIN         |                                                                |
| `GET  /admin/stats`                         | ADMIN         | Org-wide aggregate stats                                       |
| `GET  /admin/audit-logs`                    | ADMIN         | Filter by expense, actor, action, date range; sortable         |
| `GET  /admin/audit-logs/export`             | ADMIN         | CSV of the filtered audit trail                                |

> The `/manager/*` routes are gated to `MANAGER` only (ADMIN is not granted manager scope). All non-`/health` routes require authentication.

List endpoints accept `sort` (allow-listed column key) and `order` (`asc`/`desc`). Dashboard/stats money totals are normalized to a base currency (`USD`) via static FX rates in `server/src/utils/fx.ts` — the supported currencies are USD, EUR, GBP, CAD, AUD, and JPY (amounts in any other currency are summed at face value, 1:1); per-expense amounts keep their own currency.

Response envelope: `{ success: boolean, data?: ..., error?: { message, statusCode } }`. Validation failures from Zod add an `error.details` array of `{ field, message }`. Paginated list responses include a `pagination: { total, page, pageSize }` block. Errors serialise through the global `errorHandler` middleware.

### Auth model
The auth middleware verifies the bearer JWT against Entra ID via JWKS (RS256 only, issuer + audience checked), then auto-upserts the caller into `users` keyed by `oid`. Roles are sourced from the `roles` JWT claim on every request — Entra ID app roles are the source of truth, and the DB `role` column is synced to match. If a user has multiple roles, highest privilege wins (`ADMIN` > `MANAGER` > `EMPLOYEE`); a token **without** a recognised app role is rejected with `403` (it does not silently default to `EMPLOYEE`). Deactivated users (`is_active = false`) get `401`. Routes use `authorize([roles])` as a coarse gate; controllers enforce stricter business rules (employees only see/modify their own `PENDING` expenses).

The stub-auth path (`ALLOW_STUB_AUTH=true` + `NODE_ENV=development` + a loopback request) reads an `X-Stub-User-Id` header instead of a JWT and is used only by local dev and Playwright.

## Testing

### Server unit + integration (Jest, in `server/`)
```powershell
cd server
npm test
npm run test:coverage
npx jest path/to/file.test.ts --forceExit --detectOpenHandles   # single file
```
Integration tests need MySQL — easiest path is the dedicated compose, which runs Jest inside a container against a fresh (tmpfs-backed) MySQL. Set `MYSQL_TEST_ROOT_PASSWORD` and `MYSQL_TEST_PASSWORD` first (the compose file fails fast without them; CI generates random per-run values):
```powershell
$env:MYSQL_TEST_ROOT_PASSWORD="dev"; $env:MYSQL_TEST_PASSWORD="dev"
docker compose -f docker/docker-compose.test.yml up --build --exit-code-from test-runner
```

### Client unit (Jest + React Testing Library, in `client/`)
```powershell
cd client
npm test
npm run test:coverage
```
This suite covers the services layer, the React Query hooks, utilities, and a broad set of components and pages — the employee/manager/admin dashboards, the expense form and detail view, admin expenses/users/audit-log, notifications, the sidebar, plus an accessibility smoke test — with the e2e suite layering full user journeys on top. Note that the global coverage thresholds in `client/jest.config.cjs` are still set to a low floor and have not yet been ratcheted up to match the added tests.

### End-to-end (Playwright, from repo root)
The e2e suite runs the API **and** the Vite client on the host (so the loopback check in `auth.ts` for stub auth works) against an ephemeral MySQL container on `127.0.0.1:3307`. Playwright starts both servers via its `webServer` config.
```powershell
npm run e2e            # one-shot: brings up MySQL, runs all specs
npm run e2e:ui         # Playwright UI mode (assumes DB is up)
npm run e2e:headed     # headed Chromium
npm run e2e:db:up      # just the MySQL container
npm run e2e:db:down    # stop + wipe volume
npm run e2e:db:reset   # full teardown + fresh seed
npm run e2e:report     # show last HTML report
```
Specs are serial (`workers: 1`, Chromium only), authenticate via `data-testid="stub-login-${userId}"` on `/login`, and isolate state by appending a UUID suffix to titles they create. The five spec files cover auth/RBAC, employee, manager, admin, and detail-page actions. Fixtures (`e2e/fixtures/users.ts`) mirror `database/seed.sql`.

## Observability

- **Prometheus** scrapes the API's internal `:9464` metrics endpoint (plus itself, Loki, Promtail, and Grafana). Custom metrics: `expense_submissions_total`, `expense_approvals_total`, `expense_resolution_seconds`, `api_request_duration_seconds`, `api_errors_total`, plus default Node.js metrics. Retention is capped at 15 days **and** 2 GB on disk (whichever hits first); the admin API and lifecycle endpoint are disabled.
- **Grafana** is provisioned from `docker/grafana/provisioning/`. Both Prometheus and Loki are pre-wired as read-only datasources (Prometheus is default), with a provisioned expense dashboard. Sign-up, org creation, anonymous access, Gravatar, and usage analytics are all disabled.
- **Loki + Promtail** — Promtail mounts the Docker socket (read-only), discovers only this project's containers (matched by an anchored Compose project label, so a sibling project such as `…-e2e` can't leak its logs in), and ships their stdout to Loki. The `app` container's JSON logs are parsed so `level` becomes a queryable label. Default retention is 7 days (168h, `docker/loki/loki-config.yml`). Query in Grafana Explore with LogQL, e.g. `{service="app", level="error"}`.

## Security

- Helmet headers, strict CORS allowlist (rejected origins are logged), `x-powered-by` disabled
- JSON body limit (`JSON_BODY_LIMIT`, default 100 kB)
- Rate limiters: a global API limiter, a stricter limiter on `/approvals` and `/admin`, a separate health limiter, and a per-user upload limiter on `POST /expenses`
- `TRUST_PROXY_HOPS` is a hop count rather than a boolean to prevent `X-Forwarded-For` spoofing
- Receipt uploads are validated by both declared MIME type **and** magic-byte signature, capped at 5 MB / 1 file, and stored under random UUID filenames
- Winston logs run through a redaction format that scrubs tokens, secrets, authorization headers, passwords, and cookies
- App container runs non-root (with `tini` as PID 1 for graceful shutdown) on a read-only rootfs, with `cap_drop: ALL`, `no-new-privileges`, and per-container CPU, memory, and PID limits; the application and primary MySQL images are digest-pinned (the observability images use fixed version tags) and container logs are size-capped (`max-size: 10m`, `max-file: 3`) so the json-file driver can't fill the host disk
- MySQL is not published to the host
- Stub auth requires `ALLOW_STUB_AUTH=true`, `NODE_ENV=development`, **and** a loopback request — Docker's port forwarding deliberately breaks the loopback check so the stub path can never be reached from outside the host

## CI/CD

`.github/workflows/ci.yml` runs on push and pull requests to `main` or `master`:

```
lint → unit-tests → build ─┬→ integration-tests ─┐
                           └→ e2e-tests ──────────┤→ docker-build → docker-push (main push only)
client-tests ───────────────────────────────────┘
```

- `client-tests` (lint + Jest + build for `client/`) runs in parallel with no dependencies and also gates `docker-build`.
- E2E browsers are cached; the Playwright HTML report and traces upload as artifacts on failure (14-day retention).
- Coverage from server unit tests uploads as an artifact (7 days).
- `docker-build` builds `expense-management-server` (no push). `docker-push` runs only on a push to `main` and publishes `ghcr.io/${owner}/expense-management-server:${sha}`. The script also contains a release-tag branch (`:latest` + the git tag) that is currently unreachable, since the workflow has no tag trigger and `docker-push` is gated to `main`.

## Project Conventions

- TypeScript strict mode everywhere; `@/*` path alias maps to `src/*` in `server/` and `client/` (Jest's `moduleNameMapper` matches).
- Backend models are object literals (`export const expenseModel = { ... }`) issuing direct SQL through the `mysql2` pool — not classes, not an ORM.
- Errors are `AppError` instances created via factories (`notFound`, `forbidden`, `badRequest`, `conflict`, `unauthorized`); controllers `next(err)` and the global `errorHandler` serialises them.
- Approvals (approve/reject) **must** check `version` — race conditions surface as `null` from the model and become a `409 Conflict`. Expense edits via `PUT /expenses/:id` don't currently take a client-supplied version, so they aren't version-guarded.
- ESLint: `no-unused-vars` is an error, but identifiers (args **and** variables) prefixed with `_` are allowed; `no-explicit-any` is a warning.
