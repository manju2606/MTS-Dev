"""Enriched watchlist quote fetcher — batch yfinance + static metadata."""
from __future__ import annotations

import asyncio
import math
import time

import yfinance as yf

from app.infra.scanner.universe import (
    SYMBOL_SECTOR,
    NIFTY_50,
    NIFTY_NEXT_50,
    NIFTY_MIDCAP_50,
    NIFTY_MIDCAP_100,
    NIFTY_SMALLCAP_50,
    NIFTY_SMALLCAP_100,
)

# ── Static company names ──────────────────────────────────────────────────────

_NAMES: dict[str, str] = {
    # Nifty 50
    "RELIANCE.NS": "Reliance Industries",
    "TCS.NS": "Tata Consultancy Services",
    "HDFCBANK.NS": "HDFC Bank",
    "INFY.NS": "Infosys",
    "ICICIBANK.NS": "ICICI Bank",
    "HINDUNILVR.NS": "Hindustan Unilever",
    "ITC.NS": "ITC",
    "SBIN.NS": "State Bank of India",
    "BHARTIARTL.NS": "Bharti Airtel",
    "KOTAKBANK.NS": "Kotak Mahindra Bank",
    "LT.NS": "Larsen & Toubro",
    "AXISBANK.NS": "Axis Bank",
    "ASIANPAINT.NS": "Asian Paints",
    "MARUTI.NS": "Maruti Suzuki",
    "NESTLEIND.NS": "Nestlé India",
    "TITAN.NS": "Titan Company",
    "SUNPHARMA.NS": "Sun Pharmaceutical",
    "BAJFINANCE.NS": "Bajaj Finance",
    "WIPRO.NS": "Wipro",
    "HCLTECH.NS": "HCL Technologies",
    "ULTRACEMCO.NS": "UltraTech Cement",
    "BAJAJFINSV.NS": "Bajaj Finserv",
    "TECHM.NS": "Tech Mahindra",
    "ONGC.NS": "Oil & Natural Gas Corp",
    "POWERGRID.NS": "Power Grid Corporation",
    "NTPC.NS": "NTPC",
    "COALINDIA.NS": "Coal India",
    "TATAMOTORS.NS": "Tata Motors",
    "TATASTEEL.NS": "Tata Steel",
    "JSWSTEEL.NS": "JSW Steel",
    "ADANIENT.NS": "Adani Enterprises",
    "ADANIPORTS.NS": "Adani Ports & SEZ",
    "DIVISLAB.NS": "Divi's Laboratories",
    "CIPLA.NS": "Cipla",
    "DRREDDY.NS": "Dr. Reddy's Laboratories",
    "EICHERMOT.NS": "Eicher Motors",
    "GRASIM.NS": "Grasim Industries",
    "HEROMOTOCO.NS": "Hero MotoCorp",
    "HINDALCO.NS": "Hindalco Industries",
    "INDUSINDBK.NS": "IndusInd Bank",
    "BRITANNIA.NS": "Britannia Industries",
    "APOLLOHOSP.NS": "Apollo Hospitals",
    "BPCL.NS": "Bharat Petroleum Corp",
    "TATACONSUM.NS": "Tata Consumer Products",
    "SBILIFE.NS": "SBI Life Insurance",
    "HDFCLIFE.NS": "HDFC Life Insurance",
    "BAJAJ-AUTO.NS": "Bajaj Auto",
    "UPL.NS": "UPL",
    "VEDL.NS": "Vedanta",
    "M&M.NS": "Mahindra & Mahindra",
    "MM.NS": "Mahindra & Mahindra",
    # Nifty Next 50
    "SIEMENS.NS": "Siemens India",
    "ABB.NS": "ABB India",
    "HAVELLS.NS": "Havells India",
    "PIDILITIND.NS": "Pidilite Industries",
    "BERGEPAINT.NS": "Berger Paints",
    "COLPAL.NS": "Colgate-Palmolive India",
    "DABUR.NS": "Dabur India",
    "GODREJCP.NS": "Godrej Consumer Products",
    "MARICO.NS": "Marico",
    "EMAMILTD.NS": "Emami",
    "TATAPOWER.NS": "Tata Power",
    "ADANIGREEN.NS": "Adani Green Energy",
    "DMART.NS": "Avenue Supermarts",
    "NAUKRI.NS": "Info Edge (India)",
    "INDIGO.NS": "InterGlobe Aviation",
    "GAIL.NS": "GAIL (India)",
    "IOC.NS": "Indian Oil Corporation",
    "HPCL.NS": "HPCL",
    "RECLTD.NS": "REC",
    "PFC.NS": "Power Finance Corporation",
    "IRFC.NS": "Indian Railway Finance Corp",
    "DLF.NS": "DLF",
    "GODREJPROP.NS": "Godrej Properties",
    "AMBUJACEM.NS": "Ambuja Cements",
    "ACC.NS": "ACC",
    "SHRIRAMFIN.NS": "Shriram Finance",
    "MUTHOOTFIN.NS": "Muthoot Finance",
    "CHOLAFIN.NS": "Cholamandalam Investment",
    "BAJAJHLDNG.NS": "Bajaj Holdings",
    "OFSS.NS": "Oracle Financial Services",
    "LTIM.NS": "LTIMindtree",
    "MPHASIS.NS": "Mphasis",
    "PERSISTENT.NS": "Persistent Systems",
    "COFORGE.NS": "Coforge",
    "TVSMOTOR.NS": "TVS Motor Company",
    "LUPIN.NS": "Lupin",
    "TORNTPHARM.NS": "Torrent Pharmaceuticals",
    "AUROPHARMA.NS": "Aurobindo Pharma",
    "BIOCON.NS": "Biocon",
    "ALKEM.NS": "Alkem Laboratories",
    "TATAELXSI.NS": "Tata Elxsi",
    "KPITTECH.NS": "KPIT Technologies",
    "UNIONBANK.NS": "Union Bank of India",
    "CANBK.NS": "Canara Bank",
    "PNB.NS": "Punjab National Bank",
    "BANKBARODA.NS": "Bank of Baroda",
    "IDFCFIRSTB.NS": "IDFC First Bank",
    "FEDERALBNK.NS": "Federal Bank",
    "AUBANK.NS": "AU Small Finance Bank",
    "SRF.NS": "SRF",
    # Other common
    "BANDHANBNK.NS": "Bandhan Bank",
    "RBLBANK.NS": "RBL Bank",
    "ASHOKLEY.NS": "Ashok Leyland",
    "BALKRISIND.NS": "Balkrishna Industries",
    "MRF.NS": "MRF",
    "BOSCHLTD.NS": "Bosch",
    "MOTHERSON.NS": "Samvardhana Motherson",
    "EXIDEIND.NS": "Exide Industries",
    "NMDC.NS": "NMDC",
    "SAIL.NS": "Steel Authority of India",
    "JINDALSTEL.NS": "Jindal Steel & Power",
    "NATIONALUM.NS": "National Aluminium",
    "WELCORP.NS": "Welspun Corp",
    "APLAPOLLO.NS": "APL Apollo Tubes",
    "RATNAMANI.NS": "Ratnamani Metals",
    "TORNTPOWER.NS": "Torrent Power",
    "CESC.NS": "CESC",
    "ADANIGAS.NS": "Adani Total Gas",
    "IGL.NS": "Indraprastha Gas",
    "MGL.NS": "Mahanagar Gas",
    "GUJGASLTD.NS": "Gujarat Gas",
    "PETRONET.NS": "Petronet LNG",
    "BHEL.NS": "BHEL",
    "IRCON.NS": "Ircon International",
    "RVNL.NS": "Rail Vikas Nigam",
    "NBCC.NS": "NBCC (India)",
    "IRCTC.NS": "IRCTC",
    "CONCOR.NS": "Container Corporation",
    "ICICIPRULI.NS": "ICICI Prudential Life",
    "M&MFIN.NS": "M&M Financial Services",
    "LICIHSGFIN.NS": "LIC Housing Finance",
    "SUNDARMFIN.NS": "Sundaram Finance",
    "ABCAPITAL.NS": "Aditya Birla Capital",
    "MANAPPURAM.NS": "Manappuram Finance",
    "IPCALAB.NS": "IPCA Laboratories",
    "GLENMARK.NS": "Glenmark Pharmaceuticals",
    "NATCOPHARM.NS": "Natco Pharma",
    "VBL.NS": "Varun Beverages",
    "RADICO.NS": "Radico Khaitan",
    "MCDOWELL-N.NS": "United Spirits",
}

