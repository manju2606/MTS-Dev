"""Part 1 (Data Collection) of the Chartink scan-link poller -- fetches the
*current* result set of a saved Chartink screener by replicating the AJAX
call its own page makes, rather than waiting for Chartink to push a webhook
(see api/v1/chartink.py's POST /webhook for the push half).

Reliability note: chartink.com/screener/<slug> is a client-rendered SPA as
of 2026 -- the scan condition itself isn't reliably present as plain text
in the initial server-rendered HTML, so auto-extracting it is best-effort
and may break if Chartink changes their frontend. The CSRF token (a <meta
name="csrf-token"> tag) IS reliably server-rendered and always extracted
successfully.

If auto-extraction of the scan condition fails, pass `scan_clause`
explicitly (ChartinkScanLink.scan_clause) -- get it once from your
browser's DevTools Network tab: open the screener page, click "Run Scan",
find the POST request to chartink.com/screener/process, and copy the
`scan_clause` field from its request payload. That value rarely changes
for a saved scan, so a one-time copy is normally enough.
"""

from __future__ import annotations

import re

import httpx
import structlog

log = structlog.get_logger()

_PROCESS_URL = "https://chartink.com/screener/process"
_USER_AGENT = (
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
    "(KHTML, like Gecko) Chrome/120.0 Safari/537.36"
)

_CSRF_RE = re.compile(r'name="csrf-token"\s+content="([^"]+)"')

# Best-effort fallbacks for the scan condition, covering markup patterns
# Chartink's screener page has used at various points. None of these are
# guaranteed against the current SPA -- see module docstring.
_SCAN_CLAUSE_PATTERNS = [
    re.compile(r'id="dataconditions"[^>]*>([^<]+)<'),
    re.compile(r'name="scan_clause"[^>]*value="([^"]*)"'),
    re.compile(r'"scan_clause"\s*:\s*"((?:[^"\\]|\\.)*)"'),
]


class ChartinkFetchError(Exception):
    """Raised when a screener's current results can't be fetched -- network
    failure, CSRF token missing, or (most commonly) the scan condition
    couldn't be determined and no scan_clause override was supplied."""


def _extract_csrf_token(html: str) -> str:
    m = _CSRF_RE.search(html)
    if not m:
        raise ChartinkFetchError(
            "Could not find a csrf-token meta tag on the screener page -- "
            "Chartink may have changed their page layout, or this isn't a "
            "valid screener URL."
        )
    return m.group(1)


def _extract_scan_clause(html: str) -> str | None:
    for pattern in _SCAN_CLAUSE_PATTERNS:
        m = pattern.search(html)
        if m:
            return m.group(1).encode().decode("unicode_escape")
    return None


def _parse_result_row(row: dict) -> dict:
    """Chartink's /screener/process response rows use short keys
    (nsecode/bsecode/name/close/volume/per_chg, sometimes more depending on
    the scan's own selected columns) -- normalize to what
    chartink_poll_service.py needs."""
    symbol = str(row.get("nsecode") or row.get("bsecode") or "").strip()
    return {
        "symbol": symbol,
        "name": str(row.get("name") or symbol).strip(),
        "close": float(row.get("close") or 0.0),
        "volume": int(float(row.get("volume") or 0)),
        "per_chg": float(row.get("per_chg") or 0.0),
    }


async def fetch_chartink_screener(url: str, scan_clause: str | None = None) -> list[dict]:
    """Fetch a Chartink screener's current result set. Returns a list of
    {symbol, name, close, volume, per_chg} dicts, one per matching stock
    (NSE symbols, no exchange suffix -- chartink_poll_service.py appends
    .NS the same way the webhook path does).

    Raises ChartinkFetchError with a message explaining what went wrong --
    always caught by the caller (chartink_poll_service.py), never left to
    crash the scheduler job that's polling many links in a loop.
    """
    headers = {"User-Agent": _USER_AGENT, "Referer": url}
    async with httpx.AsyncClient(headers=headers, timeout=20.0, follow_redirects=True) as client:
        try:
            page = await client.get(url)
            page.raise_for_status()
        except httpx.HTTPError as exc:
            raise ChartinkFetchError(f"Failed to load screener page: {exc}") from exc

        csrf_token = _extract_csrf_token(page.text)

        clause = scan_clause or _extract_scan_clause(page.text)
        if not clause:
            raise ChartinkFetchError(
                "Could not auto-extract the scan condition from this screener page "
                "(Chartink's frontend may have changed). Set scan_clause explicitly "
                "on this scan link -- see chartink_poller.py's module docstring for "
                "how to grab it from your browser's Network tab."
            )

        try:
            resp = await client.post(
                _PROCESS_URL,
                data={"scan_clause": clause},
                headers={
                    "X-CSRF-TOKEN": csrf_token,
                    "X-Requested-With": "XMLHttpRequest",
                    "Content-Type": "application/x-www-form-urlencoded",
                },
            )
            resp.raise_for_status()
        except httpx.HTTPError as exc:
            raise ChartinkFetchError(f"Failed to run scan: {exc}") from exc

        try:
            payload = resp.json()
        except ValueError as exc:
            raise ChartinkFetchError(
                "Scan ran but the response wasn't JSON -- the CSRF token or scan "
                "condition may be stale/wrong."
            ) from exc

        rows = payload.get("data") or []
        candidates = [_parse_result_row(r) for r in rows]
        candidates = [c for c in candidates if c["symbol"]]

        log.info(
            "chartink_poller.fetched",
            url=url,
            row_count=len(rows),
            usable_count=len(candidates),
        )
        return candidates
