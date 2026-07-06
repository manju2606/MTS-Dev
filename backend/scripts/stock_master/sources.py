"""Fetch + parse each individual NSE archive file into a clean DataFrame.

Every function here does exactly one thing: turn one raw official CSV into a
normalized frame with a uniform `symbol` column, ready for `merge.py` to
combine. No enrichment or cross-file logic lives here.
"""
from io import BytesIO
from typing import Any

import pandas as pd
import structlog

from . import clean, config
from .http_client import fetch_raw

log = structlog.get_logger()


def _read_csv(raw: bytes, **kwargs: Any) -> pd.DataFrame:
    # NSE archive files are inconsistently encoded (plain ASCII with the
    # occasional cp1252 dash/quote in a company name) rather than UTF-8.
    df = pd.read_csv(BytesIO(raw), encoding="cp1252", **kwargs)
    return clean.strip_columns(df)


def fetch_equity() -> pd.DataFrame:
    raw = fetch_raw("equity", config.SOURCE_URLS["equity"])
    df = _read_csv(raw)
    df = df.rename(columns={
        "SYMBOL": "symbol",
        "NAME OF COMPANY": "company_name",
        "SERIES": "listing_series",
        "DATE OF LISTING": "listing_date",
        "PAID UP VALUE": "paidup_value",
        "MARKET LOT": "market_lot",
        "ISIN NUMBER": "isin",
        "FACE VALUE": "face_value",
    })
    df["symbol"] = clean.clean_symbol(df["symbol"])
    df["listing_date"] = clean.parse_date(df["listing_date"])
    df["paidup_value"] = clean.to_numeric(df["paidup_value"])
    df["market_lot"] = clean.to_numeric(df["market_lot"])
    df["face_value"] = clean.to_numeric(df["face_value"])
    df["segment"] = "EQUITY"
    df = clean.strip_strings(df)
    df = df[clean.is_plausible_symbol(df["symbol"])]
    return df.dropna(subset=["symbol"]).drop_duplicates(subset=["symbol"])


def fetch_sme() -> pd.DataFrame:
    raw = fetch_raw("sme", config.SOURCE_URLS["sme"])
    df = _read_csv(raw)
    df = df.rename(columns={
        "SYMBOL": "symbol",
        "NAME OF COMPANY": "company_name",
        "SERIES": "listing_series",
        "DATE OF LISTING": "listing_date",
        "PAID UP VALUE": "paidup_value",
        "MARKET LOT": "market_lot",
        "ISIN NUMBER": "isin",
        "FACE VALUE": "face_value",
    })
    df["symbol"] = clean.clean_symbol(df["symbol"])
    df["listing_date"] = clean.parse_date(df["listing_date"])
    df["paidup_value"] = clean.to_numeric(df["paidup_value"])
    df["market_lot"] = clean.to_numeric(df["market_lot"])
    df["face_value"] = clean.to_numeric(df["face_value"])
    df["segment"] = "SME"
    df = clean.strip_strings(df)
    df = df[clean.is_plausible_symbol(df["symbol"])]
    return df.dropna(subset=["symbol"]).drop_duplicates(subset=["symbol"])


def fetch_etf() -> pd.DataFrame:
    raw = fetch_raw("etf", config.SOURCE_URLS["etf"])
    df = _read_csv(raw)
    df = df.rename(columns={
        "Symbol": "symbol",
        "Underlying": "etf_underlying",
        "SecurityName": "company_name",
        "DateofListing": "listing_date",
        "MarketLot": "market_lot",
        "ISINNumber": "isin",
        "FaceValue": "face_value",
    })
    df["symbol"] = clean.clean_symbol(df["symbol"])
    df["listing_date"] = clean.parse_date(df["listing_date"])
    df["market_lot"] = clean.to_numeric(df["market_lot"])
    df["face_value"] = clean.to_numeric(df["face_value"])
    df["segment"] = "ETF"
    df = clean.strip_strings(df)
    df = df[clean.is_plausible_symbol(df["symbol"])]
    return df.dropna(subset=["symbol"]).drop_duplicates(subset=["symbol"])


def fetch_series_band() -> pd.DataFrame:
    raw = fetch_raw("series_band", config.SOURCE_URLS["series_band"])
    df = _read_csv(raw)
    df = df.rename(columns={
        "Symbol": "symbol",
        "Series": "current_series",
        "Security Name": "security_name_secmaster",
        "Band": "surveillance_band",
        "Remarks": "surveillance_remarks",
    })
    df["symbol"] = clean.clean_symbol(df["symbol"])
    df = clean.strip_strings(df)
    df = df[clean.is_plausible_symbol(df["symbol"])]
    return df.dropna(subset=["symbol"]).drop_duplicates(subset=["symbol"])


def fetch_symbol_changes() -> pd.DataFrame:
    raw = fetch_raw("symbol_change", config.SOURCE_URLS["symbol_change"])
    df = _read_csv(
        raw,
        header=None,
        names=["company_name_at_change", "old_symbol", "new_symbol", "change_date"],
    )
    df["old_symbol"] = clean.clean_symbol(df["old_symbol"])
    df["new_symbol"] = clean.clean_symbol(df["new_symbol"])
    df["change_date"] = clean.parse_date(df["change_date"])
    df = clean.strip_strings(df)
    df = df.dropna(subset=["new_symbol", "change_date"])
    # Keep only the most recent change per current (new) symbol.
    return df.sort_values("change_date").drop_duplicates(subset=["new_symbol"], keep="last")


def fetch_name_changes() -> pd.DataFrame:
    raw = fetch_raw("name_change", config.SOURCE_URLS["name_change"])
    df = _read_csv(raw)
    df = df.rename(columns={
        "NCH_SYMBOL": "symbol",
        "NCH_PREV_NAME": "previous_company_name",
        "NCH_NEW_NAME": "new_company_name",
        "NCH_DT": "change_date",
    })
    df["symbol"] = clean.clean_symbol(df["symbol"])
    df["change_date"] = clean.parse_date(df["change_date"])
    df = clean.strip_strings(df)
    df = df.dropna(subset=["symbol", "change_date"])
    return df.sort_values("change_date").drop_duplicates(subset=["symbol"], keep="last")


def fetch_nifty_index(key: str) -> pd.DataFrame:
    raw = fetch_raw(key, config.SOURCE_URLS[key])
    df = _read_csv(raw)
    df = df.rename(columns={
        "Company Name": "company_name_index",
        "Industry": "industry",
        "Symbol": "symbol",
        "Series": "series_index",
        "ISIN Code": "isin_index",
    })
    df["symbol"] = clean.clean_symbol(df["symbol"])
    df = clean.strip_strings(df)
    df = df[clean.is_plausible_symbol(df["symbol"])]
    return df.dropna(subset=["symbol"]).drop_duplicates(subset=["symbol"])