_BANK_NIFTY: frozenset[str] = frozenset({
    "HDFCBANK.NS", "ICICIBANK.NS", "SBIN.NS", "KOTAKBANK.NS", "AXISBANK.NS",
    "INDUSINDBK.NS", "BANDHANBNK.NS", "FEDERALBNK.NS", "IDFCFIRSTB.NS", "AUBANK.NS",
    "PNB.NS", "CANBK.NS", "BANKBARODA.NS", "UNIONBANK.NS", "RBLBANK.NS",
})

_N50 = frozenset(NIFTY_50)
_NN50 = frozenset(NIFTY_NEXT_50)
_NM50 = frozenset(NIFTY_MIDCAP_50)
_NM100 = frozenset(NIFTY_MIDCAP_100)
_NS50 = frozenset(NIFTY_SMALLCAP_50)
_NS100 = frozenset(NIFTY_SMALLCAP_100)


def _market_cap(sym: str) -> str:
    if sym in _N50 or sym in _NN50:
        return "Large"
    if sym in _NM100:
        return "Mid"
    if sym in _NS100:
        return "Small"
    return "—"


def _index_membership(sym: str) -> list[str]:
    tags: list[str] = []
    if sym in _N50:
        tags.append("Nifty 50")
    if sym in _NN50:
        tags.append("Nifty Next 50")
    if sym in _NM50:
        tags.append("Nifty Midcap 50")
    elif sym in _NM100:
        tags.append("Nifty Midcap 100")
    if sym in _NS50:
        tags.append("Nifty Smallcap 50")
    elif sym in _NS100:
        tags.append("Nifty Smallcap 100")
    if sym in _BANK_NIFTY:
        tags.append("Bank Nifty")
    return tags or ["—"]


