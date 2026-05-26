# ============================================================
# Module: Memory Bucket Manager (bucket_manager.py)
# 模块：记忆桶管理器
#
# CRUD operations, multi-dimensional index search, activation updates
# for memory buckets.
# 记忆桶的增删改查、多维索引搜索、激活更新。
#
# Core design:
# 核心逻辑：
#   - Each bucket = one Markdown file (YAML frontmatter + body)
#     每个记忆桶 = 一个 Markdown 文件
#   - Storage by type: permanent / dynamic / archive
#     存储按类型分目录
#   - Multi-dimensional soft index: domain + valence/arousal + fuzzy text
#     多维软索引：主题域 + 情感坐标 + 文本模糊匹配
#   - Search strategy: domain pre-filter → weighted multi-dim ranking
#     搜索策略：主题域预筛 → 多维加权精排
#   - Emotion coordinates based on Russell circumplex model:
#     情感坐标基于环形情感模型（Russell circumplex）：
#       valence (0~1): 0=negative → 1=positive
#       arousal (0~1): 0=calm → 1=excited
#
# Depended on by: server.py, decay_engine.py
# 被谁依赖：server.py, decay_engine.py
# ============================================================

import os
import math
import logging
import re
import shutil
from collections import Counter
from datetime import datetime
from pathlib import Path
from typing import Optional

import frontmatter
import jieba
from rapidfuzz import fuzz

from utils import generate_bucket_id, sanitize_name, safe_path, now_iso

logger = logging.getLogger("ombre_brain.bucket")


