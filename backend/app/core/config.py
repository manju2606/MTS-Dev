from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    DATABASE_URL: str
    REDIS_URL: str = "redis://localhost:6379"
    MONGODB_URL: str = "mongodb://localhost:27017"
    MONGODB_DB: str = "mts_journal"

    SECRET_KEY: str
    ALGORITHM: str = "HS256"
    ACCESS_TOKEN_EXPIRE_MINUTES: int = 480  # 8h — full trading day, no refresh endpoint yet
    REFRESH_TOKEN_EXPIRE_DAYS: int = 7

    CORS_ORIGINS: list[str] = ["http://localhost:3000"]

    ENVIRONMENT: str = "development"
    DEBUG: bool = False

    # Observability — Sentry error tracking (optional; no-ops if unset)
    SENTRY_DSN: str | None = None

    # Observability — shared secret Alertmanager must send so the webhook
    # receiver (reachable at /api/v1/alerting/webhook, which nginx proxies
    # publicly along with the rest of /api/) can't be spammed by strangers.
    ALERTMANAGER_WEBHOOK_SECRET: str | None = None

    # Phase 2
    ANTHROPIC_API_KEY: str | None = None
    PAPER_CAPITAL: float = 100_000.0  # default paper trading capital in INR

    # Email — SMTP (e.g. Gmail with App Password)
    SMTP_HOST: str = "smtp.gmail.com"
    SMTP_PORT: int = 587
    SMTP_USER: str | None = None  # your Gmail address
    SMTP_PASSWORD: str | None = None  # Gmail App Password (not your regular password)
    SMTP_FROM: str | None = None  # defaults to SMTP_USER if unset

    # Email — Resend API (alternative to SMTP; used if SMTP_USER is not set)
    RESEND_API_KEY: str | None = None
    RESEND_FROM: str = "noreply@manjutradeaipro.com"

    # Daily report recipient — defaults to SMTP_USER if unset
    REPORT_TO_EMAIL: str | None = None

    # Phase 3 — Zerodha Kite Connect
    KITE_API_KEY: str | None = None
    KITE_API_SECRET: str | None = None

    # Phase 3 — Upstox
    UPSTOX_API_KEY: str | None = None
    UPSTOX_API_SECRET: str | None = None
    UPSTOX_REDIRECT_URI: str = "http://localhost:3000/broker/upstox/callback"

    # Phase 3 — Alice Blue (ANT)
    ALICEBLUE_APP_CODE: str | None = None
    ALICEBLUE_API_SECRET: str | None = None
    ALICEBLUE_REDIRECT_URI: str = "http://localhost:3000/broker/aliceblue/callback"

    # Phase 3 — Dhan (no app registration; user pastes their own client id +
    # access token generated at web.dhan.co, so no keys needed here)

    # Phase 3 — Zerodha TOTP auto-login (optional). Lets the scheduler
    # replay Kite's own web login every morning instead of requiring a
    # manual click-through (see app/infra/brokers/zerodha_autologin.py).
    # Only takes effect for users who've saved credentials via
    # POST /broker/zerodha/auto-login -- those credentials are encrypted at
    # rest with this key, which must never be committed or reused across
    # environments. Generate one with:
    #   python -c "from cryptography.fernet import Fernet; print(Fernet.generate_key().decode())"
    ZERODHA_CREDS_ENCRYPTION_KEY: str | None = None

    # Phase 3 — Shared market-data broker session. MCX/NSE quotes, candles,
    # and predictions are identical for every user, so there's no reason
    # every app user needs their own Zerodha login just to view them -- one
    # connected session (typically the admin's, kept fresh via TOTP
    # auto-login above) serves market data to everyone. Live order
    # placement is unaffected and still always uses the placing user's own
    # connected broker (see app/api/v1/live.py). Optional: if unset, the
    # first currently-connected user's session is used instead (see
    # app/infra/brokers/session_store.get_market_data_broker) -- set this
    # explicitly if more than one real account might be connected at once
    # and you want to pin which one serves market data.
    MARKET_DATA_BROKER_USER_ID: str | None = None


settings = Settings()
