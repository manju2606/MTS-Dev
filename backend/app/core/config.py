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

    # Phase 3 — Zerodha Kite Connect
    KITE_API_KEY: str | None = None
    KITE_API_SECRET: str | None = None


settings = Settings()
