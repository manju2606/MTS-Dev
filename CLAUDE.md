# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

# Manju Trade AI Pro
AI-powered systematic trading platform for Indian markets (NSE/BSE).

---

## Commands

```bash
# Docker — dev (hot-reload, DB ports exposed on host)
make dev              # start dev stack
make dev-build        # rebuild images then start
make dev-down         # stop dev stack

# Docker — prod simulation (nginx on :80, no exposed DB ports)
make prod             # start prod stack (detached)
make prod-build       # rebuild images then start
make prod-down        # stop prod stack

# Other Docker helpers
make logs             # tail all container logs
make ps               # show running containers
make migrate          # run alembic upgrade head inside container
make shell-backend    # sh into the backend container
make shell-db         # psql into the postgres container

# Backend — run locally without Docker (Python 3.11+)
cd backend && pip install -e ".[dev]"
cd backend && uvicorn app.main:app --reload

# Backend — tests (integration; requires a real PostgreSQL DB at mts_test)
cd backend && pytest
cd backend && pytest tests/unit/test_auth.py::test_login   # single test
cd backend && pytest --cov=app --cov-report=term-missing

# Backend — lint & type check
cd backend && ruff check . && mypy .
cd backend && ruff check . --fix   # auto-fix

# Database migrations (Alembic uses sync psycopg2 even though the app runs asyncpg)
cd backend && alembic revision --autogenerate -m "description"
cd backend && alembic upgrade head

# Frontend — run locally without Docker
cd frontend && npm install
cd frontend && npm run dev
cd frontend && npm run build && npm run start
cd frontend && npm run lint
```

### Environment setup

Two environments, each with its own compose override and env file:

| Environment | Compose files | Env file | Access |
|---|---|---|---|
| Dev | `docker-compose.yml` + `docker-compose.dev.yml` | `backend/.env.dev` | `localhost:3000` (frontend), `localhost:8000` (API) |
| Prod | `docker-compose.yml` + `docker-compose.prod.yml` | `backend/.env.prod` | `localhost:80` (via nginx) |

**First-time setup:**
1. Copy `backend/.env.dev.example` → `backend/.env.dev` and set `SECRET_KEY`
2. Copy `backend/.env.prod.example` → `backend/.env.prod` and set a strong `SECRET_KEY`
3. Generate a key: `python -c "import secrets; print(secrets.token_hex(32))"`

**Without Docker (local backend):** copy `backend/.env.example` → `backend/.env`.
- PostgreSQL: `localhost:5435`, Redis: `localhost:6381`, MongoDB: `localhost:27018`

---

## Architecture

Monorepo layout:

```
MTS-Dev/
├── backend/          # FastAPI Python service
│   ├── app/
│   │   ├── api/      # Route handlers (thin controllers)
│   │   ├── core/     # Config, security, dependencies
│   │   ├── domain/   # Business logic — pure Python dataclasses, zero framework imports
│   │   ├── infra/    # DB repos, external API clients, broker adapters
│   │   └── services/ # Orchestration between domain and infra
│   └── tests/
├── frontend/         # Next.js + TypeScript
│   ├── app/          # App Router pages
│   ├── components/
│   └── lib/          # API clients, hooks, utilities
├── ml/               # AI/ML models and training pipelines
├── infra/            # Terraform + Kubernetes manifests
└── docker-compose.yml
```

### Backend: Clean Architecture with dual-model pattern

`domain/models/` holds pure Python dataclasses (`User`, `Trade`). `infra/db/models.py` holds SQLAlchemy ORM classes (`UserORM`, `TradeORM`). The ORM models bridge the two layers via `to_domain()` and `from_domain()` methods — repositories only return domain objects, never ORM objects.

`domain/interfaces/repositories.py` defines abstract base classes (`UserRepository`, `TradeRepository`). `infra/db/repositories/` provides the concrete SQLAlchemy implementations. Services and routes depend only on the abstract interface.

### Request flow

`api/v1/` route → `api/deps.py` dependency → `infra/db/repositories/` → domain model returned

`DBSession` and `CurrentUser` in `api/deps.py` are `Annotated` type aliases for FastAPI's async session and authenticated user respectively. Use these in route signatures rather than calling `Depends(...)` directly.

For RBAC, use `require_role(UserRole.ADMIN, UserRole.TRADER)` from `api/deps.py` as a FastAPI dependency. `UserRole` has three values: `admin`, `trader`, `viewer`.

### Auth

JWT bearer tokens via `python-jose`. `core/security.py` handles `hash_password`, `verify_password`, `create_access_token`, and `decode_token`. Token payload contains `sub` (user UUID as string). No refresh token endpoint exists yet.

### Logging

`structlog` configured in `core/logging.py` — outputs JSON to stdout with ISO timestamps. Use `structlog.get_logger()` everywhere; do not use `print` or stdlib `logging` directly.

### Data stores
- **PostgreSQL** — user accounts, trades, portfolio positions, audit logs (async via `asyncpg` + SQLAlchemy 2.0)
- **Redis** — real-time price cache, session store, rate limiting (client: `redis[hiredis]`)
- **MongoDB** — trade journal entries, AI explanation logs, unstructured analysis (client: `motor`)

### Testing

Integration tests connect to a real PostgreSQL database (`mts_test` on `localhost:5432`). `tests/conftest.py` creates all tables at session start and drops them on teardown. `pytest-asyncio` is configured in `auto` mode (`asyncio_mode = "auto"` in `pyproject.toml`) — no `@pytest.mark.asyncio` decorator needed. Do not mock the database.

### What's implemented vs stubbed
- **Auth** (`/api/v1/auth`): register, login, `/me` — fully working
- **Scanner** (`/api/v1/scanner`): quote and watchlist endpoints exist but return stub responses pending a market data provider
- **Alembic**: initial `users` table migration exists; `trades` table not yet migrated

---

## Domain Rules (Non-Negotiable)

### Risk management
- Risk controls always override AI signals — the Risk Engine is a hard gate, not advisory.
- Every position must have: entry price, stop loss, target, and max position size set before execution.
- Risk controls in scope: max daily loss, max drawdown, position sizing, sector exposure limits, volatility filters, circuit breaker, emergency kill switch.

### AI recommendation schema
Every AI output must include all of these fields — never emit a partial recommendation:
```python
{
  "signal": "BUY" | "SELL" | "HOLD",
  "confidence": float,          # 0.0–1.0
  "entry_price": float,
  "stop_loss": float,
  "target": float,
  "risk_reward_ratio": float,
  "holding_period": str,        # e.g. "3–5 days"
  "explanation": str            # human-readable reasoning
}
```

### Trade logging
Every trade (paper or live) must be persisted with full audit trail before execution is confirmed.

---

## Development Phases

Currently targeting **Phase 1**:
- Authentication & RBAC
- Dashboard
- Market Scanner (NSE/BSE)
- Paper Trading

Phase 2 (AI Engine, Risk Engine, Backtesting), Phase 3 (Broker integrations, Live Trading), and Phase 4 (ML, Multi-client SaaS) come later — do not build Phase 2+ features while working in Phase 1.

---

## Key Constraints

- Indian markets only (NSE/BSE) — all market data, instrument codes, and trading hours are India-specific.
- Structured logging throughout — use `structlog`, not `print` or ad-hoc log statements.
- API latency target: <200 ms. Trade execution target: <500 ms.
- Broker integrations (Zerodha Kite, etc.) live in `backend/app/infra/brokers/` and are isolated behind interfaces.
