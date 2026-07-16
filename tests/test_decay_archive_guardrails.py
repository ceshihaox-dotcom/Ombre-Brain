import os

import pytest


@pytest.mark.asyncio
async def test_archive_records_audit_and_unarchive_restores_original_type(bucket_mgr):
    bucket_id = await bucket_mgr.create(
        content="归档护栏测试",
        tags=[],
        importance=3,
        domain=["测试"],
        name="审计桶",
    )

    assert await bucket_mgr.archive(
        bucket_id,
        reason="decay",
        score=0.0042,
        threshold=0.01,
        cycle_id="cycle-test-1",
    )
    archived = await bucket_mgr.get(bucket_id)
    meta = archived["metadata"]

    assert meta["type"] == "archived"
    assert meta["archive_reason"] == "decay"
    assert meta["archive_score"] == pytest.approx(0.0042)
    assert meta["archive_threshold"] == pytest.approx(0.01)
    assert meta["archive_cycle_id"] == "cycle-test-1"
    assert meta["archive_original_type"] == "dynamic"
    assert meta["archived_at"]
    assert meta["archive_history"][-1]["cycle_id"] == "cycle-test-1"

    assert await bucket_mgr.unarchive(bucket_id, reason="test-rollback")
    restored = await bucket_mgr.get(bucket_id)
    restored_meta = restored["metadata"]
    assert restored_meta["type"] == "dynamic"
    assert restored_meta["unarchive_reason"] == "test-rollback"
    assert restored_meta["unarchived_at"]
    assert os.path.normpath(bucket_mgr._find_bucket_file(bucket_id)).startswith(
        os.path.normpath(bucket_mgr.dynamic_dir)
    )


@pytest.mark.asyncio
async def test_decay_cycle_archives_lowest_scores_with_a_hard_cap(bucket_mgr, decay_eng, monkeypatch):
    ids = {}
    for name in ("low", "middle", "high"):
        ids[name] = await bucket_mgr.create(
            content=f"{name} content",
            tags=[],
            importance=3,
            domain=["测试"],
            name=name,
        )

    scores = {"low": 0.001, "middle": 0.002, "high": 0.003}
    monkeypatch.setattr(decay_eng, "calculate_score", lambda meta: scores[meta["name"]])
    decay_eng.threshold = 0.01
    decay_eng.max_archives_per_cycle = 2

    result = await decay_eng.run_decay_cycle()

    assert result["eligible"] == 3
    assert result["archived"] == 2
    assert result["failed"] == 0
    assert result["deferred"] == 1
    assert result["archive_limit"] == 2
    assert result["cycle_id"]

    low = await bucket_mgr.get(ids["low"])
    middle = await bucket_mgr.get(ids["middle"])
    high = await bucket_mgr.get(ids["high"])
    assert low["metadata"]["type"] == "archived"
    assert middle["metadata"]["type"] == "archived"
    assert high["metadata"]["type"] == "dynamic"
    assert low["metadata"]["archive_cycle_id"] == result["cycle_id"]

    rollback = await bucket_mgr.rollback_archive_cycle(result["cycle_id"])
    assert rollback["matched"] == 2
    assert rollback["restored"] == 2
    assert rollback["failed"] == []
    assert (await bucket_mgr.get(ids["low"]))["metadata"]["type"] == "dynamic"
    assert (await bucket_mgr.get(ids["middle"]))["metadata"]["type"] == "dynamic"


@pytest.mark.asyncio
async def test_zero_cycle_limit_pauses_auto_archive(bucket_mgr, decay_eng, monkeypatch):
    bucket_id = await bucket_mgr.create(
        content="不应自动归档",
        tags=[],
        importance=1,
        domain=["测试"],
        name="paused",
    )
    monkeypatch.setattr(decay_eng, "calculate_score", lambda meta: 0.0)
    decay_eng.threshold = 0.01
    decay_eng.max_archives_per_cycle = 0

    result = await decay_eng.run_decay_cycle()

    assert result["eligible"] == 1
    assert result["archived"] == 0
    assert result["deferred"] == 1
    assert (await bucket_mgr.get(bucket_id))["metadata"]["type"] == "dynamic"