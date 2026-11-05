# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project overview

Deploy Window Manager — a tool for banking marketplace teams to know which days/hours are safe to deploy, based on a promotional calendar. Deploys are blocked or restricted when active promotions are running (a deploy interrupts push communications and purchase flows).

## Stack

- **Backend**: FastAPI + SQLAlchemy 2 + PostgreSQL + Alembic + Pydantic v2
- **Frontend**: Next.js 14 (App Router) + TypeScript + Tailwind CSS
- **Auth**: JWT (python-jose), bcrypt (passlib + bcrypt==3.2.2 pinned for compatibility)
- **Infra**: Docker + docker-compose

## Common commands

### Backend

```bash
cd backend

# Run locally (requires a running Postgres)
uvicorn app.main:app --reload

# Run all tests
pytest

# Run a single test file
pytest tests/test_engine.py -v

# Run a specific test
pytest tests/test_engine.py::test_promo_especial_no_rule_returns_bloqueado -v

# Seed the database
python -m app.db.seed

# Create a new Alembic migration
alembic revision --autogenerate -m "describe change"

# Apply migrations
alembic upgrade head
```

### Frontend

```bash
cd frontend

npm install
npm run dev      # http://localhost:3000
npm run build    # also the only type check — there is no lint/tsc script
npm run start
```

There is no linter or formatter configured for either backend or frontend. Backend tests cover only pure functions with no DB or network: the rules engine (`test_engine.py`), CMO metrics (`test_executive.py`), GA4 bot heuristics (`test_bot_detection.py`), GA4 access merging (`test_ga4_access.py`) and Cloudflare IP/UA classification (`test_cloudflare_classify.py`). Keep new logic in these modules I/O-free so it stays testable the same way.

### Docker (full stack)

```bash
# From repo root — starts Postgres + backend (with seed) + frontend
docker-compose up --build

# Tear down and remove volumes
docker-compose down -v
```

Production uses `docker-compose.prod.yml` (env-var-driven secrets/ports, no host Postgres port, `restart: unless-stopped`). `redeploy-prod.sh [--no-cache]` pulls latest git, rebuilds backend+frontend images, and force-recreates them — needed because the prod host (Portainer) only re-applies `command:` on redeploy, not image rebuilds.

## Architecture

### API routing (frontend → backend)

All API calls go through a catch-all Next.js App Router handler at `frontend/app/api/[...path]/route.ts`. It proxies every method to the backend, manually following FastAPI's trailing-slash 307 redirects (undici can't resend a streamed body on redirect). The `BACKEND_URL` env var controls the target (`http://backend:8000` in Docker, `http://localhost:8000` locally).

### Rules engine (`backend/app/rules/engine.py`)

This is the core. The engine is **stateless** — it receives lists of `Promotion` and `DeployRule` ORM objects and returns computed `DeployWindowDay` values. No DB calls inside the engine.

Key invariants:
- `BLOQUEADO > RESTRINGIDO > LIBRE` — the most restrictive status always wins when multiple promotions are active on the same day.
- Default fallback (no matching rule): `PROMO_ESPECIAL` → `BLOQUEADO`, `PROMO_NORMAL` → `RESTRINGIDO`.
- Rules match on `promo_type` AND `promotion.criticality >= rule.min_criticality`. When multiple rules match, the most restrictive one wins.
- Restricted windows are **intersected** (not unioned) across promos — the tightest common window is used.
- `can_deploy_now` uses `pytz` to evaluate current local time against the window in the country's timezone.

### Deploy status flow

```
GET /deploy-windows        → loads Promotions + DeployRules from DB → engine.compute_windows() → DeployWindowDay[]
GET /deploy-status/today   → same, but single day + adds can_deploy_now boolean
GET /public/status         → all clients, no auth required; merges GA4 realtime + in-memory tracker for active users
GET /public/calendar       → all clients, no auth required; month grid of merged deploy status, used by /landing
```

`GET /public/status` is the heaviest endpoint: per client it fans out GA4 and Cloudflare fetches in parallel thread pools, then attaches `cloudflare` (via `cloudflare_service.public_summary`) and `bot_suspicion` (via `bot_detection.assess_bot_suspicion`) to each client. Both the landing grid and `/landing/[slug]` read only this one endpoint.

**Traffic-threshold override**: `Client.user_threshold` (nullable int) lets a client force `BLOQUEADO` when live traffic spikes, independent of any promotion. In `GET /public/status`, if `user_threshold` is set and current active users (GA4 realtime if configured, else the in-memory tracker) reach or exceed it, the engine's computed status is overridden to `BLOQUEADO` and `can_deploy_now` is forced `False`. This override is UI-facing only (`/landing`, `/public/status`) — it does not touch `compute_windows()`/`compute_day_status()` in the rules engine itself, and is not applied by the authenticated `/deploy-windows` or `/deploy-status/today` endpoints.

