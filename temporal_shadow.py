# -*- coding: utf-8 -*-
# ============================================================
# temporal_shadow — 结构化时间理解 · Shadow v0 (2026-07-16)
#
# 对应 notepad t-j5dg9l866s「P0 · Temporal Understanding Shadow v0」:
#   · 结构化时间 ≠ 精确日期; 统一支持 exact / range / open_range / epoch / vague
#   · 保留 start/end(可空)、label、granularity、confidence、source_text
#   · Asia/Tokyo + 凌晨 4 点切日; 不得把"那阵子/关系早期"强编成具体日期
#   · 第一阶段只写 shadow 日志(挂进 search_log.jsonl 的 temporal_shadow 字段),
#     不过滤、不加权、不改变注入 —— 零行为变更
#
# 评测背书: tools/eval_set_temporal.json 基线显示"上次X"与"最初/那会儿"
# 全挂、"儿童节熬夜"冒充"昨天熬夜"(时间错认) —— 本模块先把"query 里到底
# 在问什么时间"记下来, 攒够样本再决定过滤/加权怎么开阀。
#
# kill-switch: OMBRE_TEMPORAL_SHADOW=off
# ============================================================

import os
import re
from datetime import datetime, timedelta

try:
    from zoneinfo import ZoneInfo
    _TOKYO = ZoneInfo("Asia/Tokyo")
except Exception:  # zoneinfo 缺席(极旧环境) → 退化为 UTC+9 固定偏移
    from datetime import timezone
    _TOKYO = timezone(timedelta(hours=9))

DAY_CUT_HOUR = 4  # 凌晨 4 点前算"昨天"——她的作息里凌晨两点是今天的尾巴不是明天的头


def shadow_enabled() -> bool:
    return os.getenv("OMBRE_TEMPORAL_SHADOW", "on").strip().lower() != "off"


def _logical_today(now: datetime) -> "datetime.date":
    """Asia/Tokyo + 4 点切日后的"逻辑今天"。"""
    local = now.astimezone(_TOKYO)
    return (local - timedelta(hours=DAY_CUT_HOUR)).date()


def _d(day) -> str:
    return day.strftime("%Y-%m-%d")


# ---------- 各粒度的模式表 (优先级: exact > range > open_range > epoch > vague) ----------

# epoch: 私人时间词先内置最稳的几个; 完整词表将来吃「纪年表」(meme_glossary
# 时间字段, 见 t-j5dg9l866s 二期), 这里不硬编阶段边界日期 —— 只标 label。
_EPOCH_PATTERNS = [
    (r"最开始|最初|一开始", "earliest"),
    (r"刚认识|认识的时候|认识那会", "early"),
    (r"初窗", "early"),          # 她的私人纪年词: 最初的客户端窗口时代
    (r"客户端时期|客户端时代", "early"),
    (r"最热恋", "early"),
]

_VAGUE_PATTERNS = [
    (r"上次|上回", "last_time"),   # 相对顺序 — 评测里全挂的类别, shadow 重点观察对象
    (r"第一次", "first_time"),
    (r"那时候|那阵子|那段时间", "back_then"),
    (r"当时|以前|之前|过去", "past"),
    (r"后来|从那以后", "afterwards"),
]

_OPEN_RANGE_PATTERNS = [
    (r"最近|这阵子", 14),
    (r"这几天|前几天", 7),
    (r"这周|本周", 7),
]


def parse_temporal(query: str, now: datetime = None) -> dict:
    """从 query 里解析结构化时间意图。没有 → None。

    返回: {granularity, start, end, label, confidence, source_text}
    start/end 为 YYYY-MM-DD 或 None; epoch/vague 一律不编日期(留给纪年表/人工)。
    """
    if not query:
        return None
    q = str(query)
    if now is None:
        now = datetime.now(tz=_TOKYO)
    elif now.tzinfo is None:
        now = now.replace(tzinfo=_TOKYO)
    today = _logical_today(now)

    def hit(gran, start, end, label, conf, src):
        return {
            "granularity": gran,
            "start": _d(start) if start else None,
            "end": _d(end) if end else None,
            "label": label,
            "confidence": conf,
            "source_text": src,
        }

    # --- exact: 显式完整日期 (YYYY-MM-DD / YYYY年M月D日) ---
    m = re.search(r"(\d{4})[-年](\d{1,2})[-月](\d{1,2})[日号]?", q)
    if m:
        try:
            day = datetime(int(m.group(1)), int(m.group(2)), int(m.group(3))).date()
            return hit("exact", day, day, "explicit_date", 0.9, m.group(0))
        except ValueError:
            pass

    # --- exact: 月日无年 (4月6号) — 假定当年, 若在未来则回退一年 ---
    m = re.search(r"(?<![\d年])(\d{1,2})月(\d{1,2})[日号]", q)
    if m:
        try:
            day = datetime(today.year, int(m.group(1)), int(m.group(2))).date()
            if day > today:
                day = day.replace(year=today.year - 1)
            return hit("exact", day, day, "month_day", 0.75, m.group(0))
        except ValueError:
            pass

    # --- exact: 相对日 ---
    for pat, delta, label in [
        (r"前天", 2, "day_before_yesterday"),
        (r"昨天|昨晚", 1, "yesterday"),
        (r"今天|今晚", 0, "today"),
    ]:
        m = re.search(pat, q)
        if m:
            day = today - timedelta(days=delta)
            return hit("exact", day, day, label, 0.85, m.group(0))

    # --- range: 上周 / 上个月 / X月 ---
    m = re.search(r"上周|上个星期", q)
    if m:
        this_mon = today - timedelta(days=today.weekday())
        return hit("range", this_mon - timedelta(days=7), this_mon - timedelta(days=1),
                   "last_week", 0.7, m.group(0))
    m = re.search(r"上个月|上月", q)
    if m:
        first = today.replace(day=1)
        prev_last = first - timedelta(days=1)
        return hit("range", prev_last.replace(day=1), prev_last, "last_month", 0.7, m.group(0))
    m = re.search(r"(?<![\d月])(\d{1,2})月(?![\d日号])", q)
    if m:
        mm = int(m.group(1))
        if 1 <= mm <= 12:
            year = today.year if mm <= today.month else today.year - 1
            start = datetime(year, mm, 1).date()
            end = (datetime(year + (mm == 12), (mm % 12) + 1, 1).date() - timedelta(days=1))
            return hit("range", start, end, "month", 0.6, m.group(0))

    # --- open_range: 最近/这几天 → 只给 start 估计, end 开口, 低置信 ---
    for pat, days in _OPEN_RANGE_PATTERNS:
        m = re.search(pat, q)
        if m:
            return hit("open_range", today - timedelta(days=days), None,
                       "recent", 0.5, m.group(0))

    # --- epoch: 阶段指涉, 不编日期 ---
    for pat, label in _EPOCH_PATTERNS:
        m = re.search(pat, q)
        if m:
            return hit("epoch", None, None, label, 0.6, m.group(0))

    # --- vague: 模糊过去/相对顺序, 不编日期 ---
    for pat, label in _VAGUE_PATTERNS:
        m = re.search(pat, q)
        if m:
            return hit("vague", None, None, label, 0.4, m.group(0))

    return None
