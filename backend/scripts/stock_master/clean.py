"""Shared cleaning primitives used while parsing every raw NSE file."""
import re

import pandas as pd

ISIN_RE = re.compile(r"^[A-Z]{2}[A-Z0-9]{9}[0-9]$")
SYMBOL_RE = re.compile(r"^[A-Z0-9&\-]{1,20}$")


def strip_columns(df: pd.DataFrame) -> pd.DataFrame:
    df.columns = [str(c).strip() for c in df.columns]
    return df


def strip_strings(df: pd.DataFrame) -> pd.DataFrame:
    for col in df.select_dtypes(include="object").columns:
        df[col] = df[col].str.strip()
    return df


def clean_symbol(series: pd.Series) -> pd.Series:
    return series.astype(str).str.strip().str.upper()


def to_numeric(series: pd.Series) -> pd.Series:
    cleaned = series.astype(str).str.strip().str.replace(",", "", regex=False)
    cleaned = cleaned.replace({"-": None, "": None, "nan": None, "NA": None})
    return pd.to_numeric(cleaned, errors="coerce")


_DATE_FORMATS = ("%d-%b-%Y", "%d-%b-%y", "%d-%B-%Y")


def parse_date(series: pd.Series) -> pd.Series:
    cleaned = series.astype(str).str.strip()
    result = pd.Series(pd.NaT, index=series.index)
    remaining = cleaned.notna()
    for fmt in _DATE_FORMATS:
        if not remaining.any():
            break
        parsed = pd.to_datetime(cleaned[remaining], format=fmt, errors="coerce")
        result.loc[remaining] = result.loc[remaining].fillna(parsed)
        remaining = result.isna() & cleaned.notna()
    if remaining.any():
        result.loc[remaining] = pd.to_datetime(cleaned[remaining], errors="coerce", dayfirst=True)
    return result


def date_to_iso(series: pd.Series) -> pd.Series:
    return series.dt.strftime("%Y-%m-%d").where(series.notna(), "")


def is_valid_isin(series: pd.Series) -> pd.Series:
    return series.astype(str).str.strip().str.upper().str.match(ISIN_RE)


def is_plausible_symbol(series: pd.Series) -> pd.Series:
    """Filters out stray footer/disclaimer lines (e.g. NSE's "This file is
    updated at 10:30 am everyday.") that occasionally leak into archive CSVs
    as a trailing malformed row.
    """
    return series.astype(str).str.match(SYMBOL_RE)
