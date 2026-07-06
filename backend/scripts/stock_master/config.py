"""Endpoint registry and constants for the India Stock Master pipeline.

All URLs point at NSE's static archive host (archives.nseindia.com), which
serves official exchange files without the bot-protection layer that
nseindia.com itself uses. Nothing here is a mirror or third-party copy.
"""
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[3]
DATA_DIR = REPO_ROOT / "data"
RAW_CACHE_DIR = DATA_DIR / "raw"
OUTPUT_CSV = DATA_DIR / "India_Stock_Master.csv"
REPORT_JSON = DATA_DIR / "stock_master_report.json"

USER_AGENT = (
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
    "(KHTML, like Gecko) Chrome/124.0 Safari/537.36"
)
REQUEST_HEADERS = {
    "User-Agent": USER_AGENT,
    "Accept": "text/csv,application/csv,text/plain,*/*",
    "Accept-Language": "en-US,en;q=0.9",
}
REQUEST_TIMEOUT = 30.0
MAX_RETRIES = 3
RETRY_BACKOFF_SECONDS = 2.0

NSE_ARCHIVE = "https://archives.nseindia.com"

SOURCE_URLS = {
    "equity": f"{NSE_ARCHIVE}/content/equities/EQUITY_L.csv",
    "sme": f"{NSE_ARCHIVE}/content/equities/SME_EQUITY_L.csv",
    "etf": f"{NSE_ARCHIVE}/content/equities/eq_etfseclist.csv",
    "series_band": f"{NSE_ARCHIVE}/content/equities/sec_list.csv",
    "symbol_change": f"{NSE_ARCHIVE}/content/equities/symbolchange.csv",
    "name_change": f"{NSE_ARCHIVE}/content/equities/namechange.csv",
    "nifty50": f"{NSE_ARCHIVE}/content/indices/ind_nifty50list.csv",
    "nifty_next50": f"{NSE_ARCHIVE}/content/indices/ind_niftynext50list.csv",
    "nifty100": f"{NSE_ARCHIVE}/content/indices/ind_nifty100list.csv",
    "nifty200": f"{NSE_ARCHIVE}/content/indices/ind_nifty200list.csv",
    "nifty500": f"{NSE_ARCHIVE}/content/indices/ind_nifty500list.csv",
}

NIFTY_INDEX_KEYS = ["nifty50", "nifty_next50", "nifty100", "nifty200", "nifty500"]

# Sources requested by the spec that are NOT fetched by this pipeline, and why.
# Surfaced in every run's report so gaps are never silently missing.
SKIPPED_SOURCES = {
    "CM-MII Security File (.gz)": (
        "Download link is served from nseindia.com/all-reports, which sits "
        "behind NSE's Akamai bot-protection wall (confirmed: connection is "
        "reset even for a real headless browser). No working direct URL."
    ),
    "BSE Official Security Master": (
        "BSE's public scrip-master API (api.bseindia.com) returned an HTML "
        "WAF/redirect page instead of JSON when queried from this network. "
        "No BSE-exclusive listings are included in this run."
    ),
    "REIT / InvIT / Debt / Preference Shares / Warrants": (
        "Download links are served from nseindia.com/static/market-data/"
        "securities-available-for-trading, which is behind the same "
        "Akamai wall. Filenames are dated and not guessable without "
        "browsing that page first."
    ),
    "Symbol/Company Name Change lists (NSE 'securities-available-for-trading' page copies)": (
        "Covered instead via archives.nseindia.com/content/equities/"
        "symbolchange.csv and namechange.csv, which are the same underlying "
        "data on the unblocked archive host."
    ),
    "SEBI datasets": (
        "No confirmed official bulk-download endpoint was identified for "
        "SEBI security master data."
    ),
}
