"""Resilient fetch helper: retries with backoff, and always caches the raw
response to disk so every pipeline run has an auditable snapshot of exactly
what was downloaded (production data pipelines should never merge from
memory-only fetches with no trace left behind).
"""

import time

import httpx
import structlog

from . import config

log = structlog.get_logger()


class FetchError(Exception):
    pass


def fetch_raw(name: str, url: str) -> bytes:
    """Download `url`, retrying transient failures, and cache the raw bytes
    under data/raw/<name>.csv for lineage/debugging. Raises FetchError if all
    retries are exhausted.
    """
    config.RAW_CACHE_DIR.mkdir(parents=True, exist_ok=True)
    cache_path = config.RAW_CACHE_DIR / f"{name}.csv"

    last_exc: Exception | None = None
    for attempt in range(1, config.MAX_RETRIES + 1):
        try:
            with httpx.Client(
                headers=config.REQUEST_HEADERS,
                timeout=config.REQUEST_TIMEOUT,
                follow_redirects=True,
            ) as client:
                resp = client.get(url)
            if resp.status_code != 200:
                raise FetchError(f"{name}: HTTP {resp.status_code} from {url}")
            body = resp.content
            if not body or len(body) < 20:
                raise FetchError(f"{name}: suspiciously empty response ({len(body)} bytes)")
            cache_path.write_bytes(body)
            log.info("stock_master.fetch.ok", source=name, num_bytes=len(body), attempt=attempt)
            return body
        except (httpx.HTTPError, FetchError) as exc:
            last_exc = exc
            log.warning("stock_master.fetch.retry", source=name, attempt=attempt, error=str(exc))
            if attempt < config.MAX_RETRIES:
                time.sleep(config.RETRY_BACKOFF_SECONDS * attempt)

    raise FetchError(f"{name}: exhausted {config.MAX_RETRIES} retries fetching {url}") from last_exc
