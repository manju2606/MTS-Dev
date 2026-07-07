"""India Stock Master pipeline entrypoint.

Downloads NSE's official archive files, cleans and merges them into a single
India_Stock_Master.csv covering NSE Equity + SME + ETF, enriched with
current series/surveillance band, symbol/name change history, and Nifty
50/Next50/100/200/500 index membership.

Usage (from backend/):
    python -m scripts.stock_master.build
    python -m scripts.stock_master.build --out /path/to/output.csv

Sources requested but NOT included in this run (NSE main-site / BSE API are
blocked by bot-protection from wherever this pipeline is executed) are listed
explicitly in config.SKIPPED_SOURCES and echoed in the report below — see
data/stock_master_report.json after a run.
"""

import argparse
import json
import sys
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

import pandas as pd
import structlog

from app.core.logging import configure_logging

from . import config, sources
from .http_client import FetchError
from .merge import build_master

configure_logging()
log = structlog.get_logger()

_OPTIONAL_SOURCE_FETCHERS = {
    "sme": sources.fetch_sme,
    "etf": sources.fetch_etf,
    "series_band": sources.fetch_series_band,
    "symbol_change": sources.fetch_symbol_changes,
    "name_change": sources.fetch_name_changes,
}


def _empty_like(columns: list[str]) -> pd.DataFrame:
    return pd.DataFrame(columns=columns)


def fetch_all() -> tuple[dict[str, pd.DataFrame], dict[str, str]]:
    """Fetch every source. Equity is mandatory (pipeline aborts without it);
    everything else degrades gracefully with a logged failure so a single
    flaky endpoint doesn't take down the whole run.
    """
    failures: dict[str, str] = {}
    fetched: dict[str, pd.DataFrame] = {}

    try:
        fetched["equity"] = sources.fetch_equity()
    except FetchError as exc:
        log.error("stock_master.fetch.fatal", source="equity", error=str(exc))
        raise

    optional_empty_columns = {
        "sme": ["symbol", "company_name", "segment"],
        "etf": ["symbol", "company_name", "segment", "etf_underlying"],
        "series_band": ["symbol", "current_series", "surveillance_band", "surveillance_remarks"],
        "symbol_change": ["new_symbol", "old_symbol", "change_date"],
        "name_change": ["symbol", "previous_company_name", "change_date"],
    }
    for name, fn in _OPTIONAL_SOURCE_FETCHERS.items():
        try:
            fetched[name] = fn()
        except FetchError as exc:
            log.error("stock_master.fetch.degraded", source=name, error=str(exc))
            failures[name] = str(exc)
            fetched[name] = _empty_like(optional_empty_columns[name])

    for key in config.NIFTY_INDEX_KEYS:
        try:
            fetched[key] = sources.fetch_nifty_index(key)
        except FetchError as exc:
            log.error("stock_master.fetch.degraded", source=key, error=str(exc))
            failures[key] = str(exc)
            fetched[key] = _empty_like(["symbol", "industry"])

    return fetched, failures


def build_report(
    master: pd.DataFrame,
    fetched: dict[str, pd.DataFrame],
    failures: dict[str, str],
    run_timestamp: str,
) -> dict[str, Any]:
    segment_counts = master["segment"].value_counts().to_dict()
    has_prev_symbol = "previous_symbol" in master
    has_prev_name = "previous_company_name" in master
    symbol_changes = int(master["previous_symbol"].notna().sum()) if has_prev_symbol else 0
    name_changes = int(master["previous_company_name"].notna().sum()) if has_prev_name else 0
    return {
        "run_timestamp": run_timestamp,
        "total_rows": int(len(master)),
        "by_segment": segment_counts,
        "isin_valid_count": int(master["isin_valid"].sum()),
        "isin_invalid_count": int((~master["isin_valid"]).sum()),
        "symbol_changes_matched": symbol_changes,
        "name_changes_matched": name_changes,
        "index_membership": {
            key: int(master[f"in_{key}"].sum()) for key in config.NIFTY_INDEX_KEYS
        },
        "sources_fetched_ok": [k for k in fetched if k not in failures],
        "sources_failed_this_run": failures,
        "sources_intentionally_skipped": config.SKIPPED_SOURCES,
    }


def main() -> None:
    parser = argparse.ArgumentParser(
        description="Build India_Stock_Master.csv from official NSE archive data."
    )
    parser.add_argument("--out", type=str, default=str(config.OUTPUT_CSV), help="Output CSV path")
    args = parser.parse_args()

    run_timestamp = datetime.now(UTC).isoformat(timespec="seconds")
    log.info("stock_master.run.start", run_timestamp=run_timestamp)

    fetched, failures = fetch_all()
    master = build_master(fetched, run_timestamp)

    out_path = Path(args.out)
    out_path.parent.mkdir(parents=True, exist_ok=True)
    master.to_csv(out_path, index=False)

    report = build_report(master, fetched, failures, run_timestamp)
    config.REPORT_JSON.parent.mkdir(parents=True, exist_ok=True)
    config.REPORT_JSON.write_text(json.dumps(report, indent=2))

    log.info("stock_master.run.complete", output=str(out_path), rows=len(master))

    print(f"\nWrote {len(master)} rows to {out_path}")
    print(f"  By segment: {report['by_segment']}")
    print(f"  ISIN valid: {report['isin_valid_count']} / invalid: {report['isin_invalid_count']}")
    print(f"  Symbol changes matched: {report['symbol_changes_matched']}")
    print(f"  Name changes matched: {report['name_changes_matched']}")
    print(f"  Index membership: {report['index_membership']}")
    if failures:
        print(f"\n  WARNING - sources that failed THIS run (degraded, not fatal): {list(failures)}")
    print(f"\n  Intentionally NOT included (see {config.REPORT_JSON.name} for reasons):")
    for src in config.SKIPPED_SOURCES:
        print(f"    - {src}")
    print(f"\nFull report: {config.REPORT_JSON}")

    if failures:
        sys.exit(1)


if __name__ == "__main__":
    main()
