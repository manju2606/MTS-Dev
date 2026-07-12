"""Unit tests for the geopolitical-risk keyword check in the NG/Metals
News Filter category (mcx_ai_score_service._score_news /
mcx_metals_ai_score_service._score_metal_news)."""

from app.services.mcx_ai_score_service import _mentions_geopolitical_risk, _score_news
from app.services.mcx_metals_ai_score_service import _score_metal_news


def _article(title: str, summary: str = "", sentiment_score: float = 0.0) -> dict:
    return {"title": title, "summary": summary, "sentiment_score": sentiment_score}


def test_mentions_geopolitical_risk_matches_real_fetched_article():
    # Actual article fetched by ng_news_fetcher.py -- scored ~neutral by
    # keyword sentiment despite being a clear supply-risk headline.
    item = _article(
        "More LNG Carriers Brave the Strait of Hormuz Despite Renewed Hostilities",
        "liquefied natural gas carriers have gone into the Strait of Hormuz... "
        "hostilities between the United States and Iran",
    )
    assert _mentions_geopolitical_risk(item)


def test_mentions_geopolitical_risk_false_for_routine_article():
    item = _article(
        "Natural Gas Storage Rises Less Than Expected", "EIA reported a smaller-than-forecast build"
    )
    assert not _mentions_geopolitical_risk(item)


def test_score_news_geopolitical_check_supports_buy_when_detected():
    items = [_article("Iran-linked hostilities threaten Strait of Hormuz LNG shipments")]
    cat = _score_news(items, "BUY")
    geo = next(c for c in cat["checks"] if c["label"] == "Geopolitical risk keywords")
    assert geo["passed"] is True
    assert geo["points"] == 5.0


def test_score_news_geopolitical_check_opposes_sell_when_detected():
    items = [_article("Iran-linked hostilities threaten Strait of Hormuz LNG shipments")]
    cat = _score_news(items, "SELL")
    geo = next(c for c in cat["checks"] if c["label"] == "Geopolitical risk keywords")
    assert geo["passed"] is False
    assert geo["points"] == 0.0


def test_score_news_geopolitical_check_absent_supports_sell():
    items = [_article("Natural gas prices steady on mild weather demand")]
    cat = _score_news(items, "SELL")
    geo = next(c for c in cat["checks"] if c["label"] == "Geopolitical risk keywords")
    assert geo["passed"] is True


def test_score_news_category_weight_reflects_two_checks():
    items = [_article("Natural gas prices steady on mild weather demand")]
    cat = _score_news(items, "BUY")
    assert cat["weight"] == 10
    assert len(cat["checks"]) == 2
    assert "geopolitical events -- verify manually before trading" not in cat["excluded"]


def test_score_metal_news_geopolitical_check_supports_buy_when_detected():
    items = [_article("Middle East tension escalates as hostilities spread near Gulf shipping lanes")]
    cat = _score_metal_news(items, "BUY")
    geo = next(c for c in cat["checks"] if c["label"] == "Geopolitical risk keywords")
    assert geo["passed"] is True
    assert cat["weight"] == 10
