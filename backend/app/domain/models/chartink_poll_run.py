from dataclasses import dataclass, field
from datetime import datetime
from uuid import UUID, uuid4


@dataclass
class ChartinkPollRun:
    """One row per poll attempt for a scan link -- unlike ChartinkScanLink's
    own last_polled_at/last_poll_status/last_poll_count (which only ever
    hold the *latest* run, overwritten on every poll), this is an
    append-only log so run history is visible over time, not just the
    most recent one. Covers both the scheduled poll and the "Run Now"
    manual trigger -- same poll_scan_link() call either way."""

    scan_link_id: UUID
    scan_name: str
    status: str  # "ok" | "error: <message>"
    count: int
    id: UUID = field(default_factory=uuid4)
    polled_at: datetime = field(default_factory=datetime.utcnow)
