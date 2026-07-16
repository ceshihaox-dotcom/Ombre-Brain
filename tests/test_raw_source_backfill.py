import pytest

from tools.raw_source_backfill import (
    CANDIDATE_SCHEMA,
    build_candidates,
    sha256_bytes,
    validate_candidate,
)


def test_build_candidates_copies_exact_inclusive_lines():
    source = "第一行\n第二行\n第三行\n".encode("utf-8")
    candidates, errors = build_candidates(
        source,
        [{"bucket_id": "bucket-1", "start_line": 2, "end_line": 3, "note": "confirmed"}],
        "conversation.txt",
    )

    assert errors == []
    assert candidates == [{
        "schema": CANDIDATE_SCHEMA,
        "bucket_id": "bucket-1",
        "source_name": "conversation.txt",
        "source_sha256": sha256_bytes(source),
        "start_line": 2,
        "end_line": 3,
        "raw_source": "第二行\n第三行\n",
        "raw_sha256": candidates[0]["raw_sha256"],
        "chars": len("第二行\n第三行\n"),
        "note": "confirmed",
    }]
    validate_candidate(candidates[0], sha256_bytes(source))


def test_invalid_ranges_and_duplicates_are_reported_without_candidates():
    source = b"one\ntwo\n"
    candidates, errors = build_candidates(source, [
        {"bucket_id": "bucket-1", "start_line": 0, "end_line": 1},
        {"bucket_id": "bucket-2", "start_line": 2, "end_line": 3},
        {"bucket_id": "", "start_line": 1, "end_line": 1},
    ], "source.txt")

    assert candidates == []
    assert len(errors) == 3


def test_candidate_tampering_and_wrong_source_are_rejected():
    source = b"one\ntwo\n"
    candidates, _ = build_candidates(
        source, [{"bucket_id": "bucket-1", "start_line": 1, "end_line": 1}], "source.txt"
    )
    candidate = candidates[0]

    with pytest.raises(ValueError, match="source file SHA"):
        validate_candidate(candidate, "wrong")
    candidate["raw_source"] = "tampered"
    with pytest.raises(ValueError, match="raw_source SHA"):
        validate_candidate(candidate, sha256_bytes(source))
