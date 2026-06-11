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
pytest tests/test_engine.py::test_full_promo_no_rule_returns_bloqueado -v

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
npm run build
npm run start
```

### Docker (full stack)

```bash
# From repo root — starts Postgres + backend (with seed) + frontend
docker-compose up --build

# Tear down and remove volumes
docker-compose down -v
```

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
```

### Scheduler (APScheduler)

`backend/app/scheduler.py` runs a `BackgroundScheduler` (UTC) that sends Google Chat webhook notifications at up to 3 configurable daily times. Jobs are rebuilt whenever `NotificationConfig` is updated via `POST /notifications/config` and are restored from DB on startup (`lifespan` in `main.py`).

### GA4 integration

GA4 service account credentials are stored as JSON in the `integration_configs` table under key `ga4_service_account`. Clients can have a `ga4_property_id`; `GET /ga4/realtime` fetches active users for all configured clients in parallel (up to 8 threads). The public status endpoint uses GA4 data when available, with a fallback to the in-memory GTM tracker (`services/tracker.py`) which counts page view events in a 5-minute sliding window.

### Auth

Three roles: `admin` (CRUD everything), `reader` (GET only), `comercial` (can create/delete promotions). JWT payload carries `sub` (user id) and `role`. Dependency functions in `api/deps.py`: `get_current_user`, `require_admin`, `require_admin_or_comercial`.

Frontend: JWT stored in a cookie (`access_token`, 1-day expiry) via `js-cookie`. `AuthProvider` (`lib/auth.tsx`) provides `useAuth()` hook throughout the app. `AuthGuard` component wraps each protected page and redirects to `/login` if not authenticated. On 401 response the axios interceptor in `lib/api.ts` clears the cookie and redirects to `/login`.

### Frontend pages

| Route | Description |
|---|---|
| `/dashboard` | Semáforo per-client: "¿puedo deployar ahora?" |
| `/calendar` | Month grid with color-coded days + detail panel |
| `/promotions` | List + create form (create/delete for admin + comercial) |
| `/admin` | Tabbed admin panel: Countries, Clients, Deploy Rules, Notifications (Google Chat), GA4, Repositories, Teams |
| `/landing` | Public-facing status page (no login required) |

### Data model relationships

```
Country → Client → Promotion
DeployRule (global, not per-client) × Promotion → DeployWindowDay (computed, never stored)
Repository ←→ Client (many-to-many via client_repositories)
Team → TeamChannel (webhook destinations), TeamNotificationSlot (time + message, up to 3)
IntegrationConfig (key/value store) — holds GA4 service account JSON
NotificationConfig (singleton row) — Google Chat webhook + up to 3 daily notification times
```

`DeployRule` rows are global. To change behavior for a specific promo type/criticality, add/edit a `DeployRule` row — no code change needed.

### Team notifications

`Team` has `deploy_days` (int[], 0=Mon…6=Sun), multiple `TeamChannel` rows (webhook + label), and up to 3 `TeamNotificationSlot` rows (time HH:MM UTC + freeform message). The scheduler fires per-slot jobs (`team_{id}_slot_{1|2|3}`) that check `datetime.utcnow().weekday()` against `deploy_days` before sending — no message goes out on non-deploy days. All channels of the team receive the same message. `POST /teams/{id}/test-notify/{slot}` sends immediately regardless of day for testing.

### Repository linking

Clients that share a repository are linked via the `Repository` model (`/admin` → Repositorios tab). When computing deploy windows or today's status for a client, the engine collects promotions from **all clients sharing the same repository** and returns the most restrictive result. This covers `GET /deploy-windows`, `GET /deploy-status/today`, `GET /public/status`, and Google Chat notifications.

## Seed credentials

Configured via env vars in `docker-compose.yml` (`ADMIN_EMAIL`, `ADMIN_PASSWORD`, `COMERCIAL_EMAIL`, `COMERCIAL_PASSWORD`). No `reader` user is seeded.

| Email | Password | Role |
|---|---|---|
| admin@deploy.com | admin123 | admin |
| comercial@deploy.com | comercial123 | comercial |

## OpenAPI docs

Available at `http://localhost:8000/docs` when the backend is running.
