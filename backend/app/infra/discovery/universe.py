"""Curated NSE stock universe for the discovery engine.

~200 liquid stocks: Nifty 50 + Nifty Next 50 + top midcaps.
All symbols use the yfinance .NS suffix.
"""

# (symbol, display_name)
NSE_UNIVERSE: list[tuple[str, str]] = [
    # Nifty 50
    ("RELIANCE.NS",    "Reliance Industries"),
    ("TCS.NS",         "Tata Consultancy Services"),
    ("HDFCBANK.NS",    "HDFC Bank"),
    ("ICICIBANK.NS",   "ICICI Bank"),
    ("HINDUNILVR.NS",  "Hindustan Unilever"),
    ("INFY.NS",        "Infosys"),
    ("ITC.NS",         "ITC"),
    ("SBIN.NS",        "State Bank of India"),
    ("BHARTIARTL.NS",  "Bharti Airtel"),
    ("KOTAKBANK.NS",   "Kotak Mahindra Bank"),
    ("LT.NS",          "Larsen & Toubro"),
    ("AXISBANK.NS",    "Axis Bank"),
    ("HCLTECH.NS",     "HCL Technologies"),
    ("WIPRO.NS",       "Wipro"),
    ("MARUTI.NS",      "Maruti Suzuki"),
    ("SUNPHARMA.NS",   "Sun Pharmaceutical"),
    ("ULTRACEMCO.NS",  "UltraTech Cement"),
    ("TITAN.NS",       "Titan Company"),
    ("NESTLEIND.NS",   "Nestle India"),
    ("BAJFINANCE.NS",  "Bajaj Finance"),
    ("NTPC.NS",        "NTPC"),
    ("POWERGRID.NS",   "Power Grid Corporation"),
    ("ONGC.NS",        "ONGC"),
    ("ADANIENT.NS",    "Adani Enterprises"),
    ("ADANIPORTS.NS",  "Adani Ports"),
    ("BAJAJFINSV.NS",  "Bajaj Finserv"),
    ("DIVISLAB.NS",    "Divi's Laboratories"),
    ("CIPLA.NS",       "Cipla"),
    ("DRREDDY.NS",     "Dr. Reddy's Laboratories"),
    ("COALINDIA.NS",   "Coal India"),
    ("TECHM.NS",       "Tech Mahindra"),
    ("HDFCLIFE.NS",    "HDFC Life Insurance"),
    ("SBILIFE.NS",     "SBI Life Insurance"),
    ("APOLLOHOSP.NS",  "Apollo Hospitals"),
    ("EICHERMOT.NS",   "Eicher Motors"),
    ("JSWSTEEL.NS",    "JSW Steel"),
    ("TATAMOTORS.NS",  "Tata Motors"),
    ("TATACONSUM.NS",  "Tata Consumer Products"),
    ("TATASTEEL.NS",   "Tata Steel"),
    ("BRITANNIA.NS",   "Britannia Industries"),
    ("HEROMOTOCO.NS",  "Hero MotoCorp"),
    ("HINDALCO.NS",    "Hindalco Industries"),
    ("M&M.NS",         "Mahindra & Mahindra"),
    ("GRASIM.NS",      "Grasim Industries"),
    ("BPCL.NS",        "Bharat Petroleum"),
    ("ASIANPAINT.NS",  "Asian Paints"),
    ("BAJAJ-AUTO.NS",  "Bajaj Auto"),
    ("INDUSINDBK.NS",  "IndusInd Bank"),
    ("UPL.NS",         "UPL"),
    ("SHRIRAMFIN.NS",  "Shriram Finance"),
    # Nifty Next 50
    ("VEDL.NS",        "Vedanta"),
    ("BERGEPAINT.NS",  "Berger Paints"),
    ("PFC.NS",         "Power Finance Corporation"),
    ("RECLTD.NS",      "REC Limited"),
    ("HAVELLS.NS",     "Havells India"),
    ("MUTHOOTFIN.NS",  "Muthoot Finance"),
    ("PIDILITIND.NS",  "Pidilite Industries"),
    ("BANKBARODA.NS",  "Bank of Baroda"),
    ("SIEMENS.NS",     "Siemens India"),
    ("ABB.NS",         "ABB India"),
    ("BOSCHLTD.NS",    "Bosch"),
    ("IOC.NS",         "Indian Oil Corporation"),
    ("GAIL.NS",        "GAIL India"),
    ("NAUKRI.NS",      "Info Edge (Naukri)"),
    ("HDFCAMC.NS",     "HDFC Asset Management"),
    ("PIIND.NS",       "PI Industries"),
    ("TORNTPHARM.NS",  "Torrent Pharmaceuticals"),
    ("COLPAL.NS",      "Colgate-Palmolive India"),
    ("DABUR.NS",       "Dabur India"),
    ("MARICO.NS",      "Marico"),
    ("GODREJCP.NS",    "Godrej Consumer Products"),
    ("AMBUJACEM.NS",   "Ambuja Cements"),
    ("ACC.NS",         "ACC"),
    ("SUNTV.NS",       "Sun TV Network"),
    ("TRENT.NS",       "Trent"),
    ("VBL.NS",         "Varun Beverages"),
    ("LUPIN.NS",       "Lupin"),
    ("AUROPHARMA.NS",  "Aurobindo Pharma"),
    ("BIOCON.NS",      "Biocon"),
    ("PETRONET.NS",    "Petronet LNG"),
    ("IRCTC.NS",       "IRCTC"),
    ("ZOMATO.NS",      "Zomato"),
    ("DMART.NS",       "Avenue Supermarts (DMart)"),
    ("PNB.NS",         "Punjab National Bank"),
    ("CANBK.NS",       "Canara Bank"),
    ("ICICIPRULI.NS",  "ICICI Prudential Life"),
    ("ICICIGI.NS",     "ICICI Lombard General Insurance"),
    ("MCDOWELL-N.NS",  "United Spirits"),
    ("TATAPOWER.NS",   "Tata Power"),
    # IT midcaps
    ("LTIM.NS",        "LTIMindtree"),
    ("PERSISTENT.NS",  "Persistent Systems"),
    ("COFORGE.NS",     "Coforge"),
    ("MPHASIS.NS",     "Mphasis"),
    ("KPITTECH.NS",    "KPIT Technologies"),
    ("LTTS.NS",        "L&T Technology Services"),
    ("OFSS.NS",        "Oracle Financial Services"),
    # Pharma midcaps
    ("ZYDUSLIFE.NS",   "Zydus Lifesciences"),
    ("ALKEM.NS",       "Alkem Laboratories"),
    ("IPCALAB.NS",     "IPCA Laboratories"),
    ("GLENMARK.NS",    "Glenmark Pharmaceuticals"),
    ("NATCOPHARM.NS",  "Natco Pharma"),
    # Banking / NBFC midcaps
    ("FEDERALBNK.NS",  "Federal Bank"),
    ("IDFCFIRSTB.NS",  "IDFC First Bank"),
    ("BANDHANBNK.NS",  "Bandhan Bank"),
    ("RBLBANK.NS",     "RBL Bank"),
    ("CHOLAFIN.NS",    "Cholamandalam Investment"),
    ("BAJAJHLDNG.NS",  "Bajaj Holdings"),
    ("JIOFIN.NS",      "Jio Financial Services"),
    ("IEX.NS",         "Indian Energy Exchange"),
    # Infrastructure / Energy
    ("ADANIGREEN.NS",  "Adani Green Energy"),
    ("ADANIPOWER.NS",  "Adani Power"),
    ("ADANIENSOL.NS",  "Adani Energy Solutions"),
    ("NHPC.NS",        "NHPC"),
    ("SJVN.NS",        "SJVN"),
    ("SUZLON.NS",      "Suzlon Energy"),
    ("TORNTPOWER.NS",  "Torrent Power"),
    ("CESC.NS",        "CESC"),
    ("POWERMECH.NS",   "Power Mech Projects"),
    # Cement / Materials
    ("SHREECEM.NS",    "Shree Cement"),
    ("DALBHARAT.NS",   "Dalmia Bharat"),
    ("RAMCOCEM.NS",    "Ramco Cements"),
    ("HEIDELBERG.NS",  "HeidelbergCement India"),
    # Auto ancillaries
    ("MOTHERSON.NS",   "Samvardhana Motherson"),
    ("BHARATFORG.NS",  "Bharat Forge"),
    ("APOLLOTYRE.NS",  "Apollo Tyres"),
    ("BALKRISIND.NS",  "Balkrishna Industries"),
    ("SCHAEFFLER.NS",  "Schaeffler India"),
    # Consumer / Retail
    ("JUBLFOOD.NS",    "Jubilant Foodworks"),
    ("NYKAA.NS",       "FSN E-Commerce (Nykaa)"),
    ("POLICYBZR.NS",   "PB Fintech (PolicyBazaar)"),
    ("CARTRADE.NS",    "CarTrade Tech"),
    # Chemicals
    ("DEEPAKNITR.NS",  "Deepak Nitrite"),
    ("AAPL.NS",        "Aarti Industries"),
    ("VINDHYATEL.NS",  "Vindhya Telelinks"),
    ("SRF.NS",         "SRF"),
    ("ATUL.NS",        "Atul"),
    # Real estate / diversified
    ("DLF.NS",         "DLF"),
    ("GODREJPROP.NS",  "Godrej Properties"),
    ("OBEROIRLTY.NS",  "Oberoi Realty"),
    ("PRESTIGE.NS",    "Prestige Estates"),
    # Insurance / AMC
    ("LICI.NS",        "Life Insurance Corporation"),
    ("STARHEALTH.NS",  "Star Health Insurance"),
    # Others
    ("YESBANK.NS",     "Yes Bank"),
    ("IDEA.NS",        "Vodafone Idea"),
    ("IRFC.NS",        "Indian Railway Finance Corp"),
    ("HAL.NS",         "Hindustan Aeronautics"),
    ("BEL.NS",         "Bharat Electronics"),
    ("BHEL.NS",        "Bharat Heavy Electricals"),
    ("SAIL.NS",        "Steel Authority of India"),
    ("NMDC.NS",        "NMDC"),
    ("GMRAIRPORT.NS",  "GMR Airports"),
    ("PAYTM.NS",       "One 97 Communications (Paytm)"),
]

# Flat list of symbols for iteration
UNIVERSE_SYMBOLS: list[str] = [s for s, _ in NSE_UNIVERSE]

# Name lookup for news symbol extraction
_name_index: dict[str, str] = {}
for _sym, _name in NSE_UNIVERSE:
    _base = _sym.replace(".NS", "").lower()
    _name_index[_base] = _sym
    for _word in _name.lower().split():
        if len(_word) >= 4 and _word not in {"bank", "india", "life", "tech", "corp", "limited"}:
            _name_index.setdefault(_word, _sym)
    _name_index[_name.lower()] = _sym

COMPANY_NAME_TO_SYMBOL: dict[str, str] = _name_index