# ── Technical helpers ─────────────────────────────────────────────────────────

def _sf(v: object, default: float = 0.0) -> float:
    try:
        f = float(v)  # type: ignore[arg-type]
        return default if (math.isnan(f) or math.isinf(f)) else f
    except (TypeError, ValueError):
        return default


def _rsi(closes, period: int = 14) -> float:
    if len(closes) < period + 2:
        return 0.0
    delta = closes.diff().dropna()
    up = delta.clip(lower=0).ewm(com=period - 1, min_periods=period).mean()
    dn = (-delta.clip(upper=0)).ewm(com=period - 1, min_periods=period).mean()
    rs = up / dn.replace(0, 1e-10)
    return _sf((100 - 100 / (1 + rs)).iloc[-1])


def _macd(closes) -> tuple[float, float, float]:
    if len(closes) < 27:
        return 0.0, 0.0, 0.0
    ema12 = closes.ewm(span=12, adjust=False).mean()
    ema26 = closes.ewm(span=26, adjust=False).mean()
    line = ema12 - ema26
    sig = line.ewm(span=9, adjust=False).mean()
    hist = line - sig
    return _sf(line.iloc[-1]), _sf(sig.iloc[-1]), _sf(hist.iloc[-1])


def _bb(closes, period: int = 20) -> tuple[float, float, float]:
    if len(closes) < period:
        return 0.0, 0.0, 0.0
    mid = _sf(closes.rolling(period).mean().iloc[-1])
    std = _sf(closes.rolling(period).std().iloc[-1])
    return round(mid + 2 * std, 2), round(mid, 2), round(mid - 2 * std, 2)


# ── Batch fetch ───────────────────────────────────────────────────────────────

_cache: dict[str, tuple[float, list[dict]]] = {}
_TTL = 60.0


