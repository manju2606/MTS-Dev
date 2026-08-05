"""Unattended Zerodha login -- replays Kite's own web login flow
(kite.zerodha.com, the same pages a human would click through) using a
stored username/password/TOTP secret, so the scheduler can obtain a fresh
access_token every morning without anyone clicking "Connect".

This is a DELIBERATE step past the safer default this project shipped with
(see zerodha_token_service.py: "daily reminder + one-click reconnect,
because automating login means storing the user's password/TOTP secret").
Storing those secrets (encrypted, see app/core/crypto.py) is exactly the
tradeoff that was avoided before -- this module exists for anyone who's
decided the convenience is worth it.

Important caveats:
  - This scripts Kite's UNDOCUMENTED web login endpoints (/api/login,
    /api/twofa), not the official Kite Connect API. Zerodha can change this
    flow (new fields, a CAPTCHA, device-verification step, rate limiting)
    at any time without notice, silently breaking this module. It is *not*
    covered by Kite Connect's API stability guarantees.
  - Automating login is generally against the spirit (if not the letter)
    of a broker's terms of use for interactive login pages -- this is the
    same risk category as zerodha_enctoken.py's cookie-scraping technique,
    just one step further (it also submits the password + TOTP, rather than
    only reusing an already-authenticated session).
  - On any failure (bad password, bad TOTP secret/clock drift, changed
    login flow) this raises ZerodhaAutoLoginError. Callers should fall back
    to the existing manual-reconnect notification path
    (zerodha_token_service.check_and_notify_all) rather than treat a failed
    auto-login as fatal.
"""

from __future__ import annotations

import asyncio
from urllib.parse import parse_qs, urlparse

import httpx
import pyotp
import structlog

log = structlog.get_logger()

_LOGIN_URL = "https://kite.zerodha.com/api/login"
_TWOFA_URL = "https://kite.zerodha.com/api/twofa"
_CONNECT_LOGIN_URL = "https://kite.zerodha.com/connect/login"
_MAX_REDIRECTS = 5


class ZerodhaAutoLoginError(Exception):
    """Any step of the scripted login flow failed -- bad credentials, bad
    TOTP secret, or Kite changed the flow this module depends on."""


async def _kite_login(client: httpx.AsyncClient, kite_user_id: str, password: str) -> str:
    """Step 1: username + password. Returns the request_id needed for 2FA."""
    resp = await client.post(_LOGIN_URL, data={"user_id": kite_user_id, "password": password})
    if resp.status_code != 200:
        raise ZerodhaAutoLoginError(f"Kite login request failed (HTTP {resp.status_code})")
    body = resp.json()
    if body.get("status") != "success":
        raise ZerodhaAutoLoginError(
            body.get("message") or "Kite login failed -- check kite_user_id/password"
        )
    request_id = body.get("data", {}).get("request_id")
    if not request_id:
        raise ZerodhaAutoLoginError("Kite login response missing request_id")
    return str(request_id)


async def _kite_twofa(
    client: httpx.AsyncClient, kite_user_id: str, request_id: str, totp_code: str
) -> None:
    """Step 2: TOTP. On success Kite sets the session cookies on `client`
    that the Connect login redirect (step 3) needs."""
    resp = await client.post(
        _TWOFA_URL,
        data={
            "user_id": kite_user_id,
            "request_id": request_id,
            "twofactor_value": totp_code,
            "twofactor_type": "totp",
        },
    )
    if resp.status_code != 200:
        raise ZerodhaAutoLoginError(f"Kite 2FA request failed (HTTP {resp.status_code})")
    body = resp.json()
    if body.get("status") != "success":
        raise ZerodhaAutoLoginError(
            body.get("message") or "Kite 2FA failed -- check totp_secret / device clock"
        )


async def _obtain_request_token(client: httpx.AsyncClient, api_key: str) -> str:
    """Step 3: with login+2FA cookies set, hit the Connect app's login URL
    and follow the redirect chain until Kite bounces back to our
    redirect_uri with ?request_token=... -- same request_token the manual
    flow captures from the browser's address bar after a user logs in."""
    url = f"{_CONNECT_LOGIN_URL}?api_key={api_key}&v=3"
    for _ in range(_MAX_REDIRECTS):
        resp = await client.get(url, follow_redirects=False)
        if resp.status_code not in (301, 302, 303, 307, 308):
            break
        location = resp.headers.get("location", "")
        qs = parse_qs(urlparse(location).query)
        if "request_token" in qs:
            return qs["request_token"][0]
        if "error" in qs or "status=error" in location:
            raise ZerodhaAutoLoginError(
                f"Kite Connect login redirect reported an error: {location}"
            )
        url = location if location.startswith("http") else f"https://kite.zerodha.com{location}"
    raise ZerodhaAutoLoginError(
        "Could not obtain request_token from Kite's login redirect -- the login flow "
        "may have changed, or credentials/TOTP secret are invalid"
    )


async def auto_login(
    api_key: str,
    api_secret: str,
    kite_user_id: str,
    password: str,
    totp_secret: str,
) -> str:
    """Full unattended login: password + TOTP + Connect handshake, returning
    a fresh Kite Connect access_token. Raises ZerodhaAutoLoginError on any
    failure -- callers must catch this and fall back to the manual reconnect
    reminder rather than let a scheduled job crash."""
    try:
        totp_code = pyotp.TOTP(totp_secret).now()
    except Exception as exc:
        raise ZerodhaAutoLoginError(f"Invalid TOTP secret: {exc}") from exc

    async with httpx.AsyncClient(
        timeout=20, headers={"X-Kite-Version": "3"}, follow_redirects=False
    ) as client:
        request_id = await _kite_login(client, kite_user_id, password)
        await _kite_twofa(client, kite_user_id, request_id, totp_code)
        request_token = await _obtain_request_token(client, api_key)

    # ZerodhaBroker.generate_session is a synchronous kiteconnect call --
    # offload it so this coroutine doesn't block the event loop.
    from app.infra.brokers.zerodha import ZerodhaBroker

    loop = asyncio.get_event_loop()
    access_token: str = await loop.run_in_executor(
        None, ZerodhaBroker.generate_session, api_key, api_secret, request_token
    )
    log.info("zerodha_autologin.success", kite_user_id=kite_user_id)
    return access_token
