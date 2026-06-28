"""NSE/BSE stock universe organised by sector and market cap."""

SECTORS: dict[str, list[str]] = {
    "Banking": [
        "HDFCBANK.NS", "ICICIBANK.NS", "SBIN.NS", "KOTAKBANK.NS", "AXISBANK.NS",
        "INDUSINDBK.NS", "BANDHANBNK.NS", "FEDERALBNK.NS", "IDFCFIRSTB.NS", "AUBANK.NS",
        "PNB.NS", "CANBK.NS", "BANKBARODA.NS", "UNIONBANK.NS", "RBLBANK.NS",
    ],
    "IT": [
        "TCS.NS", "INFY.NS", "WIPRO.NS", "HCLTECH.NS", "TECHM.NS",
        "LTIM.NS", "MPHASIS.NS", "PERSISTENT.NS", "COFORGE.NS", "OFSS.NS",
        "KPITTECH.NS", "TATAELXSI.NS", "HEXAWARE.NS",
    ],
    "Pharma": [
        "SUNPHARMA.NS", "DIVISLAB.NS", "CIPLA.NS", "DRREDDY.NS", "APOLLOHOSP.NS",
        "BIOCON.NS", "AUROPHARMA.NS", "TORNTPHARM.NS", "LUPIN.NS", "ALKEM.NS",
        "IPCALAB.NS", "GLENMARK.NS", "NATCOPHARM.NS",
    ],
    "Auto": [
        "MARUTI.NS", "TATAMOTORS.NS", "BAJAJ-AUTO.NS", "HEROMOTOCO.NS", "EICHERMOT.NS",
        "TVSMOTOR.NS", "ASHOKLEY.NS", "BALKRISIND.NS", "MRF.NS", "BOSCHLTD.NS",
        "MOTHERSON.NS", "EXIDEIND.NS", "AMARAJABAT.NS",
    ],
    "FMCG": [
        "HINDUNILVR.NS", "ITC.NS", "NESTLEIND.NS", "BRITANNIA.NS", "DABUR.NS",
        "COLPAL.NS", "GODREJCP.NS", "MARICO.NS", "EMAMILTD.NS", "TATACONSUM.NS",
        "VBL.NS", "RADICO.NS", "MCDOWELL-N.NS",
    ],
    "Metal": [
        "TATASTEEL.NS", "JSWSTEEL.NS", "HINDALCO.NS", "VEDL.NS", "COALINDIA.NS",
        "NMDC.NS", "SAIL.NS", "JINDALSTEL.NS", "NATIONALUM.NS", "WELCORP.NS",
        "APLAPOLLO.NS", "RATNAMANI.NS",
    ],
    "Energy": [
        "RELIANCE.NS", "ONGC.NS", "BPCL.NS", "GAIL.NS", "TATAPOWER.NS",
        "NTPC.NS", "POWERGRID.NS", "IOC.NS", "HPCL.NS", "ADANIGREEN.NS",
        "TORNTPOWER.NS", "CESC.NS", "RECLTD.NS", "PFC.NS",
    ],
    "Infra": [
        "LT.NS", "ADANIPORTS.NS", "ADANIENT.NS", "ULTRACEMCO.NS", "GRASIM.NS",
        "AMBUJACEM.NS", "ACC.NS", "SIEMENS.NS", "ABB.NS", "HAVELLS.NS",
        "BHEL.NS", "IRFC.NS", "RVNL.NS", "IRCON.NS",
    ],
    "Finance": [
        "BAJFINANCE.NS", "BAJAJFINSV.NS", "HDFCLIFE.NS", "SBILIFE.NS", "ICICIPRULI.NS",
        "MUTHOOTFIN.NS", "CHOLAFIN.NS", "MANAPPURAM.NS", "M&MFIN.NS", "LICIHSGFIN.NS",
        "SUNDARMFIN.NS", "ABCAPITAL.NS",
    ],
    "Realty": [
        "DLF.NS", "GODREJPROP.NS", "OBEROIRLTY.NS", "PRESTIGE.NS", "BRIGADE.NS",
        "PHOENIXLTD.NS", "SOBHA.NS", "MAHLIFE.NS",
    ],
    "Consumer": [
        "TITAN.NS", "ASIANPAINT.NS", "PIDILITIND.NS", "BERGEPAINT.NS", "WHIRLPOOL.NS",
        "VOLTAS.NS", "BLUESTARCO.NS", "CROMPTON.NS", "HAVELLS.NS",
    ],
    "Telecom": [
        "BHARTIARTL.NS", "IDEA.NS", "TTML.NS",
    ],
}

# Flatten to full universe (deduplicated)
_seen: set[str] = set()
FULL_UNIVERSE: list[str] = []
SYMBOL_SECTOR: dict[str, str] = {}

for _sector, _syms in SECTORS.items():
    for _s in _syms:
        if _s not in _seen:
            _seen.add(_s)
            FULL_UNIVERSE.append(_s)
            SYMBOL_SECTOR[_s] = _sector
