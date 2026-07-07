"""Combine every parsed source into the single India_Stock_Master frame.

Merge order documents provenance: a `data_sources` column on every row lists
exactly which raw files contributed to it, so nothing in the final CSV is
unexplainable.
"""

import pandas as pd
import structlog

from . import clean, config

log = structlog.get_logger()

_SEGMENT_SOURCE = {"EQUITY": "EQUITY_L", "SME": "SME_EQUITY_L", "ETF": "eq_etfseclist"}

# Broadest -> narrowest: later entries win ties, so a stock's most
# prominent index membership determines its industry label.
_INDUSTRY_PRIORITY = ["nifty500", "nifty200", "nifty100", "nifty_next50", "nifty50"]

_FINAL_COLUMNS = [
    "symbol",
    "yahoo_symbol",
    "company_name",
    "isin",
    "isin_valid",
    "segment",
    "exchange",
    "listing_series",
    "current_series",
    "surveillance_band",
    "surveillance_remarks",
    "listing_date",
    "face_value",
    "paidup_value",
    "market_lot",
    "etf_underlying",
    "previous_symbol",
    "symbol_change_date",
    "previous_company_name",
    "name_change_date",
    "nifty_industry",
    "in_nifty50",
    "in_nifty_next50",
    "in_nifty100",
    "in_nifty200",
    "in_nifty500",
    "data_sources",
    "pipeline_run_at",
]


def build_master(sources: dict[str, pd.DataFrame], run_timestamp: str) -> pd.DataFrame:
    universe = pd.concat(
        [sources["equity"], sources["sme"], sources["etf"]], ignore_index=True, sort=False
    )

    dup_symbols = universe.loc[universe.duplicated(subset="symbol", keep=False), "symbol"].unique()
    if len(dup_symbols):
        log.warning("stock_master.merge.cross_segment_duplicates", symbols=list(dup_symbols))
    universe = universe.drop_duplicates(subset="symbol", keep="first")

    universe["data_sources"] = universe["segment"].map(_SEGMENT_SOURCE)

    band_cols = ["symbol", "current_series", "surveillance_band", "surveillance_remarks"]
    sb = sources["series_band"][band_cols]
    universe = universe.merge(sb, on="symbol", how="left")
    universe.loc[universe["current_series"].notna(), "data_sources"] += ";sec_list"

    sc = sources["symbol_change"][["new_symbol", "old_symbol", "change_date"]].rename(
        columns={
            "new_symbol": "symbol",
            "old_symbol": "previous_symbol",
            "change_date": "symbol_change_date",
        }
    )
    universe = universe.merge(sc, on="symbol", how="left")
    universe.loc[universe["previous_symbol"].notna(), "data_sources"] += ";symbolchange"

    nc = sources["name_change"][["symbol", "previous_company_name", "change_date"]].rename(
        columns={"change_date": "name_change_date"}
    )
    universe = universe.merge(nc, on="symbol", how="left")
    universe.loc[universe["previous_company_name"].notna(), "data_sources"] += ";namechange"

    industry_map: dict[str, str] = {}
    for key in _INDUSTRY_PRIORITY:
        idx_df = sources[key]
        industry_map.update(dict(zip(idx_df["symbol"], idx_df["industry"], strict=True)))

    for key in config.NIFTY_INDEX_KEYS:
        flag_col = f"in_{key}"
        member_symbols = set(sources[key]["symbol"])
        universe[flag_col] = universe["symbol"].isin(member_symbols)
        universe.loc[universe[flag_col], "data_sources"] += f";{key}"

    universe["nifty_industry"] = universe["symbol"].map(industry_map).fillna("")
    universe["isin_valid"] = clean.is_valid_isin(universe["isin"].fillna(""))
    universe["yahoo_symbol"] = universe["symbol"] + ".NS"
    universe["exchange"] = "NSE"
    universe["pipeline_run_at"] = run_timestamp

    for col in ("listing_date", "symbol_change_date", "name_change_date"):
        universe[col] = clean.date_to_iso(universe[col])

    for col in _FINAL_COLUMNS:
        if col not in universe.columns:
            universe[col] = pd.NA

    universe = universe[_FINAL_COLUMNS].sort_values("symbol").reset_index(drop=True)
    return universe