class BucketManager:
    """
    Memory bucket manager — entry point for all bucket CRUD operations.
    Buckets are stored as Markdown files with YAML frontmatter for metadata
    and body for content. Natively compatible with Obsidian browsing/editing.
    记忆桶管理器 —— 所有桶的 CRUD 操作入口。
    桶以 Markdown 文件存储，YAML frontmatter 存元数据，正文存内容。
    天然兼容 Obsidian 直接浏览和编辑。
    """

    def __init__(self, config: dict):
        # --- Read storage paths from config / 从配置中读取存储路径 ---
        self.base_dir = config["buckets_dir"]
        self.permanent_dir = os.path.join(self.base_dir, "permanent")
        self.dynamic_dir = os.path.join(self.base_dir, "dynamic")
        self.archive_dir = os.path.join(self.base_dir, "archive")
        self.feel_dir = os.path.join(self.base_dir, "feel")
        self.trash_dir = os.path.join(self.base_dir, "trash")  # 软删除目录(回收站),可 restore
        self.fuzzy_threshold = config.get("matching", {}).get("fuzzy_threshold", 50)
        self.max_results = config.get("matching", {}).get("max_results", 5)

        # --- Wikilink config / 双链配置 ---
        wikilink_cfg = config.get("wikilink", {})
        self.wikilink_enabled = wikilink_cfg.get("enabled", True)
        self.wikilink_use_tags = wikilink_cfg.get("use_tags", False)
        self.wikilink_use_domain = wikilink_cfg.get("use_domain", True)
        self.wikilink_use_auto_keywords = wikilink_cfg.get("use_auto_keywords", True)
        self.wikilink_auto_top_k = wikilink_cfg.get("auto_top_k", 8)
        self.wikilink_min_len = wikilink_cfg.get("min_keyword_len", 2)
        self.wikilink_exclude_keywords = set(wikilink_cfg.get("exclude_keywords", []))
        self.wikilink_stopwords = {
            "的", "了", "在", "是", "我", "有", "和", "就", "不", "人",
            "都", "一个", "上", "也", "很", "到", "说", "要", "去",
            "你", "会", "着", "没有", "看", "好", "自己", "这", "他", "她",
            "我们", "你们", "他们", "然后", "今天", "昨天", "明天", "一下",
            "the", "and", "for", "are", "but", "not", "you", "all", "can",
            "had", "her", "was", "one", "our", "out", "has", "have", "with",
            "this", "that", "from", "they", "been", "said", "will", "each",
        }
        self.wikilink_stopwords |= {w.lower() for w in self.wikilink_exclude_keywords}

        # --- Search scoring weights / 检索权重配置 ---
        scoring = config.get("scoring_weights", {})
        self.w_topic = scoring.get("topic_relevance", 4.0)
        self.w_emotion = scoring.get("emotion_resonance", 2.0)
        self.w_time = scoring.get("time_proximity", 2.5)
        self.w_importance = scoring.get("importance", 1.0)
        self.content_weight = scoring.get("content_weight", 3.0)  # Added to allow better content-based matching during merge
        # warmth_boost: 高 valence(>0.5)桶在检索时获得额外加分,跟 query 是否带情感坐标无关。
        # 跟 emotion_resonance 不同 — emotion_resonance 是 Russell 距离,
        # 无 query emotion 时退化为常数 0.5,对亲密时刻无帮助。
        # warmth_boost 是"温度向"偏置:让高 valence(温暖)桶天然更易浮现。
        # bonus 走分子,不进分母 → w_warmth=0 时零行为变化(开源版默认)。
        # 个人配置:warmth_boost=2.0 → b_valence=0.9 桶 ≈ 加 1/5 个 topic 命中分
        # 优先级: env > config.yaml > 默认 0; env 加 OMBRE_SCORING_WARMTH_BOOST 即可
        _env_warmth = os.environ.get("OMBRE_SCORING_WARMTH_BOOST")
        try:
            self.w_warmth = float(
                _env_warmth if _env_warmth is not None else scoring.get("warmth_boost", 0.0)
            )
        except (ValueError, TypeError):
            self.w_warmth = 0.0
        logger.info(
            f"[scoring] warmth_boost loaded: {self.w_warmth} "
            f"(env raw={_env_warmth!r}, config yaml={scoring.get('warmth_boost', None)!r})"
        )

        # 命中频次统计 (v1 in-memory, 重启清零; 反向反馈"哪些桶被高频检索 / 哪些从未"):
        # 结构: {bucket_id: {count, last_hit_iso, last_query}}; 总数: self._total_searches
        # 跨 search/breath 累计 — 任何走 self.search() 的命中都计数 (含 /api/search + breath dynamic 池)。
        # 不持久化是有意为之: 简单 + 重启 = 自然重置, 便于"清零后看哪些桶又被命中"做实验。
        # 想要持久化可未来 flush 到 {buckets_dir}/hit_stats.json, 不影响当前接口。
        self._hit_stats: dict = {}
        self._total_searches: int = 0

        # 最近搜索追溯 (ring buffer, 容量 20): 给前端"我这次发消息浮现了哪些"用。
        # 结构: deque([{ts, query, top: [{id, name, score, matched_in, title_hit}, ...]}, ...])
        # 跟 dryrun_log 内容相似但是结构化 + 走 endpoint 而不是 Render 日志, 体感顺很多。
        from collections import deque as _deque
        self._recent_searches = _deque(maxlen=20)

        # title_hit_bonus: title 字段 partial_ratio ≥ _MATCH_THRESHOLD 时给 final normalized 加此分。
        # 解决场景: 关键词正好在 title 命中, 但桶因 time/importance 拖低总分排到弱命中之后。
        # 默认 0 → 行为完全不变(开源 / 上游兼容); 用户 runtime 设 +15~+50 试。
        # 这是 bonus 不进分母, 直接 += normalized, 跟 warmth 同思路。
        self.title_hit_bonus = float(scoring.get("title_hit_bonus", 0.0))
        # keyword_first_sort: True 时 search() 结果按 (title_hit_flag desc, score desc) 二级排序。
        # 比 title_hit_bonus 更激进: 任何 title 命中都排到所有非 title 命中前面。
        # 默认 False; 推荐先用 title_hit_bonus 调到满意, 这个留作"实在压不上去"的核选项。
        self.keyword_first_sort = bool(scoring.get("keyword_first_sort", False))
        # dryrun_log: True 时每次 search() 调用打印 top-N 详细(query / 桶 id / 分数 / 命中字段 / 有无 bonus 对照)。
        # 用于调优 title_hit_bonus 的取值, 也给用户看"哪条记忆经常被命中"做写作反馈。
        # 走 logger.info, Render 日志能直接看到。默认 False 不污染日志。
        self.dryrun_log = bool(scoring.get("dryrun_log", False))
        # precise_match_mode: 切换打分算法 fuzzy → 严格关键词 token 命中。
        # query 按标点/空格切 token (len ≥ 2), 每个 token 在桶各字段做严格 substring 命中,
        # 命中分 = sum(命中 token × 字段权重), emotion/time/importance/warmth 全砍。
        # 解决: 长 query 在 partial_ratio 下错乱 + 高 valence 桶被 warmth_boost 推得无关键词也排前。
        # 默认 False → 维持原 fuzzy 行为, 开源/上游兼容。
        self.precise_match_mode = bool(scoring.get("precise_match_mode", False))

    # Runtime-tunable scoring keys (whitelist; values type-coerced per key).
    # 跟 decay_engine.DEFAULTS 同思路 — 限定可被 /api/scoring-config 改的 key, 防误写。
    SCORING_OVERRIDE_DEFAULTS = {
        "title_hit_bonus": 0.0,        # float, 0~100
        "keyword_first_sort": False,   # bool
        "dryrun_log": False,           # bool
        "precise_match_mode": False,   # bool — 严格关键词命中模式 (砍 emotion/time/importance/warmth)
    }

    def apply_runtime_scoring_overrides(self, overrides: dict) -> None:
        """Apply runtime scoring overrides to this instance (in-place).
        启动 + 每次 POST /api/scoring-config 后调用一次, 立刻生效到下次 search()。
        未在 overrides 里出现的 key 保留 __init__ 时读的值(可能来自 yaml/默认)。"""
        if not isinstance(overrides, dict):
            return
        if "title_hit_bonus" in overrides:
            try:
                self.title_hit_bonus = max(0.0, float(overrides["title_hit_bonus"]))
            except (TypeError, ValueError):
                pass
        if "keyword_first_sort" in overrides:
            self.keyword_first_sort = bool(overrides["keyword_first_sort"])
        if "dryrun_log" in overrides:
            self.dryrun_log = bool(overrides["dryrun_log"])
        if "precise_match_mode" in overrides:
            self.precise_match_mode = bool(overrides["precise_match_mode"])
        logger.info(
            f"[scoring] runtime overrides applied: "
            f"title_hit_bonus={self.title_hit_bonus}, "
            f"keyword_first_sort={self.keyword_first_sort}, "
            f"dryrun_log={self.dryrun_log}, "
            f"precise_match_mode={self.precise_match_mode}"
        )

    def current_scoring_overrides(self) -> dict:
        """Return current values of runtime-tunable scoring keys (for /api/scoring-config GET)."""
        return {
            "title_hit_bonus": self.title_hit_bonus,
            "keyword_first_sort": self.keyword_first_sort,
            "dryrun_log": self.dryrun_log,
            "precise_match_mode": self.precise_match_mode,
        }

    # query 切 token 用正则: 中英标点 + 空白 + 全角符号
    # 切完保留 len 2..12 的 token (太短 stopword 噪音, 太长几乎不会在桶里出现)
    _TOKEN_SPLIT_RE = None  # lazy compile

    @classmethod
    def _split_query_tokens(cls, query: str) -> list:
        """切 query 成关键词 tokens。中文不分词只切标点 — 4 字关键词如"又快又短"会作整 token 出来。
        过长 token (> 12 字, 几乎不可能在任何桶里 substring 命中) 自动丢弃。
        过短 token (< 2 字, stopword) 也丢弃。"""
        import re
        if cls._TOKEN_SPLIT_RE is None:
            # 按中英标点、空白、引号、括号切; 保留普通字符
            cls._TOKEN_SPLIT_RE = re.compile(r'[\s,。!?:;、《》「」"\'""''()()【】\[\]<>\.\!\?\:;,/\\\|·~`@#\$%\^&\*\+=\-_]+')
        raw = cls._TOKEN_SPLIT_RE.split(query or "")
        return [t for t in raw if 2 <= len(t) <= 12]

    def _calc_precise_match(self, query: str, bucket: dict) -> dict:
        """关键词 token 命中模式 — 严格 substring, 不走 fuzz partial_ratio。
        每个 query token 在桶各字段做 `token in field_text`, 命中累加该字段权重。
        Score = sum(命中 token × 字段权重); 无命中 = 0 = 不入选。

        字段权重沿用 fuzzy 路径同样的值: name×3 / domain×2.5 / tags×2 / summary×1.5 / content×content_weight
        Returns 跟 _calc_topic_match 同 shape: {score, matched_in, field_scores}
        """
        tokens = self._split_query_tokens(query)
        if not tokens:
            return {"score": 0.0, "matched_in": [], "field_scores": {}, "tokens_hit": {}}

        meta = bucket.get("metadata", {}) or {}
        name = str(meta.get("name") or "")
        summary = str(meta.get("summary") or "")
        content = str(bucket.get("content") or "")
        domain_str = " ".join(meta.get("domain") or [])
        tags_str = " ".join(meta.get("tags") or [])

        fields = [
            ("title",   name,       3.0),
            ("domain",  domain_str, 2.5),
            ("tag",     tags_str,   2.0),
            ("summary", summary,    1.5),
            ("content", content,    self.content_weight),
        ]

        total_score = 0.0
        matched_in = []
        tokens_hit = {}     # field -> list[tokens]
        field_scores = {}   # field -> int (100 if any token hit in this field else 0)

        for fname, ftext, fweight in fields:
            hits = [t for t in tokens if t and t in ftext]
            if hits:
                matched_in.append(fname)
                total_score += fweight * len(hits)
                tokens_hit[fname] = hits
                field_scores[fname] = 100
            else:
                field_scores[fname] = 0

        # 归一化到 0~100, 跟 fuzzy 路径量纲对齐 (ombre-inject.js DEFAULT_THRESHOLD=30 等阈值能复用)
        # 设计: 1 token 严格命中 title (×3.0) → 30 分 = 刚好过 auto-inject 默认阈值,
        #       命中 2 个字段或 2 个 token → 50~60, 多字段多 token 累加, 100 封顶
        raw_score = total_score
        normalized_score = min(total_score * 10.0, 100.0)

        return {
            "score": normalized_score,
            "raw_score": raw_score,
            "matched_in": matched_in,
            "field_scores": field_scores,
            "tokens_hit": tokens_hit,
        }

    async def get_hit_stats(self, limit: int = 50) -> dict:
        """Return top-N most-hit buckets by count + total search count.
        反向反馈写作: 哪些桶经常被检索 / 哪些从未被命中 → 看 ×0 频次的桶大概率 title 没写成钩子。
        v1 in-memory (重启清零); 同时拿桶名补全, 找不到的桶 (已删除/归档) 也保留 id 但标 [missing]。
        """
        # 按 count 倒序
        sorted_items = sorted(
            self._hit_stats.items(),
            key=lambda kv: kv[1].get("count", 0),
            reverse=True,
        )[:max(1, min(500, int(limit)))]

        out = []
        for bid, rec in sorted_items:
            name = bid
            try:
                bucket = await self.get(bid)
                if bucket:
                    name = (bucket.get("metadata") or {}).get("name") or bid
                else:
                    name = f"[missing] {bid}"
            except Exception:
                name = bid
            out.append({
                "id": bid,
                "name": name,
                "count": rec.get("count", 0),
                "last_hit": rec.get("last_hit_iso", ""),
                "last_query": rec.get("last_query", ""),
            })

        return {
            "total_searches": self._total_searches,
            "items": out,
        }

    def reset_hit_stats(self) -> None:
        """清空命中统计 — 用于"清零后看哪些桶又被命中"实验。"""
        self._hit_stats.clear()
        self._total_searches = 0

    def get_recent_searches(self, limit: int = 10) -> list:
        """Return list of recent search traces, newest first.
        每条 = {ts, query, result_count, top: [{id, name, type, score, matched_in, title_hit, field_scores}]}。
        给前端"我这次发消息浮现了哪些"看, 也方便排查"为什么这条没浮现"。"""
        n = max(1, min(20, int(limit)))
        # deque 是 oldest-first; 反转给 newest-first 更符合"最近"语义
        items = list(self._recent_searches)
        items.reverse()
        return items[:n]

    # ---------------------------------------------------------
    # Create a new bucket
    # 创建新桶
    # Write content and metadata into a .md file
    # 将内容和元数据写入一个 .md 文件
    # ---------------------------------------------------------
    async def create(
        self,
        content: str,
        tags: list[str] = None,
        importance: int = 5,
        domain: list[str] = None,
        valence: float = 0.5,
        arousal: float = 0.3,
        bucket_type: str = "dynamic",
        name: str = None,
        pinned: bool = False,
        protected: bool = False,
        highlight: bool = False,
        event_time: str = None,
        created_by: str = None,
        summary: str = None,
    ) -> str:
        """
        Create a new memory bucket, return bucket ID.
        创建一个新的记忆桶，返回桶 ID。

        语义(2026-04-26 切片 4 后):
        - protected=True: 防自动衰减归档(永久),importance 锁 10,放 permanent_dir
        - highlight=True: breath 浮现时进核心准则区,不防衰减,不锁 importance
        - pinned=True: 老 API 别名,等价 protected=True + highlight=True
        """
        # 老 pinned 别名 → 拆成 protected + highlight 都开
        if pinned:
            protected = True
            highlight = True

        bucket_id = generate_bucket_id()
        bucket_name = sanitize_name(name) if name else bucket_id
        domain = domain or ["未分类"]
        tags = tags or []
        linked_content = content  # wikilink injection disabled; LLM adds [[]] via prompt

        # --- Protected 桶:importance 锁 10(highlight 单独不锁) ---
        if protected:
            importance = 10

        # --- Build YAML frontmatter metadata / 构建元数据 ---
        metadata = {
            "id": bucket_id,
            "name": bucket_name,
            "tags": tags,
            "domain": domain,
            "valence": max(0.0, min(1.0, valence)),
            "arousal": max(0.0, min(1.0, arousal)),
            "importance": max(1, min(10, importance)),
            "type": bucket_type,
            "created": now_iso(),
            "last_active": now_iso(),
            "activation_count": 1,
        }
        # event_time 是用户/AI 设置的"事件实际发生时间",跟系统级 created 区分
        # 没传或非法就不写,读取时 dehydrator/前端会退回 created
        from utils import normalize_event_time as _nev
        et = _nev(event_time)
        if et:
            metadata["event_time"] = et
        # created_by: 'user' 表示 dashboard 手动创建,'ai' 默认(不显式写入,认为 ai 是默认值)
        if created_by:
            metadata["created_by"] = str(created_by)
        if protected:
            metadata["protected"] = True
        if highlight:
            metadata["highlight"] = True
        if summary:
            metadata["summary"] = str(summary)[:600]

        # --- Assemble Markdown file (frontmatter + body) ---
        # --- 组装 Markdown 文件 ---
        post = frontmatter.Post(linked_content, **metadata)

        # --- Choose directory by type + primary domain ---
        # --- 按类型 + 主题域选择存储目录(protected → permanent_dir) ---
        if bucket_type == "permanent" or protected:
            type_dir = self.permanent_dir
            if protected and bucket_type != "permanent":
                metadata["type"] = "permanent"
        elif bucket_type == "feel":
            type_dir = self.feel_dir
        else:
            type_dir = self.dynamic_dir
        if bucket_type == "feel":
            primary_domain = "沉淀物"  # feel subfolder name
        else:
            primary_domain = sanitize_name(domain[0]) if domain else "未分类"
        target_dir = os.path.join(type_dir, primary_domain)
        os.makedirs(target_dir, exist_ok=True)

        # --- Filename: readable_name_bucketID.md (Obsidian friendly) ---
        # --- 文件名：可读名称_桶ID.md ---
        if bucket_name and bucket_name != bucket_id:
            filename = f"{bucket_name}_{bucket_id}.md"
        else:
            filename = f"{bucket_id}.md"
        file_path = safe_path(target_dir, filename)

        try:
            with open(file_path, "w", encoding="utf-8") as f:
                f.write(frontmatter.dumps(post))
        except OSError as e:
            logger.error(f"Failed to write bucket file / 写入桶文件失败: {file_path}: {e}")
            raise

        flag_tags = []
        if protected:
            flag_tags.append("PROTECTED")
        if highlight:
            flag_tags.append("HIGHLIGHT")
        logger.info(
            f"Created bucket / 创建记忆桶: {bucket_id} ({bucket_name}) → {primary_domain}/"
            + (" [" + " ".join(flag_tags) + "]" if flag_tags else "")
        )
        return bucket_id

    # ---------------------------------------------------------
    # Read bucket content
    # 读取桶内容
    # Returns {"id", "metadata", "content", "path"} or None
    # ---------------------------------------------------------
    async def get(self, bucket_id: str) -> Optional[dict]:
        """
        Read a single bucket by ID.
        根据 ID 读取单个桶。
        """
        if not bucket_id or not isinstance(bucket_id, str):
            return None
        file_path = self._find_bucket_file(bucket_id)
        if not file_path:
            return None
        return self._load_bucket(file_path)

    # ---------------------------------------------------------
    # Move bucket between directories
    # 在目录间移动桶文件
    # ---------------------------------------------------------
    def _move_bucket(self, file_path: str, target_type_dir: str, domain: list[str] = None) -> str:
        """
        Move a bucket file to a new type directory, preserving domain subfolder.
        Returns new file path.
        """
        primary_domain = sanitize_name(domain[0]) if domain else "未分类"
        target_dir = os.path.join(target_type_dir, primary_domain)
        os.makedirs(target_dir, exist_ok=True)
        filename = os.path.basename(file_path)
        new_path = safe_path(target_dir, filename)
        if os.path.normpath(file_path) != os.path.normpath(new_path):
            os.rename(file_path, new_path)
            logger.info(f"Moved bucket / 移动记忆桶: {filename} → {target_dir}/")
        return new_path

    # ---------------------------------------------------------
    # Update bucket
    # 更新桶
    # Supports: content, tags, importance, valence, arousal, name, resolved
    # ---------------------------------------------------------
    async def update(self, bucket_id: str, **kwargs) -> bool:
        """
        Update bucket content or metadata fields.
        更新桶的内容或元数据字段。
        """
        file_path = self._find_bucket_file(bucket_id)
        if not file_path:
            return False

        try:
            post = frontmatter.load(file_path)
        except Exception as e:
            logger.warning(f"Failed to load bucket for update / 加载桶失败: {file_path}: {e}")
            return False

        # --- Lazy migrate: 老 pinned=True 数据 → protected + highlight ---
        # --- 任何 update 调用都顺手把老字段清掉,逐渐让数据集走向干净 ---
        if "pinned" in post and "protected" not in post:
            post["protected"] = bool(post.get("pinned", False))
            if not post.get("highlight"):
                post["highlight"] = bool(post.get("pinned", False))
        # 调用方传 pinned=True/False 当作"两个都开/都关"的别名
        if "pinned" in kwargs:
            v = bool(kwargs.pop("pinned"))
            kwargs.setdefault("protected", v)
            kwargs.setdefault("highlight", v)

        # --- Protected 桶 importance 锁 10(highlight 单独不锁) ---
        # 例外: 标噪声(resolved=True + importance=1)与 protected 语义矛盾,
        # 自动取消保护让噪声能落, 不要求用户先手动取消置顶
        marking_noise = kwargs.get("resolved") is True and kwargs.get("importance") == 1
        # 取消噪声 = 调用方显式传 resolved=False, 且桶当前确实是噪声态(resolved=True 且 importance=1)
        # 用于稍后从 importance_before_noise 恢复原值, 避免"误触噪声再取消"权重永久丢失
        was_resolved_noise = (
            kwargs.get("resolved") is False
            and bool(post.get("resolved", False))
            and int(post.get("importance", 5) or 5) == 1
        )
        if marking_noise:
            kwargs["protected"] = False
            # highlight 跟 protected 同步取消 — 标噪声(软删除)与"核心准则浮现"语义冲突,
            # 否则桶物理移到 archive/ 后 metadata 仍是 highlight=True, 数据不一致
            kwargs["highlight"] = False
            # 备份当前 importance 以便取消噪声时恢复; 跟 protect 那套同模式
            try:
                cur_imp = int(post.get("importance", 5))
                if cur_imp != 1:
                    post["importance_before_noise"] = cur_imp
            except (ValueError, TypeError):
                pass
        currently_protected = bool(post.get("protected", False)) or kwargs.get("protected", False)
        if currently_protected and not marking_noise:
            kwargs.pop("importance", None)  # 静默忽略,protected 始终是 10

        # frontmatter.Post 不是 dict,没有 .pop();只能用 del,且需要先判断 key 在不在
        # 用一个本地小工具统一处理,避免每处都 try/except
        # 定义在所有字段处理之前 — 早期路径(如取消噪声恢复)也要用
        def _drop(key):
            try:
                if key in post:
                    del post[key]
            except Exception:
                pass

        # --- Update only fields that were passed in / 只改传入的字段 ---
        if "content" in kwargs:
            post.content = kwargs["content"]  # wikilink injection disabled; LLM adds [[]] via prompt
        if "tags" in kwargs:
            post["tags"] = kwargs["tags"]
        if "importance" in kwargs:
            post["importance"] = max(1, min(10, int(kwargs["importance"])))
        if "domain" in kwargs:
            post["domain"] = kwargs["domain"]
        if "valence" in kwargs:
            post["valence"] = max(0.0, min(1.0, float(kwargs["valence"])))
        if "arousal" in kwargs:
            post["arousal"] = max(0.0, min(1.0, float(kwargs["arousal"])))
        if "name" in kwargs:
            post["name"] = sanitize_name(kwargs["name"])
        if "resolved" in kwargs:
            post["resolved"] = bool(kwargs["resolved"])
            # 取消噪声: 若调用方没显式改 importance, 则从 importance_before_noise 恢复
            # (跟"取消钉决恢复 importance"是同 pattern, 避免误触永久丢失原值)
            if was_resolved_noise and "importance" not in kwargs:
                backup = post.get("importance_before_noise")
                if backup is not None:
                    try:
                        post["importance"] = max(1, min(10, int(backup)))
                    except (ValueError, TypeError):
                        pass
            # 桶不再是噪声态了, 清掉备份
            if not bool(kwargs["resolved"]):
                _drop("importance_before_noise")

        if "protected" in kwargs:
            new_protected = bool(kwargs["protected"])
            was_protected = bool(post.get("protected", False))
            post["protected"] = new_protected
            if new_protected and not was_protected:
                # 上钉决: 备份原 importance (可能用户之前手动设过), 再锁 10
                # 取消钉决时从这里恢复, 避免误触永久丢失原值
                try:
                    cur_imp = int(post.get("importance", 5))
                    if cur_imp != 10:
                        post["importance_before_protect"] = cur_imp
                except (ValueError, TypeError):
                    pass
                post["importance"] = 10
            elif not new_protected and was_protected:
                # 取消钉决: 若调用方没显式改 importance, 则从备份恢复
                # (marking_noise 之类同时传 importance 的场景由调用方说了算)
                if "importance" not in kwargs:
                    backup = post.get("importance_before_protect")
                    if backup is not None:
                        try:
                            post["importance"] = max(1, min(10, int(backup)))
                        except (ValueError, TypeError):
                            pass
                _drop("importance_before_protect")
            elif new_protected:
                # 已 protected, 再次写 — 维持锁
                post["importance"] = 10
            # 写新字段后顺手清老 pinned,完成迁移
            _drop("pinned")
        if "highlight" in kwargs:
            post["highlight"] = bool(kwargs["highlight"])
            _drop("pinned")
        # internalized 是新字段名(原 digested),兼容老调用方传 digested
        if "internalized" in kwargs:
            post["internalized"] = bool(kwargs["internalized"])
            # 顺手清理老字段,避免新旧并存歧义
            _drop("digested")
        elif "digested" in kwargs:
            post["internalized"] = bool(kwargs["digested"])
            _drop("digested")
        if "model_valence" in kwargs:
            post["model_valence"] = max(0.0, min(1.0, float(kwargs["model_valence"])))
        # type 字段(导入工作台 feel ↔ dynamic 切换):仅改 metadata,
        # 不在此触发目录移动 — 老桶大批量切换时 IO 成本高,后续 breath/list 都按 metadata 读
        if "type" in kwargs:
            new_type = kwargs["type"]
            if new_type in ("dynamic", "feel", "permanent", "archived"):
                post["type"] = new_type
        # created_by(来源分类) — user / ai / import 三态
        # 'ai' 是历史默认 (导入和 AI proactive 都曾混在 ai 里), 现在 import 单独区分。
        # 未知值静默 drop, 避免脏数据; 以后扩第四种 (如 'system') 加进白名单即可
        if "created_by" in kwargs:
            cb = kwargs["created_by"]
            if cb is None or cb == "":
                _drop("created_by")
            elif str(cb) in {"user", "ai", "import"}:
                post["created_by"] = str(cb)
            else:
                logger.warning(f"忽略未知 created_by 值: {cb!r} (合法: user/ai/import)")
        # raw_source(导入工作台"查看原文"用) — 任意字符串
        if "raw_source" in kwargs:
            rs = kwargs["raw_source"]
            if rs is None or rs == "":
                _drop("raw_source")
            else:
                post["raw_source"] = str(rs)[:8000]  # 截到 8KB 避免 metadata 爆炸
        # source_excerpt(LLM 从原文提取的"最关键一两句对话原话")
        # 用于"重新脱水含正文"的主题锚点法 + 导入工作台"查看原文"按钮
        if "source_excerpt" in kwargs:
            se = kwargs["source_excerpt"]
            if se is None or se == "":
                _drop("source_excerpt")
            else:
                post["source_excerpt"] = str(se)[:600]  # 50-150 字, 600 留余量
        # summary(用户可编辑的摘要,优先于自动 content_preview 显示)
        # 传 None / 空字符串 → 清掉,回退到 content 自动截前 200 字
        if "summary" in kwargs:
            sm = kwargs["summary"]
            if sm is None or sm == "":
                _drop("summary")
            else:
                post["summary"] = str(sm)[:600]  # 摘要不该超过这个长度
        # event_time:用户事后纠正"这事到底发生在哪天"
        # 传 None 或空字符串 → 清掉这个字段(回退到用 created 显示)
        if "event_time" in kwargs:
            from utils import normalize_event_time as _nev
            et = _nev(kwargs["event_time"])
            if et:
                post["event_time"] = et
            else:
                _drop("event_time")

        # --- Auto-refresh activation time / 自动刷新激活时间 ---
        post["last_active"] = now_iso()

        try:
            with open(file_path, "w", encoding="utf-8") as f:
                f.write(frontmatter.dumps(post))
        except OSError as e:
            logger.error(f"Failed to write bucket update / 写入桶更新失败: {file_path}: {e}")
            return False

        # --- Auto-move: protected → permanent/, resolved → archive/ ---
        # --- 自动移动：保护(防衰减) → permanent/，已解决 → archive/ ---
        # 注:highlight 单独不触发移动,它只影响 breath 浮现优先级,不改变存储位置
        domain = post.get("domain", ["未分类"])
        if kwargs.get("protected") and post.get("type") != "permanent":
            post["type"] = "permanent"
            with open(file_path, "w", encoding="utf-8") as f:
                f.write(frontmatter.dumps(post))
            self._move_bucket(file_path, self.permanent_dir, domain)
        elif kwargs.get("resolved") and post.get("type") not in ("permanent", "feel"):
            post["type"] = "archived"
            with open(file_path, "w", encoding="utf-8") as f:
                f.write(frontmatter.dumps(post))
            self._move_bucket(file_path, self.archive_dir, domain)

        logger.info(f"Updated bucket / 更新记忆桶: {bucket_id}")
        return True

    # ---------------------------------------------------------
    # Wikilink injection — DISABLED
    # 自动添加 Obsidian 双链 — 已禁用
    # Now handled by LLM prompts (Gemini adds [[]] for proper nouns)
    # 现在由 LLM prompt 处理（Gemini 对人名/地名/专有名词加 [[]]）
    # ---------------------------------------------------------
    # def _apply_wikilinks(self, content, tags, domain, name): ...
    # def _collect_wikilink_keywords(self, content, tags, domain, name): ...
    # def _normalize_keywords(self, keywords): ...
    # def _extract_auto_keywords(self, content): ...

    # ---------------------------------------------------------
    # Delete bucket
    # 删除桶
    # ---------------------------------------------------------
    async def delete(self, bucket_id: str) -> bool:
        """
        Soft-delete: 移到 trash/ 目录(可在回收站恢复),保留 metadata.original_type
        防止 restore 时丢失原本类型(permanent/dynamic/feel)。
        历史(2026-04-28):之前是 os.remove() 物理删,误删无法恢复;改为软删 +
        新加 purge() 走真删。
        """
        file_path = self._find_bucket_file(bucket_id)
        if not file_path:
            return False

        try:
            post = frontmatter.load(file_path)
            domain = post.get("domain", ["未分类"])
            primary_domain = sanitize_name(domain[0]) if domain else "未分类"
            trash_subdir = os.path.join(self.trash_dir, primary_domain)
            os.makedirs(trash_subdir, exist_ok=True)
            dest = safe_path(trash_subdir, os.path.basename(file_path))

            # 记下 restore 时要恢复的原 type(默认 dynamic)
            original_type = post.get("type", "dynamic")
            if original_type != "trashed":
                post["original_type"] = original_type
            post["type"] = "trashed"
            post["trashed_at"] = now_iso()
            with open(file_path, "w", encoding="utf-8") as f:
                f.write(frontmatter.dumps(post))
            shutil.move(file_path, str(dest))
        except Exception as e:
            logger.error(f"Failed to soft-delete bucket / 软删除桶失败: {bucket_id}: {e}")
            return False

        logger.info(f"Soft-deleted bucket / 移到回收站: {bucket_id} → trash/{primary_domain}/")
        return True

    # ---------------------------------------------------------
    # Restore: 从回收站移回原 type 目录
    # ---------------------------------------------------------
    async def restore(self, bucket_id: str) -> bool:
        file_path = self._find_bucket_file(bucket_id)
        if not file_path:
            return False
        if not os.path.normpath(file_path).startswith(os.path.normpath(self.trash_dir)):
            logger.warning(f"restore: bucket {bucket_id} 不在 trash 里,跳过")
            return False
        try:
            post = frontmatter.load(file_path)
            original_type = post.get("original_type", "dynamic")
            domain = post.get("domain", ["未分类"])
            primary_domain = sanitize_name(domain[0]) if domain else "未分类"

            if original_type == "permanent":
                target_dir = self.permanent_dir
            elif original_type == "feel":
                target_dir = self.feel_dir
                primary_domain = "沉淀物"  # feel 子目录固定
            elif original_type == "archived":
                target_dir = self.archive_dir
            else:
                target_dir = self.dynamic_dir
                original_type = "dynamic"

            dest_subdir = os.path.join(target_dir, primary_domain)
            os.makedirs(dest_subdir, exist_ok=True)
            dest = safe_path(dest_subdir, os.path.basename(file_path))

            post["type"] = original_type
            # 清掉 trash 元数据
            for k in ("original_type", "trashed_at"):
                try:
                    if k in post:
                        del post[k]
                except Exception:
                    pass
            with open(file_path, "w", encoding="utf-8") as f:
                f.write(frontmatter.dumps(post))
            shutil.move(file_path, str(dest))
        except Exception as e:
            logger.error(f"Failed to restore bucket / 恢复桶失败: {bucket_id}: {e}")
            return False
        logger.info(f"Restored bucket / 从回收站恢复: {bucket_id} → {original_type}/{primary_domain}/")
        return True

    # ---------------------------------------------------------
    # Purge: 真物理删除(回收站里点"永久删除")
    # ---------------------------------------------------------
    async def purge(self, bucket_id: str) -> bool:
        file_path = self._find_bucket_file(bucket_id)
        if not file_path:
            return False
        try:
            os.remove(file_path)
        except OSError as e:
            logger.error(f"Failed to purge bucket file / 物理删除桶失败: {file_path}: {e}")
            return False
        logger.info(f"Purged bucket / 物理删除记忆桶: {bucket_id}")
        return True

    # ---------------------------------------------------------
    # List trash: 列回收站里所有桶
    # ---------------------------------------------------------
    async def list_trash(self) -> list[dict]:
        buckets = []
        if not os.path.exists(self.trash_dir):
            return buckets
        for root, _, files in os.walk(self.trash_dir):
            for fname in files:
                if not fname.endswith(".md"):
                    continue
                bucket = self._load_bucket(os.path.join(root, fname))
                if bucket:
                    buckets.append(bucket)
        # 按 trashed_at 倒序
        buckets.sort(key=lambda b: b.get("metadata", {}).get("trashed_at", ""), reverse=True)
        return buckets

    # ---------------------------------------------------------
    # Touch bucket (refresh activation time + increment count)
    # 触碰桶（刷新激活时间 + 累加激活次数）
    # Called on every recall hit; affects decay score.
    # 每次检索命中时调用，影响衰减得分。
    # ---------------------------------------------------------
    async def touch(self, bucket_id: str) -> None:
        """
        Update a bucket's last activation time and count.
        Also triggers time ripple: nearby memories get a slight activation boost.
        更新桶的最后激活时间和激活次数。
        同时触发时间涟漪：时间上相邻的记忆轻微唤醒。
        """
        file_path = self._find_bucket_file(bucket_id)
        if not file_path:
            return

        try:
            post = frontmatter.load(file_path)
            post["last_active"] = now_iso()
            post["activation_count"] = post.get("activation_count", 0) + 1

            with open(file_path, "w", encoding="utf-8") as f:
                f.write(frontmatter.dumps(post))

            # --- Time ripple: boost nearby memories within ±48h ---
            # --- 时间涟漪：±48小时内的记忆轻微唤醒 ---
            current_time = datetime.fromisoformat(str(post.get("created", post.get("last_active", ""))))
            await self._time_ripple(bucket_id, current_time)
        except Exception as e:
            logger.warning(f"Failed to touch bucket / 触碰桶失败: {bucket_id}: {e}")

    async def _time_ripple(self, source_id: str, reference_time: datetime, hours: float = 48.0) -> None:
        """
        Slightly boost activation_count of buckets created/activated near the reference time.
        轻微提升时间相邻桶的激活次数（+0.3），不改 last_active 避免递归唤醒。
        Max 5 buckets rippled per touch to bound I/O.
        """
        try:
            all_buckets = await self.list_all(include_archive=False)
        except Exception:
            return

        rippled = 0
        max_ripple = 5
        for bucket in all_buckets:
            if rippled >= max_ripple:
                break
            if bucket["id"] == source_id:
                continue
            meta = bucket.get("metadata", {})
            # Skip pinned/permanent/feel
            if meta.get("pinned") or meta.get("protected") or meta.get("type") in ("permanent", "feel"):
                continue

            created_str = meta.get("created", meta.get("last_active", ""))
            try:
                created = datetime.fromisoformat(str(created_str))
                delta_hours = abs((reference_time - created).total_seconds()) / 3600
            except (ValueError, TypeError):
                continue

            if delta_hours <= hours:
                # Boost activation_count by 0.3 (fractional), don't change last_active
                file_path = self._find_bucket_file(bucket["id"])
                if not file_path:
                    continue
                try:
                    post = frontmatter.load(file_path)
                    current_count = post.get("activation_count", 1)
                    # Store as float for fractional increments; calculate_score handles it
                    post["activation_count"] = round(current_count + 0.3, 1)
                    with open(file_path, "w", encoding="utf-8") as f:
                        f.write(frontmatter.dumps(post))
                    rippled += 1
                except Exception:
                    continue

    # ---------------------------------------------------------
    # Multi-dimensional search (core feature)
    # 多维搜索（核心功能）
    #
    # Strategy: domain pre-filter → weighted multi-dim ranking
    # 策略：主题域预筛 → 多维加权精排
    #
    # Ranking formula:
    #   total = topic(×w_topic) + emotion(×w_emotion)
    #           + time(×w_time) + importance(×w_importance)
    #
    # Per-dimension scores (normalized to 0~1):
    #   topic     = rapidfuzz weighted match (name/tags/domain/body)
    #   emotion   = 1 - Euclidean distance (query v/a vs bucket v/a)
    #   time      = e^(-0.02 × days) (recent memories first)
    #   importance = importance / 10
    # ---------------------------------------------------------
    async def search(
        self,
        query: str,
        limit: int = None,
        domain_filter: list[str] = None,
        query_valence: float = None,
        query_arousal: float = None,
    ) -> list[dict]:
        """
        Multi-dimensional indexed search for memory buckets.
        多维索引搜索记忆桶。

        domain_filter: pre-filter by domain (None = search all)
        query_valence/arousal: emotion coordinates for resonance scoring
        """
        if not query or not query.strip():
            return []

        limit = limit or self.max_results
        all_buckets = await self.list_all(include_archive=False)

        if not all_buckets:
            return []

        # --- Layer 1: domain pre-filter (fast scope reduction) ---
        # --- 第一层：主题域预筛（快速缩小范围）---
        if domain_filter:
            filter_set = {d.lower() for d in domain_filter}
            candidates = [
                b for b in all_buckets
                if {d.lower() for d in b["metadata"].get("domain", [])} & filter_set
            ]
            # Fall back to full search if pre-filter yields nothing
            # 预筛为空则回退全量搜索
            if not candidates:
                candidates = all_buckets
        else:
            candidates = all_buckets

        # --- Layer 2: weighted multi-dim ranking ---
        # --- 第二层：多维加权精排 ---
        scored = []
        for bucket in candidates:
            meta = bucket.get("metadata", {})

            try:
                # precise_match_mode: 走严格 token 命中, 砍 emotion/time/importance/warmth
                # 解决"长 query + partial_ratio 失准" + "高 valence 桶被 warmth 推得无关键词也排前"
                if self.precise_match_mode:
                    pm = self._calc_precise_match(query, bucket)
                    if pm["score"] > 0:
                        # resolved 桶仍按 fuzzy 路径同样的降权处理 (× 0.3), 保持一致行为
                        s = pm["score"] * (0.3 if meta.get("resolved", False) else 1.0)
                        bucket["score"] = round(s, 2)
                        bucket["matched_in"] = pm["matched_in"]
                        bucket["field_scores"] = pm["field_scores"]
                        bucket["tokens_hit"] = pm["tokens_hit"]
                        bucket["_raw_score"] = pm["raw_score"]  # 给 dryrun_log 看原始累加分
                        scored.append(bucket)
                    continue  # 跳过原 fuzzy 路径

                # Dim 1: topic relevance (fuzzy text, 0~1) + 命中字段
                topic_match = self._calc_topic_match(query, bucket)
                topic_score = topic_match["score"]

                # Dim 2: emotion resonance (coordinate distance, 0~1)
                emotion_score = self._calc_emotion_score(
                    query_valence, query_arousal, meta
                )

                # Dim 3: time proximity (exponential decay, 0~1)
                time_score = self._calc_time_score(meta)

                # Dim 4: importance (direct normalization)
                importance_score = max(1, min(10, int(meta.get("importance", 5)))) / 10.0

                # --- Weighted sum / 加权求和 ---
                total = (
                    topic_score * self.w_topic
                    + emotion_score * self.w_emotion
                    + time_score * self.w_time
                    + importance_score * self.w_importance
                )
                # warmth_boost: 高 valence 桶加分(bonus 不进分母, 避免稀释)
                # w_warmth=0 → 零行为变化(开源默认)
                try:
                    b_valence = float(meta.get("valence", 0.5))
                except (ValueError, TypeError):
                    b_valence = 0.5
                warmth_score = max(0.0, b_valence - 0.5)  # 只奖励温暖(valence>0.5), 不惩罚冷
                total += warmth_score * self.w_warmth   # w_warmth=0 → 加 0, 无副作用
                # Normalize to 0~100 for readability
                weight_sum = self.w_topic + self.w_emotion + self.w_time + self.w_importance
                normalized = (total / weight_sum) * 100 if weight_sum > 0 else 0

                # Resolved buckets get ranking penalty (but still reachable by keyword)
                # 已解决的桶降权排序（但仍可被关键词激活）
                if meta.get("resolved", False):
                    normalized *= 0.3

                # title_hit_bonus: title 字段命中(field_score ≥ _MATCH_THRESHOLD) 给 final 加分。
                # 不进分母, 直接 += normalized。默认 0 → 无变化; 用户 runtime 调高让 title 命中桶顶上去。
                # 解决 "关键词在 title 但桶被 time/importance 拖低 → 弱命中桶反而排前" 的痛点。
                title_hit = "title" in topic_match["matched_in"]
                if title_hit and self.title_hit_bonus:
                    normalized += self.title_hit_bonus

                # 入选条件:任一字段关键词命中(matched_in 非空) OR 综合分过 fuzzy_threshold
                # 前者是为了堵"光在正文/摘要里命中,但老记忆被时间衰减拖低总分,凑不到 50 阈值"
                # —— 用户期望"含 query 的桶必出来",不该被 emotion/time/importance 打掉
                # matched_in 非空 = 至少某字段 partial_ratio >= 70(_MATCH_THRESHOLD,稳健)
                # 综合分 normalized 仍然作为排序依据,不浪费(模糊但多字段微弱命中也进)
                #
                # warmth 旁路 — 强温暖桶在 fuzzy_threshold 之下也能进
                # 目的: 让"亲密时刻"在情感泛化 query("说说你喜欢我哪一点")下不被
                # fuzzy_threshold 拦截。条件:
                #   1) w_warmth > 0 (开源默认 0 → 零行为变化)
                #   2) warmth_score >= 0.3 → b_valence >= 0.8 (真"温暖"桶, 不滥发)
                #   3) normalized >= fuzzy_threshold * 0.7 → 仍需基础信号, 不光靠 valence
                warmth_bypass = (
                    self.w_warmth > 0
                    and warmth_score >= 0.3
                    and normalized >= self.fuzzy_threshold * 0.7
                )
                has_keyword_hit = bool(topic_match["matched_in"])
                if has_keyword_hit or normalized >= self.fuzzy_threshold or warmth_bypass:
                    bucket["score"] = round(normalized, 2)
                    bucket["matched_in"] = topic_match["matched_in"]
                    bucket["field_scores"] = topic_match["field_scores"]
                    scored.append(bucket)
            except Exception as e:
                logger.warning(
                    f"Scoring failed for bucket {bucket.get('id', '?')} / "
                    f"桶评分失败: {e}"
                )
                continue

        # 默认按 score 单维排序; keyword_first_sort=True 时把 title 命中的桶整体顶到前面。
        # title bonus 不够压住的极端 case 用这条兜底(比如 bonus=20 但弱命中桶 score=90)。
        # 排序 key 直接从 matched_in 读, 不污染 bucket dict 额外字段。
        if self.keyword_first_sort:
            scored.sort(
                key=lambda x: ("title" in x.get("matched_in", []), x["score"]),
                reverse=True,
            )
        else:
            scored.sort(key=lambda x: x["score"], reverse=True)

        # 命中频次统计累积 (v1 in-memory) — 给配置页 /api/hit-stats 反向看写作命中分布
        try:
            self._total_searches += 1
            from datetime import datetime as _dt
            now_iso = _dt.utcnow().isoformat()
            q_trim = (query or "")[:80]

            # trace / hit_stats 跟 /api/search 客户端视图对齐 — 排掉 feel 桶。
            # 设计: feel 是私密沉淀, 只能走 breath domain="feel" 显式查; 不应出现在
            # "用户能看到的搜索追溯"和"命中频次"里(否则配置页会泄漏 feel 桶名)。
            # search() 内部仍返回 raw scored, 让 breath domain="feel" 那条专用路径能查 feel。
            client_scored = [
                b for b in scored
                if (b.get("metadata") or {}).get("type") != "feel"
            ]

            for b in client_scored[:limit]:
                bid = b.get("id")
                if not bid:
                    continue
                rec = self._hit_stats.get(bid)
                if rec is None:
                    rec = {"count": 0}
                    self._hit_stats[bid] = rec
                rec["count"] += 1
                rec["last_hit_iso"] = now_iso
                rec["last_query"] = q_trim

            # 最近搜索追溯 — 给"我这次发消息浮现了哪些"用; 保留 top-10 完整命中数据。
            trace_top = []
            for b in client_scored[: min(10, limit)]:
                bmeta = b.get("metadata") or {}
                m_in = b.get("matched_in", [])
                trace_top.append({
                    "id": b.get("id", "?"),
                    "name": bmeta.get("name") or b.get("id", "?"),
                    "type": bmeta.get("type", "dynamic"),
                    "score": b.get("score"),
                    "matched_in": m_in,
                    "title_hit": "title" in m_in,
                    "field_scores": b.get("field_scores", {}),
                })
            self._recent_searches.append({
                "ts": now_iso,
                "query": q_trim,
                "result_count": len(client_scored),
                "top": trace_top,
            })
        except Exception:
            # 统计失败绝不影响搜索结果
            pass

        # dryrun_log: 打印 top-10 详细 — 给用户调 title_hit_bonus 取值用, 也作"写作反馈"
        # (用户能看到哪些桶经常被命中、命中在哪个字段, 反向指导记忆 title 写作)。
        if self.dryrun_log and scored:
            top = scored[: min(10, len(scored))]
            preview = []
            for b in top:
                item = {
                    "id": b.get("id", "?"),
                    "name": (b.get("metadata") or {}).get("name", "?"),
                    "score": b.get("score"),
                    "title_hit": "title" in b.get("matched_in", []),
                    "matched_in": b.get("matched_in", []),
                    "field_scores": b.get("field_scores", {}),
                }
                # precise 模式独有: token 命中详情 + 归一化前原始分(便于反推阈值/字段权重)
                if self.precise_match_mode:
                    item["tokens_hit"] = b.get("tokens_hit", {})
                    item["raw_score"] = b.get("_raw_score")
                preview.append(item)
            logger.info(
                f"[scoring.dryrun] query={query!r} | "
                f"cfg(bonus={self.title_hit_bonus}, kw_first={self.keyword_first_sort}, "
                f"precise={self.precise_match_mode}) | "
                f"top={preview}"
            )

        return scored[:limit]

    # ---------------------------------------------------------
    # Topic relevance sub-score:
    # name(×3) + domain(×2.5) + tags(×2) + summary(×1.5) + body(×content_weight)
    # 文本相关性子分：桶名(×3) + 主题域(×2.5) + 标签(×2) + 摘要(×1.5) + 正文(×content_weight)
    # ---------------------------------------------------------
    # 命中字段判定阈值:partial_ratio >= 此值 → 该字段算"命中",写入 matched_in
    # rapidfuzz partial_ratio 是 0-100,完整子串=100。70 取一个保守阈值,避免拼音/字符级噪声
    _MATCH_THRESHOLD = 70

    def _calc_topic_match(self, query: str, bucket: dict) -> dict:
        """
        Calculate text dimension relevance + which fields actually matched.
        计算文本相关性 + 标记命中字段(给前端高亮 / 区分 keyword vs vector 用)。

        Score 公式向后兼容旧版本:name(×3) + domain(×2.5) + tags(×2) + content(×content_weight)
        进分母,跟历史一致。**summary 是 bonus 加分**:命中算分子不算分母,
        避免桶因为没 summary 字段就被无端稀释打折导致丢失旧的命中。

        Returns:
          {
            "score": float (0~1),
            "matched_in": list[str],  # subset of {"title","summary","tags","domain","content"}
            "field_scores": dict[str, int],  # raw partial_ratio per field, 0~100
          }
        """
        meta = bucket.get("metadata", {})

        # 各字段独立 partial_ratio
        name_raw = fuzz.partial_ratio(query, meta.get("name", "") or "")
        summary_raw = fuzz.partial_ratio(query, meta.get("summary", "") or "")
        domain_raw = max(
            (fuzz.partial_ratio(query, d) for d in meta.get("domain", []) if d),
            default=0,
        )
        tag_raw = max(
            (fuzz.partial_ratio(query, tag) for tag in meta.get("tags", []) if tag),
            default=0,
        )
        # 正文不再 [:1000] 截断 — 完整搜全文。fuzz.partial_ratio 是 O(N*M),
        # 对几 KB content 仍是 ms 级,真碰到几十万字的桶再说
        content_raw = fuzz.partial_ratio(query, bucket.get("content", "") or "")

        # 主分母(跟旧版一致,不含 summary):name(×3) + domain(×2.5) + tags(×2) + content(×weight)
        name_score = name_raw * 3
        domain_score = domain_raw * 2.5
        tag_score = tag_raw * 2
        content_score = content_raw * self.content_weight
        # summary 走 bonus 通道,只加分子(权重 1.5),不进分母 → 不稀释其他字段命中
        summary_bonus = summary_raw * 1.5

        weight_sum = 3 + 2.5 + 2 + self.content_weight  # 旧分母,保护已有阈值行为
        score = (name_score + domain_score + tag_score + content_score + summary_bonus) / (100 * weight_sum)
        # 上限 1.0(summary 命中拉高时可能超 1.0,但分子仍被 100*weight_sum 限制)
        if score > 1.0:
            score = 1.0

        # 字段命中判定(给前端展示"命中: 标题/摘要/正文..."用)
        matched_in = []
        if name_raw >= self._MATCH_THRESHOLD: matched_in.append("title")
        if summary_raw >= self._MATCH_THRESHOLD: matched_in.append("summary")
        if domain_raw >= self._MATCH_THRESHOLD: matched_in.append("domain")
        if tag_raw >= self._MATCH_THRESHOLD: matched_in.append("tag")
        if content_raw >= self._MATCH_THRESHOLD: matched_in.append("content")

        return {
            "score": score,
            "matched_in": matched_in,
            "field_scores": {
                "title": name_raw,
                "summary": summary_raw,
                "domain": domain_raw,
                "tag": tag_raw,
                "content": content_raw,
            },
        }

    def _calc_topic_score(self, query: str, bucket: dict) -> float:
        """
        Backward-compatible thin wrapper — returns only the score field.
        老接口,只返回 float 分数。新代码请用 _calc_topic_match() 拿到完整命中字段信息。
        """
        return self._calc_topic_match(query, bucket)["score"]

    # ---------------------------------------------------------
    # Emotion resonance sub-score:
    # Based on Russell circumplex Euclidean distance
    # 情感共鸣子分：基于环形情感模型的欧氏距离
    # No emotion in query → neutral 0.5 (doesn't affect ranking)
    # ---------------------------------------------------------
    def _calc_emotion_score(
        self, q_valence: float, q_arousal: float, meta: dict
    ) -> float:
        """
        Calculate emotion resonance score (0~1, closer = higher).
        计算情感共鸣度（0~1，越近越高）。
        """
        if q_valence is None or q_arousal is None:
            return 0.5  # No emotion coordinates → neutral / 无情感坐标时给中性分

        try:
            b_valence = float(meta.get("valence", 0.5))
            b_arousal = float(meta.get("arousal", 0.3))
        except (ValueError, TypeError):
            return 0.5

        # Euclidean distance, max sqrt(2) ≈ 1.414
        dist = math.sqrt((q_valence - b_valence) ** 2 + (q_arousal - b_arousal) ** 2)
        return max(0.0, 1.0 - dist / 1.414)

    # ---------------------------------------------------------
    # Time proximity sub-score:
    # More recent activation → higher score
    # 时间亲近子分：距上次激活越近分越高
    # ---------------------------------------------------------
    def _calc_time_score(self, meta: dict) -> float:
        """
        Calculate time proximity score (0~1, more recent = higher).
        计算时间亲近度。
        """
        last_active_str = meta.get("last_active", meta.get("created", ""))
        try:
            last_active = datetime.fromisoformat(str(last_active_str))
            days = max(0.0, (datetime.now() - last_active).total_seconds() / 86400)
        except (ValueError, TypeError):
            days = 30
        return math.exp(-0.1 * days)

    # ---------------------------------------------------------
    # List all buckets
    # 列出所有桶
    # ---------------------------------------------------------
    async def list_all(self, include_archive: bool = False) -> list[dict]:
        """
        Recursively walk directories (including domain subdirs), list all buckets.
        递归遍历目录（含域子目录），列出所有记忆桶。
        """
        buckets = []

        dirs = [self.permanent_dir, self.dynamic_dir, self.feel_dir]
        if include_archive:
            dirs.append(self.archive_dir)

        for dir_path in dirs:
            if not os.path.exists(dir_path):
                continue
            for root, _, files in os.walk(dir_path):
                for filename in files:
                    if not filename.endswith(".md"):
                        continue
                    file_path = os.path.join(root, filename)
                    bucket = self._load_bucket(file_path)
                    if bucket:
                        buckets.append(bucket)

        return buckets

    # ---------------------------------------------------------
    # Statistics (counts per category + total size)
    # 统计信息（各分类桶数量 + 总体积）
    # ---------------------------------------------------------
    async def get_stats(self) -> dict:
        """
        Return memory bucket statistics (including domain subdirs).
        返回记忆桶的统计数据。
        """
        stats = {
            "permanent_count": 0,
            "dynamic_count": 0,
            "archive_count": 0,
            "feel_count": 0,
            "total_size_kb": 0.0,
            "domains": {},
        }

        for subdir, key in [
            (self.permanent_dir, "permanent_count"),
            (self.dynamic_dir, "dynamic_count"),
            (self.archive_dir, "archive_count"),
            (self.feel_dir, "feel_count"),
        ]:
            if not os.path.exists(subdir):
                continue
            for root, _, files in os.walk(subdir):
                for f in files:
                    if f.endswith(".md"):
                        stats[key] += 1
                        fpath = os.path.join(root, f)
                        try:
                            stats["total_size_kb"] += os.path.getsize(fpath) / 1024
                        except OSError:
                            pass
                        # Per-domain counts / 每个域的桶数量
                        domain_name = os.path.basename(root)
                        if domain_name != os.path.basename(subdir):
                            stats["domains"][domain_name] = stats["domains"].get(domain_name, 0) + 1

        return stats

    # ---------------------------------------------------------
    # Archive bucket (move from permanent/dynamic into archive)
    # 归档桶（从 permanent/dynamic 移入 archive）
    # Called by decay engine to simulate "forgetting"
    # 由衰减引擎调用，模拟"遗忘"
    # ---------------------------------------------------------
    async def archive(self, bucket_id: str) -> bool:
        """
        Move a bucket into the archive directory (preserving domain subdirs).
        将指定桶移入归档目录（保留域子目录结构）。
        """
        file_path = self._find_bucket_file(bucket_id)
        if not file_path:
            return False

        try:
            # Read once, get domain info and update type / 一次性读取
            post = frontmatter.load(file_path)
            domain = post.get("domain", ["未分类"])
            primary_domain = sanitize_name(domain[0]) if domain else "未分类"
            archive_subdir = os.path.join(self.archive_dir, primary_domain)
            os.makedirs(archive_subdir, exist_ok=True)

            dest = safe_path(archive_subdir, os.path.basename(file_path))

            # Update type marker then move file / 更新类型标记后移动文件
            post["type"] = "archived"
            with open(file_path, "w", encoding="utf-8") as f:
                f.write(frontmatter.dumps(post))

            # Use shutil.move for cross-filesystem safety
            # 使用 shutil.move 保证跨文件系统安全
            shutil.move(file_path, str(dest))
        except Exception as e:
            logger.error(
                f"Failed to archive bucket / 归档桶失败: {bucket_id}: {e}"
            )
            return False

        logger.info(f"Archived bucket / 归档记忆桶: {bucket_id} → archive/{primary_domain}/")
        return True

    # ---------------------------------------------------------
    # Unarchive: move a bucket from archive/ back to dynamic/
    # 取消归档：把桶从 archive/ 移回 dynamic/
    # 用户在 dashboard 误归档/想恢复活跃时调用
    # ---------------------------------------------------------
    async def unarchive(self, bucket_id: str) -> bool:
        """Move an archived bucket back into dynamic/, clear 'archived' type marker."""
        file_path = self._find_bucket_file(bucket_id)
        if not file_path:
            return False
        # 仅处理目前在 archive 目录的桶,permanent 不动(那是钉选/保护类)
        if not os.path.normpath(file_path).startswith(os.path.normpath(self.archive_dir)):
            logger.warning(f"unarchive: 桶 {bucket_id} 不在 archive 目录,跳过")
            return False

        try:
            post = frontmatter.load(file_path)
            domain = post.get("domain", ["未分类"])
            primary_domain = sanitize_name(domain[0]) if domain else "未分类"
            dynamic_subdir = os.path.join(self.dynamic_dir, primary_domain)
            os.makedirs(dynamic_subdir, exist_ok=True)
            dest = safe_path(dynamic_subdir, os.path.basename(file_path))

            # 清掉 archived 标记,改回 dynamic
            post["type"] = "dynamic"
            with open(file_path, "w", encoding="utf-8") as f:
                f.write(frontmatter.dumps(post))

            shutil.move(file_path, str(dest))
        except Exception as e:
            logger.error(f"Failed to unarchive bucket / 取消归档失败: {bucket_id}: {e}")
            return False

        logger.info(f"Unarchived bucket / 取消归档: {bucket_id} → dynamic/{primary_domain}/")
        return True

    # ---------------------------------------------------------
    # Internal: find bucket file across all three directories
    # 内部：在三个目录中查找桶文件
    # ---------------------------------------------------------
    def _find_bucket_file(self, bucket_id: str) -> Optional[str]:
        """
        Recursively search permanent/dynamic/archive for a bucket file
        matching the given ID.
        在 permanent/dynamic/archive 中递归查找指定 ID 的桶文件。

        策略:
        1. **快路径** (filename 匹配): 文件名 == <id>.md 或 <name>_<id>.md
        2. **慢路径** (YAML id 匹配, fallback): filename 没找到时,
           扫所有 .md frontmatter, 找 metadata id == bucket_id 的孤儿文件.
           这处理历史 rename 失败 / 导入异常等造成的 filename ↔ YAML 不一致
           (现象: list_all 报告该 id 存在, 但 get() 拿不到 → 用户报 "id 能搜到但内容空").
        """
        if not bucket_id:
            return None
        dirs = [self.permanent_dir, self.dynamic_dir, self.archive_dir, self.feel_dir, self.trash_dir]
        # --- Fast path: filename match ---
        for dir_path in dirs:
            if not os.path.exists(dir_path):
                continue
            for root, _, files in os.walk(dir_path):
                for fname in files:
                    if not fname.endswith(".md"):
                        continue
                    name_part = fname[:-3]
                    if name_part == bucket_id or name_part.endswith(f"_{bucket_id}"):
                        return os.path.join(root, fname)
        # --- Slow path: YAML id fallback for orphan files ---
        # 文件名跟 YAML id 不一致的孤儿桶: 慢但能找到, 单次访问 ~50ms (200 桶级)
        for dir_path in dirs:
            if not os.path.exists(dir_path):
                continue
            for root, _, files in os.walk(dir_path):
                for fname in files:
                    if not fname.endswith(".md"):
                        continue
                    fp = os.path.join(root, fname)
                    try:
                        post = frontmatter.load(fp)
                        if post.get("id") == bucket_id:
                            logger.warning(
                                f"Orphan bucket found via YAML fallback / 通过 YAML 找到孤儿桶: "
                                f"id={bucket_id} filename={fname} (考虑 rename 文件让 filename 含 id 来根治)"
                            )
                            return fp
                    except Exception:
                        continue
        return None

    # ---------------------------------------------------------
    # Internal: load bucket data from .md file
    # 内部：从 .md 文件加载桶数据
    # ---------------------------------------------------------
    def _load_bucket(self, file_path: str) -> Optional[dict]:
        """
        Parse a Markdown file and return structured bucket data.
        解析 Markdown 文件，返回桶的结构化数据。
        """
        try:
            post = frontmatter.load(file_path)
            return {
                "id": post.get("id", Path(file_path).stem),
                "metadata": dict(post.metadata),
                "content": post.content,
                "path": file_path,
            }
        except Exception as e:
            logger.warning(
                f"Failed to load bucket file / 加载桶文件失败: {file_path}: {e}"
            )
            return None
