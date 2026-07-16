import json

from tools.enrich_summaries import (
    CANDIDATE_SCHEMA,
    SNAPSHOT_SCHEMA,
    audit_candidates,
    write_jsonl_atomic,
)


def candidate(**overrides):
    value = {
        "schema": CANDIDATE_SCHEMA,
        "id": "bucket-1",
        "name": "现有名字",
        "event_time": "2026-07-13T00:00:00Z",
        "content_head": "2026年发生的具体事件",
        "summary": "2026年发生的具体事件。",
        "tags_add": ["具体锚点"],
        "suggested_name": "",
        "review": {"status": "pass", "issues": []},
    }
    value.update(overrides)
    return value


def test_clean_v2_candidate_passes_mechanical_audit():
    assert audit_candidates([candidate()]) == []


def test_audit_flags_review_failure_blacklisted_tag_and_unsupported_year():
    issues = audit_candidates([candidate(
        summary="2031年发生了原文没有的事。",
        tags_add=["喜欢"],
        review={"status": "error", "issues": ["timeout"]},
    )])
    messages = [issue["issue"] for issue in issues]
    assert any("blacklisted tags" in message for message in messages)
    assert "second review missing or failed" in messages
    assert any("2031" in message for message in messages)


def test_corrected_candidate_requires_a_second_pass():
    issues = audit_candidates([candidate(review={"status": "corrected", "issues": ["fixed once"]})])
    assert [issue["issue"] for issue in issues] == ["second review missing or failed"]
    assert audit_candidates([
        candidate(review={"status": "corrected-pass", "issues": ["fixed and rechecked"]})
    ]) == []


def test_audit_detects_duplicate_ids_and_proposed_name_collisions():
    issues = audit_candidates([
        candidate(suggested_name="新名字"),
        candidate(id="bucket-1", suggested_name="新名字"),
        candidate(id="bucket-2", suggested_name="新名字"),
    ])
    messages = [issue["issue"] for issue in issues]
    assert "duplicate id" in messages
    assert any("collides" in message for message in messages)


def test_atomic_jsonl_snapshot_is_complete(tmp_path):
    path = tmp_path / "snapshot.jsonl"
    rows = [{
        "schema": SNAPSHOT_SCHEMA,
        "id": "bucket-1",
        "name": "old",
        "summary": "",
        "tags": [],
    }]
    write_jsonl_atomic(str(path), rows)
    assert json.loads(path.read_text(encoding="utf-8")) == rows[0]
