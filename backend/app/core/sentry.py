"""Sentry error tracking — opt-in via SENTRY_DSN. No-ops entirely when unset
so this is safe to ship before anyone has created a Sentry project."""

import structlog

from app.core.config import settings

log = structlog.get_logger()


def init_sentry() -> None:
    if not settings.SENTRY_DSN:
        return

    import sentry_sdk
    from sentry_sdk.integrations.fastapi import FastApiIntegration
    from sentry_sdk.integrations.starlette import StarletteIntegration

    sentry_sdk.init(
        dsn=settings.SENTRY_DSN,
        environment=settings.ENVIRONMENT,
        integrations=[StarletteIntegration(), FastApiIntegration()],
        traces_sample_rate=0.1,
        send_default_pii=False,
    )
    log.info("sentry.initialized", environment=settings.ENVIRONMENT)
