from dataclasses import dataclass, field
from datetime import datetime
from uuid import UUID, uuid4


@dataclass
class ChartinkScanLink:
    """A Chartink screener URL to poll on a schedule -- the *pull* half of
    the Chartink integration, alongside the webhook's *push* half (see
    api/v1/chartink.py's POST /webhook). Results from either path land in
    the same chartink_candidates table via the same
    chartink_signal_service.process_chartink_alert(), so the rest of the
    pipeline (scoring, storage, email, the /chartink dashboard) doesn't
    need to know which source a candidate came from.

    scan_clause is an optional manual override: Chartink's screener page
    is a client-rendered SPA, so auto-extracting the scan condition from
    its HTML is best-effort and can break if they change their frontend.
    Pasting the exact scan_clause value (grabbed once from your browser's
    Network tab on a POST to chartink.com/screener/process) is the
    reliable path if auto-extraction fails for a given link.
    """

    scan_name: str
    url: str
    poll_interval_minutes: int = 60
    enabled: bool = True
    scan_clause: str | None = None
    last_polled_at: datetime | None = None
    last_poll_status: str | None = None  # "ok" | "error: <message>"
    last_poll_count: int = 0
    id: UUID = field(default_factory=uuid4)
    created_at: datetime = field(default_factory=datetime.utcnow)