### Scheduler (APScheduler)

`backend/app/scheduler.py` runs a `BackgroundScheduler` (UTC) that sends Google Chat webhook notifications at up to 3 configurable daily times. Jobs are rebuilt whenever `NotificationConfig` is updated via `POST /notifications/config` and are restored from DB on startup (`lifespan` in `main.py`).

### GA4 integration

GA4 service account credentials are stored as JSON in the `integration_configs` table under key `ga4_service_account`. Clients can have a `ga4_property_id`; `GET /ga4/realtime` fetches active users for all configured clients in parallel (up to 8 threads). The public status endpoint uses GA4 data when available, with a fallback to the in-memory GTM tracker (`services/tracker.py`) which counts page view events in a 5-minute sliding window. The tracker is fed by `GET /tracking/{client_id}/ping` — a public, CORS-open endpoint returning a 1x1 GIF so it can be fired as a GTM Custom Image tag. Tracker state is per-process memory (lost on restart, not shared across workers).

**Property access (who can see each GA4 property)**: `GET /ga4/access` and `GET /ga4/access/{client_id}` (admin only) call the GA4 Admin API REST `accessBindings` (v1alpha) through `services/ga4_access.py` using the same stored credentials, but with scopes `analytics.readonly` (needed for `properties.get`/`accounts.get`) + `analytics.manage.users.readonly` (needed for `accessBindings.list`). They return property-level users plus users inherited from the parent account. The effective role is the highest of the two, and data restrictions (no-cost/no-revenue) are listed separately. Requirements: the Admin API must be enabled in the Cloud project, and the SA needs the Administrator role (for OAuth, the refresh token needs that scope). If the account-level read fails, the response still returns the property users plus `account_error`. Results are cached 10 min (`?refresh=true` bypasses it). `merge_access()` is pure and tested in `test_ga4_access.py`. In `/admin` → GA4, each client has a "Ver usuarios" button that opens a modal with CSV export, plus an "Exportar usuarios de todos" button. The CSV uses `;` + BOM so Excel in Spanish opens it correctly.

`IntegrationConfig` doubles as generic key/value storage beyond GA4 creds: `GET /public/status` tracks the day's ecosystem-wide peak concurrent users under key `ecosystem_peak_today` (`{"date": ..., "peak": ...}`), persisted on every new peak so it survives container restarts (`tracker.set_peak_state()` reloads it at startup).

### Executive (CMO) view

`GET /executive/overview` (auth required, because revenue must never reach `/public/*`) builds the whole `/executive` payload. `services/ga4_reports.py` runs a single GA4 Data API batch per property: 70 days of daily sessions/keyEvents/purchases/revenue, plus a 7-day channel breakdown and a 7-day campaign breakdown. It caches the result for 1h and returns stale data on error. The APScheduler job `executive_warm` (every 30 min) keeps that cache warm. All of the math lives in `services/executive.py` and is pure:
- Windows cover complete days only: the last 7 days vs. the 7 before them.
- The conversion metric is purchases when the property reports ecommerce, otherwise key events.
- Revenue is grouped per currency; there is no FX conversion.
- Promo lift is the average per day during the promo vs. up to 14 earlier days with no promos for that same client.

`backend/scripts/check_ga4_ecommerce.py` is a read-only check of which properties really report ecommerce.

### Cloudflare integration & bot detection

Credentials (`account_id` + `api_token`) live in `IntegrationConfig` under key `cloudflare` (`get_cf_creds()` in `api/endpoints/cloudflare.py`). A client is linked to Cloudflare through `Client.site_host` (stored normalized by `normalize_host()`: no scheme, path, port or `www.`), which is matched to the account's zone that contains it. `cloudflare_service.get_bot_traffic()` queries the GraphQL Analytics API for the last 15 minutes and returns bot/datacenter IPs only (residential IPs are never returned), plus zone `health` and `firewall` events. Data is cached in process memory (zones 1h, traffic 2 min). Zones on the Free plan lack ASN and firewall data; the service records this in `_no_asn_zones`/`_no_fw_zones` and degrades without failing.

`services/bot_detection.py` is a pure scoring heuristic over GA4 realtime data (no IP/UA available there): each signal adds weight, total ≥4 → `likely`, ≥2 → `possible`. Cloudflare's non-search bot share is one extra signal. Below `MIN_USERS`/`CF_MIN_REQUESTS` signals are ignored as noise. GA4 users with unknown country (`(not set)`/`ZZ`) don't count as foreign traffic.

GA4 results are also cached per property in `ga4_service` and stale data is returned on any error (needed to stay within quota). Keep that behavior if you touch the service.

### Auth

