import json

import pytest

from feedback_manager import FeedbackConflictError, FeedbackManager


@pytest.mark.asyncio
async def test_missing_feedback_updates_eval_tags_and_is_idempotent(bucket_mgr, tmp_path):
    bucket_id = await bucket_mgr.create(
        content="压榨相关记忆", tags=["压榨"], importance=5, domain=["关系"], name="压榨梗"
    )
    eval_path = tmp_path / "eval.json"
    ledger_path = tmp_path / "ledger.json"
    eval_path.write_text("[]\n", encoding="utf-8")
    manager = FeedbackManager(bucket_mgr, str(eval_path), str(ledger_path))

    result = await manager.resolve(
        feedback_id="fb-12345678",
        action="missing",
        query="怎么没想起薅你的事",
        bucket_id=bucket_id,
        aliases=["薅", "压榨", "薅"],
        note="用户确认就是这条",
    )

    assert result["tags_added"] == ["薅"]
    assert json.loads(eval_path.read_text(encoding="utf-8"))[0]["expect"] == [f"id:{bucket_id}"]
    assert "薅" in (await bucket_mgr.get(bucket_id))["metadata"]["tags"]

    repeated = await manager.resolve(
        feedback_id="fb-12345678",
        action="missing",
        query="怎么没想起薅你的事",
        bucket_id=bucket_id,
        aliases=["薅", "压榨", "薅"],
        note="重复请求不应重复写",
    )
    assert repeated["already_processed"] is True
    assert len(json.loads(eval_path.read_text(encoding="utf-8"))) == 1


@pytest.mark.asyncio
async def test_wrong_hit_merges_forbids_and_rejects_conflicting_reuse(bucket_mgr, tmp_path):
    first = await bucket_mgr.create(
        content="无关一", tags=[], importance=5, domain=["测试"], name="错误桶一"
    )
    second = await bucket_mgr.create(
        content="无关二", tags=[], importance=5, domain=["测试"], name="错误桶二"
    )
    eval_path = tmp_path / "eval.json"
    ledger_path = tmp_path / "ledger.json"
    eval_path.write_text("[]\n", encoding="utf-8")
    manager = FeedbackManager(bucket_mgr, str(eval_path), str(ledger_path))

    await manager.resolve(
        feedback_id="fb-wrong-0001", action="wrong-hit", query="普通消息", bucket_id=first
    )
    await manager.resolve(
        feedback_id="fb-wrong-0002", action="wrong-hit", query="普通消息", bucket_id=second
    )
    cases = json.loads(eval_path.read_text(encoding="utf-8"))
    assert cases[0]["forbid"] == ["错误桶一", "错误桶二"]

    with pytest.raises(FeedbackConflictError):
        await manager.resolve(
            feedback_id="fb-wrong-0001", action="wrong-hit", query="另一条消息", bucket_id=first
        )


@pytest.mark.asyncio
async def test_transaction_restores_tags_and_eval_when_ledger_write_fails(
    bucket_mgr, tmp_path, monkeypatch
):
    bucket_id = await bucket_mgr.create(
        content="原内容", tags=["原标签"], importance=5, domain=["测试"], name="事务桶"
    )
    eval_path = tmp_path / "eval.json"
    ledger_path = tmp_path / "ledger.json"
    eval_path.write_text("[]\n", encoding="utf-8")
    manager = FeedbackManager(bucket_mgr, str(eval_path), str(ledger_path))

    import feedback_manager as module

    real_write = module.atomic_write_text
    failed = False

    def fail_ledger_once(path, text):
        nonlocal failed
        if str(path) == str(ledger_path) and not failed:
            failed = True
            raise OSError("simulated ledger failure")
        return real_write(path, text)

    monkeypatch.setattr(module, "atomic_write_text", fail_ledger_once)
    with pytest.raises(RuntimeError, match="feedback transaction failed"):
        await manager.resolve(
            feedback_id="fb-rollback-1",
            action="missing",
            query="换一种说法",
            bucket_id=bucket_id,
            aliases=["新标签"],
        )

    assert json.loads(eval_path.read_text(encoding="utf-8")) == []
    assert (await bucket_mgr.get(bucket_id))["metadata"]["tags"] == ["原标签"]
    assert not ledger_path.exists()
