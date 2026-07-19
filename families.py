# -*- coding: utf-8 -*-
# ============================================================
# families.py — 记忆家族/归纳层 (2026-07-06 设计稿 P1)
#
# 纯派生索引层: 原始桶零接触, families.json 整体可重算。
# 设计稿=Desktop\记忆库优化\07-家族层设计稿_2026-07-06.md, 原型=tools/family_proto.js。
# 要点(原型实证):
#   - 平均连接凝聚聚类(连通分量会链式吞并出200人巨块, 不用)
#   - 钉选/高亮/保护图腾桶排除出成员资格(链式污染源, 与注入引力桶同病同治)
#   - 族规模上限15, 最小3; 阈值默认0.75
#   - 起名/弧线摘要复用 dehydrator 的 LLM 客户端(她的配置=deepseek-chat)
#   - 她的编辑(改名/钉住/解散)在重算时按成员重叠(Jaccard≥0.5)继承
# ============================================================

import hashlib
import asyncio
import json
import logging
import os
import sqlite3
import uuid
from datetime import datetime

import numpy as np

from utils import parse_iso_datetime

logger = logging.getLogger("ombre_brain.families")

DEFAULT_THRESHOLD = 0.75
MIN_FAMILY = 3
MAX_FAMILY = 15
MIN_MANUAL_FAMILY = 2


def _family_exclude_tags(base_dir: str = "") -> set:
    """家族成员资格的 tag 排除集, 默认空=不生效。

    配置来源: runtime_config.json strategy.family_exclude_tags(接受数组/逗号分隔,
    /api/config/strategy 可写) > env OMBRE_FAMILY_EXCLUDE_TAGS(逗号分隔)。
    独立浮现通道的碎片(同一主题池内互相高度相似)聚类会抱成巨族、污染家族语义 —
    与图腾桶排除同病同治, 从成员资格层面拿掉。每次 rebuild 现读, 改配置即生效。
    """
    tags = None
    if base_dir:
        try:
            p = os.path.join(base_dir, "runtime_config.json")
            if os.path.exists(p):
                with open(p, "r", encoding="utf-8") as f:
                    v = (json.load(f).get("strategy") or {}).get("family_exclude_tags")
                if isinstance(v, str):
                    v = v.split(",")
                if isinstance(v, list):
                    tags = [str(t) for t in v]
        except Exception as e:
            logger.warning(f"family_exclude_tags: runtime_config read fail: {e}")
    if tags is None:
        tags = os.environ.get("OMBRE_FAMILY_EXCLUDE_TAGS", "").split(",")
    return {t.strip() for t in tags if t.strip()}


class FamilyValidationError(ValueError):
    pass


class FamilyBusyError(RuntimeError):
    pass


def _now_iso() -> str:
    # UTC+Z 口径(对齐 utils.now_iso): built_at/updated_at 要和桶的 created(UTC+Z)
    # 可比较, 本地 naive 在 JST 下会把"有没有新桶"的判断压住最多 9 小时。
    # 前端 new Date("...Z") 自动转本地显示, 不受影响。
    return datetime.utcnow().isoformat(timespec="seconds") + "Z"


def _fam_id(member_ids: list) -> str:
    h = hashlib.sha1(",".join(sorted(member_ids)).encode("utf-8")).hexdigest()
    return "fam-" + h[:10]


def _jaccard(a: set, b: set) -> float:
    if not a or not b:
        return 0.0
    return len(a & b) / len(a | b)