def _fetch_sync(symbols: list[str]) -> list[dict]:
    import pandas as pd

    tickers_str = " ".join(symbols)
    try:
        df = yf.download(
            tickers_str, period="6mo", interval="1d",
            progress=False, auto_adjust=True, group_by="ticker",
        )
    except Exception:
        return [{"symbol": s, "error": "Download failed"} for s in symbols]

    multi = len(symbols) > 1

    def _series(col: str, sym: str) -> pd.Series:
        try:
            if multi:
                return df[sym][col].dropna()
            return df[col].dropna()
        except (KeyError, TypeError):
            return pd.Series(dtype=float)

    results: list[dict] = []
    for sym in symbols:
        try:
            closes = _series("Close", sym)
            opens  = _series("Open",  sym)
            highs  = _series("High",  sym)
            lows   = _series("Low",   sym)
            vols   = _series("Volume", sym)

            if len(closes) < 2:
                results.append({"symbol": sym, "error": "No data"})
                continue

            ltp        = _sf(closes.iloc[-1])
            prev_close = _sf(closes.iloc[-2])
            change     = round(ltp - prev_close, 2)
            change_pct = round((change / prev_close * 100) if prev_close else 0.0, 2)

            o = _sf(opens.iloc[-1])  if len(opens)  else ltp
            h = _sf(highs.iloc[-1])  if len(highs)  else ltp
            lo = _sf(lows.iloc[-1])  if len(lows)   else ltp
            v = int(_sf(vols.iloc[-1])) if len(vols) else 0

            vwap = round((h + lo + ltp) / 3, 2)
            atp  = round((o + h + lo + ltp) / 4, 2)

            avg_vol   = int(vols.tail(20).mean()) if len(vols) >= 5 else v
            vol_ratio = round(v / avg_vol, 2) if avg_vol > 0 else 1.0

            w52h = round(_sf(highs.tail(252).max()), 2)
            w52l = round(_sf(lows.tail(252).min()),  2)
            pct_h = round((ltp - w52h) / w52h * 100, 2) if w52h else 0.0
            pct_l = round((ltp - w52l) / w52l * 100, 2) if w52l else 0.0

            sma20  = round(float(closes.tail(20).mean()),  2) if len(closes) >= 20  else 0.0
            sma50  = round(float(closes.tail(50).mean()),  2) if len(closes) >= 50  else 0.0
            sma200 = round(float(closes.tail(200).mean()), 2) if len(closes) >= 200 else 0.0

            rsi_v = round(_rsi(closes), 1)
            ml, ms, mh = _macd(closes)
            bbu, bbm, bbl = _bb(closes)

            ab20  = bool(ltp > sma20)  if sma20  else None
            ab50  = bool(ltp > sma50)  if sma50  else None
            ab200 = bool(ltp > sma200) if sma200 else None
            bullish = sum(1 for x in [ab20, ab50, ab200] if x is True)
            trend = "BULLISH" if bullish >= 2 else "BEARISH" if bullish == 0 else "MIXED"

            display = sym.replace(".NS", "").replace(".BO", "")
            exchange = "BSE" if sym.endswith(".BO") else "NSE"

            results.append({
                "symbol": sym,
                "display_symbol": display,
                "company_name": _NAMES.get(sym, display),
                "exchange": exchange,
                "sector": SYMBOL_SECTOR.get(sym, "—"),
                "market_cap_category": _market_cap(sym),
                "index_membership": _index_membership(sym),
                # Price action
                "ltp": round(ltp, 2),
                "prev_close": round(prev_close, 2),
                "change": change,
                "change_pct": change_pct,
                "open": round(o, 2),
                "day_high": round(h, 2),
                "day_low": round(lo, 2),
                "vwap": vwap,
                "atp": atp,
                # Volume
                "volume": v,
                "avg_volume": avg_vol,
                "vol_ratio": vol_ratio,
                # 52W
                "week52_high": w52h,
                "week52_low": w52l,
                "pct_from_52w_high": pct_h,
                "pct_from_52w_low": pct_l,
                # Trend
                "sma20": sma20,
                "sma50": sma50,
                "sma200": sma200,
                "above_sma20": ab20,
                "above_sma50": ab50,
                "above_sma200": ab200,
                "trend": trend,
                # Technical
                "rsi": rsi_v,
                "macd": round(ml, 4),
                "macd_signal": round(ms, 4),
                "macd_hist": round(mh, 4),
                "bb_upper": bbu,
                "bb_mid": bbm,
                "bb_lower": bbl,
                "error": None,
            })
        except Exception as exc:
            results.append({
                "symbol": sym,
                "display_symbol": sym.replace(".NS", "").replace(".BO", ""),
                "error": str(exc),
            })

    return results


async def fetch_enriched_quotes(symbols: list[str]) -> list[dict]:
    """Async wrapper around the blocking yfinance fetch, with 60s cache."""
    if not symbols:
        return []
    key = ",".join(sorted(symbols))
    now = time.monotonic()
    if key in _cache:
        ts, data = _cache[key]
        if now - ts < _TTL:
            return data
    loop = asyncio.get_running_loop()
    data = await loop.run_in_executor(None, _fetch_sync, symbols)
    _cache[key] = (now, data)
    return data
