"""Transactional closure for confirmed injection feedback."""

import asyncio
import json
import os
import re
from datetime import datetime, timezone

from utils import atomic_write_text


class FeedbackValidationError(ValueError):
    pass


class FeedbackConflictError(RuntimeError):
    pass


class FeedbackManager:
    SCHEMA = "feedback-ledger/v1"

    def __init__(self, bucket_manager, eval_path: str, ledger_path: str):
        self.bucket_manager = bucket_manager
        self.eval_path = eval_path
        self.ledger_path = ledger_path
        self._lock = asyncio.Lock()

    @staticmethod
    def _load_json(path, default):
        if not os.path.exists(path):
            return default
        with open(path, "r", encoding="utf-8") as handle:
            return json.load(handle)

    @staticmethod
    def _snapshot(path):
        if not os.path.exists(path):
            return None
        with open(path, "r", encoding="utf-8") as handle:
            return handle.read()

    @staticmethod
    def _restore(path, old_text):
        if old_text is None:
            if os.path.exists(path):
                os.remove(path)
            return
        atomic_write_text(path, old_text)

    @staticmethod
    def _write_json(path, value):
        os.makedirs(os.path.dirname(path) or ".", exist_ok=True)
        atomic_write_text(path, json.dumps(value, ensure_ascii=False, indent=2) + "\n")

    @staticmethod
    def _normalize_aliases(aliases):
        out = []
        seen = set()
        for raw in aliases if isinstance(aliases, list) else []:
            alias = str(raw or "").strip()[:40]
            key = alias.casefold()
            if not alias or key in seen:
                continue
            seen.add(key)
            out.append(alias)
            if len(out) >= 8:
                break
        return out

    @staticmethod
    def _merge_eval_case(eval_set, action, query, bucket_id, bucket_name, feedback_id, note):
        if action == "missing":
            expected = f"id:{bucket_id}"
            for case in eval_set:
                if case.get("query") == query and not case.get("negative") and not case.get("forbid"):
                    values = list(case.get("expect") or [])
                    if expected not in values:
                        values.append(expected)
                        case["expect"] = values
                        return True
                    return False
            eval_set.append({
                "query": query,
                "expect": [expected],
                "note": f"反馈闭环 {feedback_id}: {note or bucket_name}",
                "feedback_id": feedback_id,
            })
            return True

        for case in eval_set:
            if case.get("query") == query and case.get("forbid") and not case.get("negative"):
                values = list(case.get("forbid") or [])
                if bucket_name not in values:
                    values.append(bucket_name)
                    case["forbid"] = values
                    return True
                return False
        eval_set.append({
            "query": query,
            "forbid": [bucket_name],
            "note": f"反馈闭环 {feedback_id}: {note or '不该想起'}",
            "feedback_id": feedback_id,
            "feedback_bucket_id": bucket_id,
        })
        return True

    def list_resolutions(self):
        ledger = self._load_json(self.ledger_path, {"schema": self.SCHEMA, "items": {}})
        return ledger.get("items") or {}

    async def resolve(self, *, feedback_id, action, query, bucket_id, aliases=None, note=""):
        feedback_id = str(feedback_id or "").strip()
        action = str(action or "").strip()
        query = str(query or "").strip()[:500]
        bucket_id = str(bucket_id or "").strip()[:64]
        note = str(note or "").strip()[:500]
        aliases = self._normalize_aliases(aliases)

        if not re.fullmatch(r"[A-Za-z0-9._:-]{8,128}", feedback_id):
            raise FeedbackValidationError("invalid feedback_id")
        if action not in ("missing", "wrong-hit"):
            raise FeedbackValidationError("action must be missing or wrong-hit")
        if not query:
            raise FeedbackValidationError("query is required")
        if not bucket_id:
            raise FeedbackValidationError("bucket_id is required")
        if action == "wrong-hit" and aliases:
            raise FeedbackValidationError("wrong-hit cannot add aliases")

        async with self._lock:
            ledger = self._load_json(self.ledger_path, {"schema": self.SCHEMA, "items": {}})
            ledger.setdefault("schema", self.SCHEMA)
            items = ledger.setdefault("items", {})
            existing = items.get(feedback_id)
            signature = {
                "action": action,
                "query": query,
                "bucket_id": bucket_id,
                "aliases": aliases,
            }
            if existing:
                if all(existing.get(key) == value for key, value in signature.items()):
                    return {"ok": True, "already_processed": True, **existing}
                raise FeedbackConflictError("feedback_id already resolved with different data")

            bucket = await self.bucket_manager.get(bucket_id)
            if not bucket:
                raise FeedbackValidationError("bucket not found")
            meta = bucket.get("metadata") or {}
            bucket_name = str(meta.get("name") or bucket_id)
            if action == "missing" and aliases and meta.get("created_by") == "user":
                raise FeedbackValidationError("user-created bucket tags require manual editing")

            old_tags = list(meta.get("tags") or [])
            tag_keys = {str(tag).casefold() for tag in old_tags}
            tags_added = [alias for alias in aliases if alias.casefold() not in tag_keys]
            if len(old_tags) + len(tags_added) > 20:
                raise FeedbackValidationError("tag limit would exceed 20; curate tags first")

            eval_set = self._load_json(self.eval_path, [])
            if not isinstance(eval_set, list):
                raise FeedbackValidationError("eval set must be a JSON array")
            eval_changed = self._merge_eval_case(
                eval_set, action, query, bucket_id, bucket_name, feedback_id, note
            )
            resolution = {
                **signature,
                "bucket_name": bucket_name,
                "tags_added": tags_added,
                "eval_changed": eval_changed,
                "resolved_at": datetime.now(timezone.utc).isoformat(),
            }

            old_eval = self._snapshot(self.eval_path)
            old_ledger = self._snapshot(self.ledger_path)
            tags_changed = False
            try:
                if tags_added:
                    ok = await self.bucket_manager.update(bucket_id, tags=old_tags + tags_added)
                    if not ok:
                        raise RuntimeError("bucket tag update failed")
                    tags_changed = True
                if eval_changed:
                    self._write_json(self.eval_path, eval_set)
                items[feedback_id] = resolution
                self._write_json(self.ledger_path, ledger)
            except Exception as error:
                rollback_errors = []
                for rollback in (
                    lambda: self._restore(self.eval_path, old_eval),
                    lambda: self._restore(self.ledger_path, old_ledger),
                ):
                    try:
                        rollback()
                    except Exception as rollback_error:
                        rollback_errors.append(str(rollback_error))
                if tags_changed:
                    try:
                        await self.bucket_manager.update(bucket_id, tags=old_tags)
                    except Exception as rollback_error:
                        rollback_errors.append(str(rollback_error))
                detail = f"; rollback errors: {rollback_errors}" if rollback_errors else ""
                raise RuntimeError(f"feedback transaction failed: {error}{detail}") from error

            return {"ok": True, "already_processed": False, **resolution}
