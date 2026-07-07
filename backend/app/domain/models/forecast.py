from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime
from uuid import UUID


@dataclass
class ModelForecast:
    model: str  # 'random_forest' | 'gradient_boost' | 'ridge'
    predicted_price: float
    change_pct: float
    confidence: float  # 0.0–1.0
    direction: str  # 'UP' | 'DOWN' | 'FLAT'


@dataclass
class HorizonForecast:
    horizon: str  # 'day' | 'week' | 'month'
    horizon_days: int  # 1 | 5 | 22
    target_date: str  # YYYY-MM-DD
    ensemble_price: float
    ensemble_change_pct: float
    lower_bound: float
    upper_bound: float
    direction: str
    models: list[ModelForecast]


@dataclass
class ForecastResult:
    id: UUID
    symbol: str
    name: str
    current_price: float
    prev_close: float
    day_change_pct: float
    week_change_pct: float
    high_52w: float
    low_52w: float
    volume: int
    avg_volume: int
    forecasts: list[HorizonForecast]  # [day, week, month]
    agent_analysis: str
    generated_at: datetime