Three roles: `admin` (CRUD everything), `reader` (GET only), `comercial` (can create/delete promotions). JWT payload carries `sub` (user id) and `role`. Dependency functions in `api/deps.py`: `get_current_user`, `require_admin`, `require_admin_or_comercial`.

Frontend: JWT stored in a cookie (`access_token`, 1-day expiry) via `js-cookie`. `AuthProvider` (`lib/auth.tsx`) provides `useAuth()` hook throughout the app. `AuthGuard` component wraps each protected page and redirects to `/login` if not authenticated. On 401 response the axios interceptor in `lib/api.ts` clears the cookie and redirects to `/login`.

### Frontend pages

| Route | Description |
|---|---|
| `/dashboard` | Semáforo per-client: "¿puedo deployar ahora?" |
| `/calendar` | Month grid with color-coded days + detail panel |
| `/promotions` | List + create form (create/delete for admin + comercial) |
| `/admin` | Tabbed admin panel: Countries, Clients, Deploy Rules, Notifications (Google Chat), GA4, Cloudflare, Repositories, Teams |
| `/executive` | CMO view (any logged-in role): 7-day business KPIs, per-client table, promo lift, upcoming promos. `/executive/[slug]` is the per-client detail |
| `/landing` | Public-facing status page (no login required), auto-refreshing from `/public/status` |
| `/landing/[slug]` | Per-client public detail page; slug comes from `clientSlug()` in `components/landing/parts.tsx` (accent-stripped kebab name, falling back to the id) |

Shared landing UI lives in `components/landing/parts.tsx`. Light/dark/auto appearance: `lib/theme.tsx` (`ThemeProvider`, mode saved in `localStorage.theme`) plus `THEME_INIT_SCRIPT` from `lib/theme-script.ts`, inlined in `<head>` by `app/layout.tsx` so the page doesn't flash the wrong theme. Styling uses Tailwind's `dark` class on `<html>`.

### Schema changes / DB init

The container does **not** just run `alembic upgrade head`. It runs `python -m app.db.init_db`, which handles three cases: fresh DB → `create_all` + `alembic stamp head`; legacy DB with no `alembic_version` → `create_all` + `_patch_missing_columns()` (hand-written `ALTER TABLE`s) + stamp; tracked DB → `alembic upgrade head`. `main.py`'s lifespan also calls `Base.metadata.create_all` on every startup.

When adding a column: update the model, add an Alembic migration in `backend/alembic/versions/` (numbered `00N_*.py`), and if legacy (untracked) DBs must keep working, also add it to `_patch_missing_columns()` in `init_db.py`. The docker-compose `command:` additionally pre-patches `clients.logo_*` columns inline.

### Data model relationships

```
Country → Client → Promotion
DeployRule (global, not per-client) × Promotion → DeployWindowDay (computed, never stored)
Repository ←→ Client (many-to-many via client_repositories)
Team → TeamChannel (webhook destinations), TeamNotificationSlot (time + message, up to 3)
IntegrationConfig (key/value store) — GA4 service account JSON, Cloudflare creds, ecosystem_peak_today
NotificationConfig (singleton row) — Google Chat webhook + up to 3 daily notification times
```

`DeployRule` rows are global. To change behavior for a specific promo type/criticality, add/edit a `DeployRule` row — no code change needed.

### Team notifications

`Team` has `deploy_days` (int[], 0=Mon…6=Sun), multiple `TeamChannel` rows (webhook + label), and up to 3 `TeamNotificationSlot` rows (time HH:MM UTC + freeform message). The scheduler fires per-slot jobs (`team_{id}_slot_{1|2|3}`) that check `datetime.utcnow().weekday()` against `deploy_days` before sending — no message goes out on non-deploy days. All channels of the team receive the same message. `POST /teams/{id}/test-notify/{slot}` sends immediately regardless of day for testing.

### Repository linking

Clients that share a repository are linked via the `Repository` model (`/admin` → Repositorios tab). When computing deploy windows or today's status for a client, the engine collects promotions from **all clients sharing the same repository** and returns the most restrictive result. This covers `GET /deploy-windows`, `GET /deploy-status/today`, `GET /public/status`, and Google Chat notifications.

Note: README.md describes a `mobile/` (Expo) app that does not exist in this repo — ignore that section.

## Seed credentials

Configured via env vars in `docker-compose.yml` (`ADMIN_EMAIL`, `ADMIN_PASSWORD`, `COMERCIAL_EMAIL`, `COMERCIAL_PASSWORD`). No `reader` user is seeded.

| Email | Password | Role |
|---|---|---|
| admin@deploy.com | admin123 | admin |
| comercial@deploy.com | comercial123 | comercial |

## OpenAPI docs

Available at `http://localhost:8000/docs` when the backend is running.
