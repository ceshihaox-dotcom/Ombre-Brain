from review_state import (
    INTIMACY,
    INTIMACY_PENDING,
    REVIEW_PENDING,
    STATUS_FLAGGED,
    STATUS_REFINED,
    is_intimate,
    normalize_review_tags,
    quarantine_new_tags,
    review_status,
)


def test_pending_and_flagged_states_stay_quarantined():
    assert normalize_review_tags(["topic"], "pending") == ["topic", REVIEW_PENDING]
    assert normalize_review_tags(["topic", STATUS_REFINED], "flagged") == [
        "topic", STATUS_FLAGGED, REVIEW_PENDING,
    ]


def test_refining_releases_quarantine_and_promotes_intimacy():
    tags = normalize_review_tags(
        ["topic", REVIEW_PENDING, INTIMACY_PENDING],
        "refined",
    )
    assert tags == ["topic", STATUS_REFINED, INTIMACY]
    assert review_status(tags) == "refined"
    assert is_intimate(tags) is True


def test_returning_to_pending_demotes_approved_intimacy():
    tags = normalize_review_tags(["topic", STATUS_REFINED, INTIMACY], "pending")
    assert tags == ["topic", REVIEW_PENDING, INTIMACY_PENDING]


def test_intimacy_toggle_obeys_current_review_state():
    assert normalize_review_tags(["topic"], "pending", intimate=True) == [
        "topic", REVIEW_PENDING, INTIMACY_PENDING,
    ]
    assert normalize_review_tags(["topic", STATUS_REFINED], "refined", intimate=True) == [
        "topic", STATUS_REFINED, INTIMACY,
    ]
    assert normalize_review_tags(["topic", INTIMACY], "pending", intimate=False) == [
        "topic", REVIEW_PENDING,
    ]


def test_only_ai_or_import_non_feel_writes_are_quarantined():
    assert quarantine_new_tags(["topic"], created_by=None) == ["topic", REVIEW_PENDING]
    assert quarantine_new_tags(["topic"], created_by="import") == ["topic", REVIEW_PENDING]
    assert quarantine_new_tags(["topic"], created_by="user") == ["topic"]
    assert quarantine_new_tags(["topic"], bucket_type="feel") == ["topic"]
