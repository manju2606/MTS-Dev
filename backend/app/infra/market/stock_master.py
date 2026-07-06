"""Loads the India Stock Master reference file (built by
scripts/stock_master/build.py from official NSE archive data) for use as
the platform's full-universe symbol search index.

Falls back to an empty list -- callers decide how to degrade -- rather than
raising, since this file is regenerated periodically and a stale checkout
without it shouldn't take down search.
"""
import csv
from functools import lru_cache
from pathlib import Path
from typing import TypedDict

import structlog

log = structlog.get_logger()

CSV_PATH = Path(__file__).resolve().parents[3] / "data" / "India_Stock_Master.csv"


class StockMasterRow(TypedDict):
    symbol: str
    yahoo_symbol: str
    name: str
    sector: str
    segment: str
    exchange: str
    previous_symbol: str
    previous_name: str


@lru_cache(maxsize=1)
def load_stock_master() -> list[StockMasterRow]:
    if not CSV_PATH.exists():
        log.warning("stock_master.csv_missing", path=str(CSV_PATH))
        return []

    rows: list[StockMasterRow] = []
    with CSV_PATH.open(encoding="utf-8", newline="") as f:
        for raw in csv.DictReader(f):
            rows.append({
                "symbol": raw["symbol"],
                "yahoo_symbol": raw["yahoo_symbol"],
                "name": raw["company_name"],
                "sector": raw["nifty_industry"] or raw["segment"],
                "segment": raw["segment"],
                "exchange": raw["exchange"],
                "previous_symbol": raw.get("previous_symbol") or "",
                "previous_name": raw.get("previous_company_name") or "",
            })
    log.info("stock_master.loaded", count=len(rows), path=str(CSV_PATH))
    return rows