class FamilyManager:
    def __init__(self, base_dir: str, embedding_engine, bucket_mgr, dehydrator=None):
        self.path = os.path.join(base_dir, "families.json")
        self.engine = embedding_engine
        self.bucket_mgr = bucket_mgr
        self.dehydrator = dehydrator
        self.rebuilding = False
        self._mutation_lock = asyncio.Lock()

    # ---------- 存取 ----------
    def load(self) -> dict:
        try:
            if os.path.exists(self.path):
                with open(self.path, "r", encoding="utf-8") as f:
                    return json.load(f)
        except Exception as e:
            logger.warning(f"[families] load failed: {e}")
        return {"updated_at": "", "params": {}, "families": []}

    def _save(self, state: dict) -> None:
        os.makedirs(os.path.dirname(self.path) or ".", exist_ok=True)
        tmp = self.path + ".tmp"
        with open(tmp, "w", encoding="utf-8") as f:
            json.dump(state, f, ensure_ascii=False, indent=1)
        os.replace(tmp, self.path)

    @staticmethod
    def _find_family(state: dict, fid: str) -> dict | None:
        return next((fam for fam in state.get("families", []) if fam.get("id") == fid), None)

    @staticmethod
    def _normalize_member_ids(member_ids) -> list[str]:
        out = []
        seen = set()
        for raw in member_ids if isinstance(member_ids, list) else []:
            bucket_id = str(raw or "").strip()[:64]
            if not bucket_id or bucket_id in seen:
                continue
            seen.add(bucket_id)
            out.append(bucket_id)
        if not MIN_MANUAL_FAMILY <= len(out) <= MAX_FAMILY:
            raise FamilyValidationError(
                f"manual family requires {MIN_MANUAL_FAMILY}..{MAX_FAMILY} unique members"
            )
        return out

    async def _member_rows(self, member_ids: list[str]) -> list[dict]:
        rows = []
        for bucket_id in member_ids:
            bucket = await self.bucket_mgr.get(bucket_id)
            if not bucket:
                raise FamilyValidationError(f"bucket not found: {bucket_id}")
            meta = bucket.get("metadata") or bucket
            if meta.get("type") in ("archived", "feel") or meta.get("resolved"):
                raise FamilyValidationError(f"bucket is not family-eligible: {bucket_id}")
            if meta.get("pinned") or meta.get("protected") or meta.get("highlight"):
                raise FamilyValidationError(f"protected/highlight bucket cannot join a family: {bucket_id}")
            rows.append({
                "id": bucket_id,
                "name": meta.get("name") or bucket_id,
                "event_time": meta.get("event_time") or meta.get("created") or "",
                "summary": meta.get("summary") or "",
            })
        return rows

    @staticmethod
    def _public_member_rows(rows: list[dict]) -> list[dict]:
        return [
            {"id": row["id"], "name": row["name"], "event_time": row["event_time"]}
            for row in sorted(rows, key=lambda item: item.get("event_time") or "")
        ]

    @staticmethod
    def _membership_conflicts(state: dict, member_ids: list[str], exclude_fid: str = "") -> list[dict]:
        wanted = set(member_ids)
        conflicts = []
        for family in state.get("families", []):
            if family.get("id") == exclude_fid or family.get("dissolved"):
                continue
            overlap = sorted(wanted & set(family.get("member_ids") or []))
            if overlap:
                conflicts.append({"family_id": family.get("id"), "member_ids": overlap})
        return conflicts

    @staticmethod
    def _remove_moved_members(state: dict, conflicts: list[dict]) -> None:
        moved = {member for conflict in conflicts for member in conflict["member_ids"]}
        for family in state.get("families", []):
            if family.get("id") not in {conflict["family_id"] for conflict in conflicts}:
                continue
            kept = [member for member in family.get("member_ids", []) if member not in moved]
            family["member_ids"] = kept
            family["members"] = [
                member for member in family.get("members", []) if member.get("id") in set(kept)
            ]
            family["size"] = len(kept)
            family["membership_is_manual"] = True
            family["edited_at"] = _now_iso()
            if len(kept) < MIN_MANUAL_FAMILY:
                family["dissolved"] = True
                family["needs_review"] = True

    async def update_family(self, fid: str, fields: dict) -> dict | None:
        """Edit name/summary/pinned/dissolved without changing member ownership."""
        if self.rebuilding:
            raise FamilyBusyError("family rebuild in progress")
        async with self._mutation_lock:
            state = self.load()
            fam = self._find_family(state, fid)
            if fam is None:
                return None
            if "name" in fields and str(fields["name"]).strip():
                fam["name"] = str(fields["name"]).strip()[:24]
                fam["name_is_manual"] = True
            if "summary" in fields:
                fam["summary"] = str(fields["summary"] or "").strip()[:400]
                fam["summary_is_manual"] = True
            if "pinned" in fields:
                fam["pinned"] = bool(fields["pinned"])
            if "dissolved" in fields:
                fam["dissolved"] = bool(fields["dissolved"])
            fam["edited_at"] = _now_iso()
            state["updated_at"] = _now_iso()
            self._save(state)
            return fam

    async def create_manual_family(
        self, member_ids, *, name="", summary="", pinned=False, move=False
    ) -> dict:
        if self.rebuilding:
            raise FamilyBusyError("family rebuild in progress")
        member_ids = self._normalize_member_ids(member_ids)
        async with self._mutation_lock:
            state = self.load()
            conflicts = self._membership_conflicts(state, member_ids)
            if conflicts and not move:
                raise FamilyValidationError(f"members already belong to families: {conflicts}")
            rows = await self._member_rows(member_ids)
            if conflicts:
                self._remove_moved_members(state, conflicts)
            named = await self._name_family(rows)
            manual_name = str(name or "").strip()[:24]
            manual_summary = str(summary or "").strip()[:400]
            family = {
                "id": "fam-manual-" + uuid.uuid4().hex[:10],
                "name": manual_name or named["name"],
                "summary": manual_summary or named["summary"],
                "member_ids": member_ids,
                "members": self._public_member_rows(rows),
                "size": len(member_ids),
                "membership_is_manual": True,
                "name_is_manual": bool(manual_name),
                "summary_is_manual": bool(manual_summary),
                "pinned": bool(pinned),
                "dissolved": False,
                "built_at": _now_iso(),
                "edited_at": _now_iso(),
            }
            state.setdefault("families", []).append(family)
            state["updated_at"] = _now_iso()
            self._save(state)
            return family

    async def set_members(self, fid: str, member_ids, *, move=False) -> dict | None:
        if self.rebuilding:
            raise FamilyBusyError("family rebuild in progress")
        member_ids = self._normalize_member_ids(member_ids)
        async with self._mutation_lock:
            state = self.load()
            family = self._find_family(state, fid)
            if family is None:
                return None
            conflicts = self._membership_conflicts(state, member_ids, exclude_fid=fid)
            if conflicts and not move:
                raise FamilyValidationError(f"members already belong to families: {conflicts}")
            rows = await self._member_rows(member_ids)
            if conflicts:
                self._remove_moved_members(state, conflicts)
            family["member_ids"] = member_ids
            family["members"] = self._public_member_rows(rows)
            family["size"] = len(member_ids)
            family["membership_is_manual"] = True
            family["dissolved"] = False
            family["needs_review"] = False
            family["edited_at"] = _now_iso()
            state["updated_at"] = _now_iso()
            self._save(state)
            return family

    async def refresh_family(self, fid: str, *, rename=False) -> dict | None:
        if self.rebuilding:
            raise FamilyBusyError("family rebuild in progress")
        async with self._mutation_lock:
            state = self.load()
            family = self._find_family(state, fid)
            if family is None:
                return None
            rows = await self._member_rows(list(family.get("member_ids") or []))
            named = await self._name_family(rows)
            if rename or not family.get("name_is_manual"):
                family["name"] = named["name"]
                family["name_is_manual"] = False
            family["summary"] = named["summary"]
            family["summary_is_manual"] = False
            family["members"] = self._public_member_rows(rows)
            family["size"] = len(rows)
            family["refreshed_at"] = _now_iso()
            state["updated_at"] = _now_iso()
            self._save(state)
            return family

    # ---------- 重建 ----------
    def _load_vectors(self, ids: list) -> dict:
        """从 embedding 库读当前模型的向量; 返回 {bucket_id: np.array}。"""
        out = {}
        conn = sqlite3.connect(self.engine.db_path)
        try:
            rows = conn.execute("SELECT bucket_id, embedding, model FROM embeddings").fetchall()
        finally:
            conn.close()
        want = set(ids)
        for bid, emb, model in rows:
            if bid in want and self.engine._model_matches(model or ""):
                try:
                    out[bid] = np.array(json.loads(emb), dtype=np.float32)
                except Exception:
                    continue
        return out

    @staticmethod
    def _cluster(vec_matrix: np.ndarray, threshold: float) -> list:
        """平均连接凝聚聚类。返回 index 列表的列表(含单人簇)。"""
        n = vec_matrix.shape[0]
        norms = np.linalg.norm(vec_matrix, axis=1, keepdims=True)
        V = vec_matrix / np.clip(norms, 1e-9, None)
        S = V @ V.T
        np.fill_diagonal(S, 0.0)

        clusters = [[i] for i in range(n)]
        SUM = S.copy()                      # SUM[a][b] = 两簇成员两两相似度之和
        sizes = np.ones(n)
        alive = np.ones(n, dtype=bool)

        while True:
            sz = np.outer(sizes, sizes)
            AVG = np.divide(SUM, sz, out=np.zeros_like(SUM), where=sz > 0)
            mask = np.outer(alive, alive)
            np.fill_diagonal(mask, False)
            combo = sizes[:, None] + sizes[None, :]
            AVG[~mask] = -1.0
            AVG[combo > MAX_FAMILY] = -1.0
            idx = int(np.argmax(AVG))
            a, b = divmod(idx, n)
            if AVG[a, b] < threshold:
                break
            # 合并 b 进 a
            clusters[a].extend(clusters[b])
            clusters[b] = []
            SUM[a, :] += SUM[b, :]
            SUM[:, a] += SUM[:, b]
            SUM[a, a] = 0.0
            sizes[a] += sizes[b]
            alive[b] = False
            SUM[b, :] = 0.0
            SUM[:, b] = 0.0
            sizes[b] = 1  # 防除零, 已 dead
        return [clusters[i] for i in range(n) if alive[i]]

    async def _name_family(self, members: list) -> dict:
        """DeepSeek 起名+弧线摘要; 失败回退机械名。members=[{name,event_time,summary}]"""
        fallback = {
            "name": (members[0].get("name") or "未名")[:12] + f"·等{len(members)}条",
            "summary": "",
        }
        dehy = self.dehydrator
        if not (dehy and getattr(dehy, "api_available", False) and dehy.client):
            return fallback
        lines = []
        for m in sorted(members, key=lambda x: x.get("event_time") or ""):
            lines.append(f"- [{(m.get('event_time') or '')[:10]}] {m.get('name')}: {(m.get('summary') or '')[:80]}")
        system = (
            "你是私人记忆库的整理助手。下面是一簇彼此相关的记忆(按时间排序), 它们构成一条主题弧线。\n"
            '输出 JSON: {"name": "...", "summary": "..."}\n'
            "- name: ≤12字的家族名, 抓主题本质(如\"daddy称呼的演变\"), 不用情感泛词\n"
            "- summary: ≤180字, 按时间线讲这条弧线的来龙去脉(起点→转折→现状), 事实性, 用具体词\n"
            "- 内容可能涉及私密/亲密话题, 照常处理, 措辞与原文一致地坦白"
        )
        try:
            resp = await dehy.client.chat.completions.create(
                model=dehy.model,
                messages=[
                    {"role": "system", "content": system},
                    {"role": "user", "content": "\n".join(lines)[:2400]},
                ],
                response_format={"type": "json_object"},
                max_tokens=300,
                temperature=0.3,
            )
            out = json.loads(resp.choices[0].message.content or "{}")
            name = str(out.get("name", "")).strip()[:24]
            summary = str(out.get("summary", "")).strip()[:400]
            if name:
                return {"name": name, "summary": summary}
        except Exception as e:
            logger.warning(f"[families] naming failed: {e}")
        return fallback

    async def rebuild(self, threshold: float = DEFAULT_THRESHOLD) -> dict:
        """Serialize rebuilds against manual edits so neither side can overwrite the other."""
        if self.rebuilding or self._mutation_lock.locked():
            return {"ok": False, "error": "family mutation already running"}
        async with self._mutation_lock:
            return await self._rebuild_locked(threshold)

    async def _rebuild_locked(self, threshold: float = DEFAULT_THRESHOLD) -> dict:
        """全量重算。返回 {ok, families, orphans, took_s}。"""
        if self.rebuilding:
            return {"ok": False, "error": "rebuild already running"}
        self.rebuilding = True
        t0 = datetime.now()
        try:
            buckets = await self.bucket_mgr.list_all(include_archive=False)
            old = self.load()
            old_fams = old.get("families", [])
            manual_fams = [
                json.loads(json.dumps(family))
                for family in old_fams
                if family.get("membership_is_manual")
            ]
            reserved_ids = {
                bucket_id
                for family in manual_fams
                if not family.get("dissolved")
                for bucket_id in family.get("member_ids", [])
            }
            excl_tags = _family_exclude_tags(os.path.dirname(self.path))
            eligible = []
            for b in buckets:
                meta = b.get("metadata") or b  # list_all 形态兼容
                if meta.get("type") == "feel":
                    continue
                if meta.get("resolved"):
                    continue
                # 图腾桶排除(链式污染源): 钉选/保护/高亮
                if meta.get("pinned") or meta.get("protected") or meta.get("highlight"):
                    continue
                # tag 排除(独立通道碎片, 见 _family_exclude_tags)
                if excl_tags and excl_tags.intersection(meta.get("tags") or []):
                    continue
                bid = b.get("id") or meta.get("id")
                if bid in reserved_ids:
                    continue
                if bid:
                    eligible.append({
                        "id": bid,
                        "name": meta.get("name") or bid,
                        "event_time": meta.get("event_time") or meta.get("created") or "",
                        "summary": meta.get("summary") or "",
                    })
            vecs = self._load_vectors([e["id"] for e in eligible])
            have = [e for e in eligible if e["id"] in vecs]
            if len(have) < MIN_FAMILY and not manual_fams:
                return {"ok": False, "error": f"向量不足: {len(have)}"}
            groups = []
            if len(have) >= MIN_FAMILY:
                M = np.stack([vecs[e["id"]] for e in have])
                groups = self._cluster(M, threshold)

            current = {}
            for bucket in buckets:
                meta = bucket.get("metadata") or bucket
                bucket_id = bucket.get("id") or meta.get("id")
                if bucket_id:
                    current[bucket_id] = meta
            new_fams = []
            for family in manual_fams:
                rows = []
                missing = []
                for bucket_id in family.get("member_ids", []):
                    meta = current.get(bucket_id)
                    if meta is None:
                        missing.append(bucket_id)
                        continue
                    rows.append({
                        "id": bucket_id,
                        "name": meta.get("name") or bucket_id,
                        "event_time": meta.get("event_time") or meta.get("created") or "",
                    })
                family["members"] = sorted(rows, key=lambda row: row.get("event_time") or "")
                family["size"] = len(family.get("member_ids") or [])
                family["missing_member_ids"] = missing
                family["needs_review"] = bool(missing) or family["size"] < MIN_MANUAL_FAMILY
                new_fams.append(family)

            for g in groups:
                if len(g) < MIN_FAMILY:
                    continue
                members = [have[i] for i in g]
                member_ids = [m["id"] for m in members]
                fid = _fam_id(member_ids)
                # 继承她的编辑: 成员重叠 Jaccard≥0.5 的旧族
                inherited = None
                for of in old_fams:
                    if of.get("membership_is_manual"):
                        continue
                    if _jaccard(set(member_ids), set(of.get("member_ids", []))) >= 0.5:
                        inherited = of
                        break
                if inherited and inherited.get("name_is_manual"):
                    named = {"name": inherited["name"], "summary": inherited.get("summary", "")}
                elif inherited and inherited.get("id") == fid and inherited.get("name"):
                    # 成员集完全没变(id=成员哈希) → 复用上次的名字/摘要, 省 DeepSeek 调用
                    # (自动重建挂到写入事件后会频繁跑, 只有真变动的族才重新起名)
                    named = {"name": inherited["name"], "summary": inherited.get("summary", "")}
                else:
                    named = await self._name_family(members)
                new_fams.append({
                    "id": fid,
                    "name": named["name"],
                    "summary": named["summary"],
                    "member_ids": member_ids,
                    "members": [{"id": m["id"], "name": m["name"], "event_time": m["event_time"]}
                                for m in sorted(members, key=lambda x: x.get("event_time") or "")],
                    "size": len(member_ids),
                    "membership_is_manual": False,
                    "name_is_manual": bool(inherited and inherited.get("name_is_manual")),
                    "pinned": bool(inherited and inherited.get("pinned")),
                    "dissolved": bool(inherited and inherited.get("dissolved")),
                    "built_at": _now_iso(),
                })
            new_fams.sort(key=lambda f: (
                not bool(f.get("pinned")),
                not bool(f.get("membership_is_manual")),
                -int(f.get("size") or 0),
            ))
            state = {
                "updated_at": _now_iso(),
                "params": {"threshold": threshold, "min": MIN_FAMILY, "max": MAX_FAMILY,
                           "model": self.engine.model, "eligible": len(have),
                           "manual_families": len(manual_fams)},
                "families": new_fams,
            }
            self._save(state)
            took = (datetime.now() - t0).total_seconds()
            logger.info(f"[families] rebuilt: {len(new_fams)} families from {len(have)} buckets in {took:.1f}s")
            return {"ok": True, "families": len(new_fams), "eligible": len(have),
                    "took_s": round(took, 1)}
        except Exception as e:
            logger.exception("[families] rebuild failed")
            return {"ok": False, "error": str(e)}
        finally:
            self.rebuilding = False

    # ---------- 自动重建 (与写入事件同步, 2026-07-09 她拍板) ----------
    # 她的记忆写入跟着"新一天第一条消息"走(4点JST切窗→收口→分日块入OB), 不是定时的。
    # 所以不用挂钟表: 每 poll_s 看一眼"有没有比上次建族更新的桶、且最近 debounce_s 没新写入"
    # → 有就重建。效果: 收口写完尘埃落定十分钟后家族自动刷新; hold 白天写的也能入族。
    # 阀门: env FAMILIES_AUTO_REBUILD=off 关掉。成员没变的族复用命名(见 rebuild), 频繁跑近零成本。
    async def auto_rebuild_loop(self, poll_s: int = 300, debounce_s: int = 600):
        import asyncio
        logger.info(f"[families] auto-rebuild loop up (poll {poll_s}s, debounce {debounce_s}s)")
        while True:
            try:
                await asyncio.sleep(poll_s)
                if self.rebuilding:
                    continue
                state = self.load()
                built_at = state.get("updated_at") or ""
                buckets = await self.bucket_mgr.list_all(include_archive=False)
                newest = ""
                for b in buckets:
                    meta = b.get("metadata") or {}
                    c = str(meta.get("created") or "")
                    if c > newest:
                        newest = c
                if not newest:
                    continue
                # UTC 口径解析比较(对齐 2.5.3 修复): 之前 UTC 的 created 和本地 naive 的
                # built_at 直接串比较, JST 下"有没有新桶"被压住最多 9 小时。
                # 旧格式 built_at(无 Z/offset, 本地时间)不可比 → 视为需要重建,
                # 重建后 updated_at 落成 UTC+Z, 一次收敛。
                newest_dt = parse_iso_datetime(newest)
                built_dt = None
                if built_at and (built_at.rstrip().endswith(("Z", "z")) or "+" in built_at):
                    try:
                        built_dt = parse_iso_datetime(built_at)
                    except (ValueError, TypeError):
                        built_dt = None
                if built_dt is not None and newest_dt <= built_dt:
                    continue  # 没有比上次建族更新的桶
                age_s = (datetime.utcnow() - newest_dt).total_seconds()
                if age_s < debounce_s:
                    continue  # 还在写入余波里, 等尘埃落定
                logger.info(f"[families] new buckets since {built_at or '(never)'} → auto rebuild")
                await self.rebuild()
            except Exception:
                logger.exception("[families] auto-rebuild tick failed (loop continues)")
