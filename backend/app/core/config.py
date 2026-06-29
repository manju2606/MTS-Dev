from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    DATABASE_URL: str
    REDIS_URL: str = "redis://localhost:6379"
    MONGODB_URL: str = "mongodb://localhost:27017"
    MONGODB_DB: str = "mts_journal"

    SECRET_KEY: str
    ALGORITHM: str = "HS256"
    ACCESS_TOKEN_EXPIRE_MINUTES: int = 30
    REFRESH_TOKEN_EXPIRE_DAYS: int = 7

    CORS_ORIGINS: list[str] = ["http://localhost:3000"]

    ENVIRONMENT: str = "development"
    DEBUG: bool = False

    # Phase 2
    ANTHROPIC_API_KEY: str | None = None
    PAPER_CAPITAL: float = 100_000.0  # default paper trading capital in INR

    # Email — SMTP (e.g. Gmail with App Password)
    SMTP_HOST: str = "smtp.gmail.com"
    SMTP_PORT: int = 587
    SMTP_USER: str | None = None      # your Gmail address
    SMTP_PASSWORD: str | None = None  # Gmail App Password (not your regular password)
    SMTP_FROM: str | None = None      # defaults to SMTP_USER if unset

    # Email — Resend API (alternative to SMTP; used if SMTP_USER is not set)
    RESEND_API_KEY: str | None = None
    RESEND_FROM: str = "noreply@manjutradeaipro.com"

    # Daily report recipient — defaults to SMTP_USER if unset
    REPORT_TO_EMAIL: str | None = None

    # Phase 3 — Zerodha Kite Connect
    KITE_API_KEY: str | None = None
    KITE_API_SECRET: str | None = None


settings = Settings()
