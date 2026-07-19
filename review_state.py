"""Canonical review/quarantine tag transitions for Ombre memories."""

STATUS_REFINED = "__import_refined"
STATUS_FLAGGED = "__import_flagged"
REVIEW_PENDING = "review-pending"
INTIMACY_PENDING = "intimacy-pending"
INTIMACY = "intimacy"

_REVIEW_TAGS = {
    STATUS_REFINED,
    STATUS_FLAGGED,
    REVIEW_PENDING,
    INTIMACY_PENDING,
    INTIMACY,
}


def review_status(tags) -> str:
    values = [str(tag) for tag in (tags or [])]
    if STATUS_REFINED in values:
        return "refined"
    if STATUS_FLAGGED in values:
        return "flagged"
    return "pending"


def is_intimate(tags) -> bool:
    values = [str(tag) for tag in (tags or [])]
    return INTIMACY in values or INTIMACY_PENDING in values


def normalize_review_tags(tags, status: str, intimate=None) -> list[str]:
    """Return tags for a review state without losing unrelated metadata.

    Pending/flagged memories are quarantined. Refining releases the generic
    quarantine and promotes intimacy-pending to the approved intimacy channel.
    """
    if status not in {"pending", "flagged", "refined"}:
        raise ValueError("status must be pending, flagged, or refined")

    current = [str(tag) for tag in (tags or []) if str(tag)]
    intimate_value = is_intimate(current) if intimate is None else bool(intimate)
    result = []
    for tag in current:
        if tag in _REVIEW_TAGS or tag in result:
            continue
        result.append(tag)

    if status == "refined":
        result.append(STATUS_REFINED)
        if intimate_value:
            result.append(INTIMACY)
    else:
        if status == "flagged":
            result.append(STATUS_FLAGGED)
        result.append(REVIEW_PENDING)
        if intimate_value:
            result.append(INTIMACY_PENDING)
    return result


def quarantine_new_tags(tags, *, bucket_type="dynamic", created_by=None) -> list[str]:
    """Quarantine new AI/import memories; user-written and feel entries bypass it."""
    current = [str(tag) for tag in (tags or []) if str(tag)]
    if created_by == "user" or bucket_type == "feel":
        return current
    return normalize_review_tags(current, "pending")
