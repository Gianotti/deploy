# Deploy Window Manager

Gestión de ventanas de deploy según el calendario de promociones bancarias.
Cada cliente tiene promos por día; un deploy durante una **full promo** interrumpe el push de comunicaciones y el flujo de compra. Esta herramienta calcula automáticamente qué días/franjas están habilitados para deployar.

---

## Inicio rápido (Docker)

```bash
git clone <repo>
cd deploy
docker-compose up --build
```

El backend queda disponible en `http://localhost:8000`.
La base de datos se inicializa y se seedea automáticamente con datos de ejemplo.

---

## Estructura

```
deploy/
├── backend/               FastAPI + SQLAlchemy + PostgreSQL
│   ├── app/
│   │   ├── api/           Endpoints REST (auth, countries, clients, promotions, deploy-rules, deploy-windows)
│   │   ├── core/          Config, JWT, bcrypt
│   │   ├── db/            Engine SQLAlchemy, get_db, seed
│   │   ├── models/        ORM models (User, Country, Client, Promotion, DeployRule)
│   │   ├── rules/         Motor de reglas (engine.py) ← núcleo de negocio
│   │   └── schemas/       Pydantic v2 schemas
│   ├── alembic/           Migraciones
│   └── tests/             Tests unitarios del motor de reglas
├── mobile/                React Native (Expo) — iOS + Android
│   └── src/
│       ├── navigation/    Stack + BottomTabs
│       ├── screens/       Home, Calendar, DayDetail, Promotions, AddPromotion, Login
│       ├── components/    ClientSelector, StatusBadge
│       ├── services/      api.ts (axios + SecureStore)
│       ├── hooks/         useAuth (AuthContext)
│       └── types/         TypeScript types
└── docker-compose.yml
```

---

## Backend — instalación local

```bash
cd backend
python -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt

# Necesitás Postgres corriendo; ajustá DATABASE_URL en .env si es necesario
python -m app.db.seed
uvicorn app.main:app --reload
```

Documentación interactiva: `http://localhost:8000/docs`

### Tests

```bash
pytest                          # todos
pytest tests/test_engine.py -v  # solo el motor de reglas
```

---

## Mobile — instalación

```bash
cd mobile
npm install
npx expo start
```

En dispositivo físico, cambiá `BASE_URL` en `src/services/api.ts` a la IP LAN del host que corre el backend.

---

## Ejemplos de uso de la API

### Login

```bash
curl -X POST http://localhost:8000/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"admin@deploy.com","password":"admin123"}'
# → {"access_token":"<JWT>","token_type":"bearer"}
```

### Estado de deploy hoy

```bash
curl "http://localhost:8000/deploy-status/today?client_id=1" \
  -H "Authorization: Bearer <TOKEN>"
```

```json
{
  "client_id": 1,
  "date": "2024-06-09",
  "deploy_status": "BLOQUEADO",
  "window_start": null,
  "window_end": null,
  "can_deploy_now": false,
  "active_promotions": [...],
  "message": "🔴 Deploy bloqueado — hay una promo activa que impide el deploy."
}
```

### Calendario mensual

```bash
curl "http://localhost:8000/deploy-windows?client_id=1&from_date=2024-06-01&to_date=2024-06-30" \
  -H "Authorization: Bearer <TOKEN>"
```

### Crear una promoción (admin)

```bash
curl -X POST http://localhost:8000/promotions/ \
  -H "Authorization: Bearer <TOKEN>" \
  -H "Content-Type: application/json" \
  -d '{
    "client_id": 1,
    "start_date": "2024-07-15",
    "end_date": "2024-07-15",
    "promo_type": "FULL_PROMO",
    "criticality": 5,
    "description": "Día del Bancario"
  }'
```

---

## Datos de ejemplo (seed)

| País | Cliente |
|---|---|
| Argentina (ART/Buenos_Aires) | Banco Nación AR, Banco Galicia AR |
| México (MEX/Mexico_City) | Banco Azteca MX |

Incluye promos FULL_PROMO (bloqueadas), PROMO_NORMAL (ventana nocturna) y días libres variados.

### Credenciales

| Email | Password | Rol |
|---|---|---|
| admin@deploy.com | admin123 | admin |
| reader@deploy.com | reader123 | reader |

---

## Motor de reglas

Las `DeployRule` son filas en la base de datos, **no código**. Para cambiar el comportamiento:

1. Insertá/editá una fila en `deploy_rules` con `promo_type`, `min_criticality`, `deploy_status`, y opcionalmente `window_start`/`window_end`.
2. El motor las lee en el próximo request — sin reiniciar nada.

Regla por defecto (sin filas configurables): `FULL_PROMO` → `BLOQUEADO`, el resto → `LIBRE`.
