from datetime import UTC, datetime


def utcnow() -> datetime:
    """All database timestamps use naive UTC, never local machine time."""
    return datetime.now(UTC).replace(tzinfo=None)
