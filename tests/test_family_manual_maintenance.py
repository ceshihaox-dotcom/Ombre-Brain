from types import SimpleNamespace

import numpy as np
import pytest

from families import FamilyManager, FamilyValidationError


async def make_bucket(bucket_mgr, name):
    return await bucket_mgr.create(
        content=f"{name} content", tags=[], importance=5, domain=["测试"], name=name
    )


@pytest.mark.asyncio
async def test_manual_family_create_and_member_replacement(bucket_mgr, tmp_path):
    ids = [await make_bucket(bucket_mgr, f"bucket-{index}") for index in range(4)]
    manager = FamilyManager(str(tmp_path / "families"), None, bucket_mgr, None)

    family = await manager.create_manual_family(ids[:2], name="手工家族", summary="人工弧线")
    assert family["membership_is_manual"] is True
    assert family["name_is_manual"] is True
    assert family["summary_is_manual"] is True
    assert family["member_ids"] == ids[:2]

    updated = await manager.set_members(family["id"], ids[:3])
    assert updated["member_ids"] == ids[:3]
    assert updated["size"] == 3
    assert manager.load()["families"][0]["member_ids"] == ids[:3]


@pytest.mark.asyncio
async def test_member_move_is_explicit_and_dissolves_too_small_source(bucket_mgr, tmp_path):
    ids = [await make_bucket(bucket_mgr, f"bucket-{index}") for index in range(4)]
    manager = FamilyManager(str(tmp_path / "families"), None, bucket_mgr, None)
    first = await manager.create_manual_family(ids[:2], name="first")
    second = await manager.create_manual_family(ids[2:], name="second")

    with pytest.raises(FamilyValidationError, match="already belong"):
        await manager.set_members(second["id"], [ids[1], ids[2]])

    moved = await manager.set_members(second["id"], [ids[1], ids[2]], move=True)
    assert moved["member_ids"] == [ids[1], ids[2]]
    state = manager.load()
    source = next(family for family in state["families"] if family["id"] == first["id"])
    assert source["member_ids"] == [ids[0]]
    assert source["dissolved"] is True
    assert source["needs_review"] is True


@pytest.mark.asyncio
async def test_rebuild_preserves_manual_family_and_excludes_reserved_members(
    bucket_mgr, tmp_path, monkeypatch
):
    ids = [await make_bucket(bucket_mgr, f"bucket-{index}") for index in range(5)]
    engine = SimpleNamespace(model="fake-model")
    manager = FamilyManager(str(tmp_path / "families"), engine, bucket_mgr, None)
    manual = await manager.create_manual_family(ids[:2], name="保留家族")
    loaded_ids = []

    def fake_vectors(requested):
        loaded_ids.extend(requested)
        return {
            bucket_id: np.array([1.0, float(index + 1)], dtype=np.float32)
            for index, bucket_id in enumerate(requested)
        }

    monkeypatch.setattr(manager, "_load_vectors", fake_vectors)
    monkeypatch.setattr(manager, "_cluster", lambda matrix, threshold: [list(range(len(matrix)))])

    result = await manager.rebuild()
    assert result["ok"] is True
    assert set(loaded_ids) == set(ids[2:])
    state = manager.load()
    kept = next(family for family in state["families"] if family["id"] == manual["id"])
    automatic = next(family for family in state["families"] if family["id"] != manual["id"])
    assert kept["membership_is_manual"] is True
    assert kept["name"] == "保留家族"
    assert set(automatic["member_ids"]) == set(ids[2:])
    assert automatic["membership_is_manual"] is False


@pytest.mark.asyncio
async def test_manual_family_rejects_protected_member(bucket_mgr, tmp_path):
    ordinary = await make_bucket(bucket_mgr, "ordinary")
    protected = await make_bucket(bucket_mgr, "protected")
    assert await bucket_mgr.update(protected, protected=True)
    manager = FamilyManager(str(tmp_path / "families"), None, bucket_mgr, None)

    with pytest.raises(FamilyValidationError, match="protected/highlight"):
        await manager.create_manual_family([ordinary, protected], name="invalid")
