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

All API calls in the browser go through Next.js rewrites:
`/api/*` → `http://backend:8000/*` (in Docker) or `http://localhost:8000/*` (local dev).

Configured in `frontend/next.config.ts`. The `BACKEND_URL` env var controls the Docker target.

### Rules engine (`backend/app/rules/engine.py`)

This is the core. The engine is **stateless** — it receives lists of `Promotion` and `DeployRule` ORM objects and returns computed `DeployWindowDay` values. No DB calls inside the engine.

Key invariants:
- `BLOQUEADO > RESTRINGIDO > LIBRE` — the most restrictive status always wins when multiple promotions are active on the same day.
- Default fallback (no matching rule): `FULL_PROMO` → `BLOQUEADO`, everything else → `LIBRE`.
- Rules match on `promo_type` AND `promotion.criticality >= rule.min_criticality`. When multiple rules match, the most restrictive one wins.
- Restricted windows are **intersected** (not unioned) across promos — the tightest common window is used.
- `can_deploy_now` uses `pytz` to evaluate current local time against the window in the country's timezone.

### Deploy status flow

```
GET /deploy-windows → loads Promotions + DeployRules from DB → engine.compute_windows() → DeployWindowDay[]
GET /deploy-status/today → same, but single day + adds can_deploy_now boolean
```

### Auth

Backend: Two roles: `admin` (CRUD everything) and `reader` (GET only). JWT payload carries `sub` (user id) and `role`.

Frontend: JWT stored in a cookie (`access_token`, 1-day expiry) via `js-cookie`. `AuthProvider` (`lib/auth.tsx`) provides `useAuth()` hook throughout the app. `AuthGuard` component wraps each protected page and redirects to `/login` if not authenticated.

### Frontend pages

| Route | Component | Description |
|---|---|---|
| `/` | Redirects → `/dashboard` | |
| `/login` | Login form | JWT login |
| `/dashboard` | HomeScreen | Semáforo, "¿puedo deployar ahora?" |
| `/calendar` | Calendar + detail panel | Month grid with color-coded days |
| `/promotions` | List + create form | CRUD promos (create/delete for admins only) |

### Data model relationships

```
Country → Client → Promotion
DeployRule (global, not per-client) × Promotion → DeployWindowDay (computed, never stored)
```

`DeployRule` rows are global. To change behavior for a specific promo type/criticality, add/edit a `DeployRule` row — no code change needed.

## Seed credentials

| Email | Password | Role |
|---|---|---|
| admin@deploy.com | admin123 | admin |
| reader@deploy.com | reader123 | reader |

## OpenAPI docs

Available at `http://localhost:8000/docs` when the backend is running.
