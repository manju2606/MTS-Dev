# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

# Manju Trade AI Pro
AI-powered systematic trading platform for Indian markets (NSE/BSE).

---

## Commands

```bash
# Backend — install deps (Python 3.11+)
cd backend && pip install -e ".[dev]"

# Backend — run dev server
cd backend && uvicorn app.main:app --reload

# Backend — tests
cd backend && pytest
cd backend && pytest tests/unit/test_auth.py::test_login   # single test
cd backend && pytest --cov=app --cov-report=term-missing

# Backend — lint & type check
cd backend && ruff check . && mypy .
cd backend && ruff check . --fix   # auto-fix

# Database migrations
cd backend && alembic revision --autogenerate -m "description"
cd backend && alembic upgrade head

# Frontend
cd frontend && npm install
cd frontend && npm run dev
cd frontend && npm run build && npm run start
cd frontend && npm run lint

# Full stack (Docker)
docker compose up
docker compose up --build   # rebuild images
docker compose down -v      # stop + remove volumes
```

---

## Planned Architecture

Monorepo layout:

```
MTS-Dev/
├── backend/          # FastAPI Python service
│   ├── app/
│   │   ├── api/      # Route handlers (thin controllers)
│   │   ├── core/     # Config, security, dependencies
│   │   ├── domain/   # Business logic (no framework imports)
│   │   ├── infra/    # DB repos, external API clients, broker adapters
│   │   └── services/ # Orchestration between domain and infra
│   └── tests/
├── frontend/         # Next.js + TypeScript
│   ├── app/          # App Router pages
│   ├── components/
│   └── lib/          # API clients, hooks, utilities
├── ml/               # AI/ML models and training pipelines
│   ├── models/       # PyTorch, XGBoost, LightGBM model definitions
│   ├── pipelines/    # MLflow training and evaluation pipelines
│   └── signals/      # Feature engineering and signal generation
├── infra/            # Terraform + Kubernetes manifests
└── docker-compose.yml
```

### Clean Architecture constraint
Backend must follow Clean Architecture: `domain/` has zero framework/infra imports. `infra/` implements interfaces defined in `domain/`. Services wire them together. All DB access goes through the Repository Pattern.

### Data stores
- **PostgreSQL** — user accounts, trades, portfolio positions, audit logs
- **Redis** — real-time price cache, session store, rate limiting
- **MongoDB** — trade journal entries, AI explanation logs, unstructured analysis

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
- Structured logging throughout (use a consistent log schema, not ad-hoc print statements).
- API latency target: <200 ms. Trade execution target: <500 ms.
- Broker integrations (Zerodha Kite, etc.) live in `backend/app/infra/brokers/` and are isolated behind interfaces.
