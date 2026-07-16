# -*- coding: utf-8 -*-
"""Read-only前置审计: event_time覆盖率 + 真实时间询问样本 (Temporal Understanding Shadow v0 开工门槛).

对应 notepad t-j5dg9l866s「P0 · Temporal Understanding Shadow v0」的开工前置条件:
    "开工前先审计 event_time 覆盖率与真实时间询问样本"

三个只读部分, 零写入零副作用:
  A. /api/buckets       — event_time 覆盖率(按类型/月度cohort/钉选/重要度), 粒度分布, 与created的偏差
  B. /api/search-log    — 真实检索query里时间型表达的出现频率(评测用例原料)
  C. /api/search-log    — SELF_WAKE脚手架污染query占比(t-gcplkd3x2u bug 取证量化)
"""

import argparse
import json
import os
import re
import sys
import urllib.parse
import urllib.request
from collections import Counter
from datetime import datetime


def http_json(url, token, timeout=60):
    req = urllib.request.Request(url, headers={"X-Admin-Token": token, "Accept": "application/json"})
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return json.loads(r.read().decode("utf-8"))


# --- event_time 粒度分类 ---
RE_DATETIME = re.compile(r"^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}")
RE_DATE = re.compile(r"^\d{4}-\d{2}-\d{2}$")
RE_MONTH = re.compile(r"^\d{4}-\d{2}$")


def classify_event_time(et):
    if not et:
        return "empty"
    et = str(et).strip()
    if RE_DATETIME.match(et):
        return "datetime"
    if RE_DATE.match(et):
        return "date"
    if RE_MONTH.match(et):
        return "month"
    return "other"


def parse_day(s):
    """尽力取出 YYYY-MM-DD; 取不出返回 None."""
    if not s:
        return None
    m = re.match(r"^(\d{4}-\d{2}-\d{2})", str(s).strip())
    if not m:
        return None
    try:
        return datetime.strptime(m.group(1), "%Y-%m-%d").date()
    except ValueError:
        return None


# --- 时间型询问表达 (评测用例原料筛选用, 宽口径) ---
TEMPORAL_PATTERNS = [
    (r"最开始|一开始|最初|刚认识|认识的时候|第一次", "origin/早期指涉"),
    (r"那时候|那阵子|那段时间|当时|以前|之前|过去", "模糊过去"),
    (r"最近|这几天|这周|这阵子|前几天|昨天|今天|昨晚|今晚", "近期"),
    (r"\d{1,2}月|\d{4}年|周[一二三四五六日末]|星期", "显式日期"),
    (r"上次|上回|之后|后来|从.{0,6}开始", "相对顺序"),
    (r"多久|几天|什么时候|哪天|哪一天", "时长/时点提问"),
]

# --- SELF_WAKE / 系统脚手架污染特征 (t-gcplkd3x2u) ---
SCAFFOLD_PATTERNS = [
    r"现在是\s*\d{4}-\d{2}-\d{2}",
    r"日本时间",
    r"最后一次说话是",
    r"惦记本本上记着",
    r"SELF_WAKE",
    r"心情骰",
]


def main():
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8")  # Windows GBK 控制台防乱码
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--url", default=os.environ.get("OMBRE_BRAIN_URL", ""))
    ap.add_argument("--token", default=os.environ.get("OMBRE_ADMIN_TOKEN", ""))
    ap.add_argument("--log-limit", type=int, default=1000)
    ap.add_argument("--json-out", default="", help="可选: 完整结果落盘路径")
    args = ap.parse_args()
    if not args.url or not args.token:
        print("需要 OMBRE_BRAIN_URL / OMBRE_ADMIN_TOKEN (或 --url/--token)", file=sys.stderr)
        sys.exit(2)
    base = args.url.rstrip("/")

    report = {"generated_note": "read-only audit for Temporal Understanding Shadow v0 前置条件"}

    # ============ A. event_time 覆盖率 ============
    buckets = http_json(f"{base}/api/buckets", args.token)
    total = len(buckets)
    by_type = Counter(b.get("type", "dynamic") for b in buckets)
    gran = Counter(classify_event_time(b.get("event_time")) for b in buckets)
    covered = total - gran.get("empty", 0)

    def cohort(b):
        d = parse_day(b.get("created"))
        return d.strftime("%Y-%m") if d else "unknown"

    cohort_total = Counter(cohort(b) for b in buckets)
    cohort_cov = Counter(cohort(b) for b in buckets if classify_event_time(b.get("event_time")) != "empty")

    pinned = [b for b in buckets if b.get("pinned")]
    pinned_cov = sum(1 for b in pinned if classify_event_time(b.get("event_time")) != "empty")
    imp8 = [b for b in buckets if (b.get("importance") or 0) >= 8]
    imp8_cov = sum(1 for b in imp8 if classify_event_time(b.get("event_time")) != "empty")

    # event_time 与 created 的日差 (回答: created 能否当低置信 fallback)
    delta = Counter()
    for b in buckets:
        et, cd = parse_day(b.get("event_time")), parse_day(b.get("created"))
        if not et or not cd:
            continue
        d = abs((et - cd).days)
        delta["same_day" if d == 0 else "1d" if d == 1 else "2-7d" if d <= 7 else ">7d"] += 1

    report["A_event_time_coverage"] = {
        "total": total,
        "by_type": dict(by_type),
        "covered": covered,
        "coverage_pct": round(covered * 100.0 / total, 1) if total else 0,
        "granularity": dict(gran),
        "cohort_total": dict(sorted(cohort_total.items())),
        "cohort_covered": dict(sorted(cohort_cov.items())),
        "pinned": {"total": len(pinned), "covered": pinned_cov},
        "importance_ge8": {"total": len(imp8), "covered": imp8_cov},
        "event_time_vs_created_days": dict(delta),
    }

    # ============ B + C. search-log 扫描 ============
    log = http_json(f"{base}/api/search-log?limit={args.log_limit}", args.token)
    items = log.get("items") or []
    queries = [(it.get("query") or "", it.get("caller") or "") for it in items]
    n_q = len(queries)

    temporal_hits = Counter()
    temporal_samples = {}
    for q, _ in queries:
        for pat, label in TEMPORAL_PATTERNS:
            if re.search(pat, q):
                temporal_hits[label] += 1
                temporal_samples.setdefault(label, []).append(q[:80])
    any_temporal = sum(
        1 for q, _ in queries if any(re.search(p, q) for p, _l in TEMPORAL_PATTERNS)
    )

    scaffold = [q for q, _ in queries if any(re.search(p, q) for p in SCAFFOLD_PATTERNS)]
    caller_of_scaffold = Counter(c for q, c in queries if any(re.search(p, q) for p in SCAFFOLD_PATTERNS))

    report["B_temporal_query_sample"] = {
        "log_size": n_q,
        "queries_with_temporal_expr": any_temporal,
        "pct": round(any_temporal * 100.0 / n_q, 1) if n_q else 0,
        "by_label": dict(temporal_hits),
        "samples": {k: v[:5] for k, v in temporal_samples.items()},
    }
    report["C_scaffold_pollution"] = {
        "log_size": n_q,
        "polluted_queries": len(scaffold),
        "pct": round(len(scaffold) * 100.0 / n_q, 1) if n_q else 0,
        "by_caller": dict(caller_of_scaffold),
        "samples": [s[:120] for s in scaffold[:5]],
    }

    # ============ D. Temporal Shadow 观测 (部署后才有数据) ============
    # shadow 落在 search_log 每条的 temporal_shadow 字段(temporal_shadow.py, 只留痕不干预)。
    # 这里统计: 覆盖率 + 粒度/label 分布 + 每档样本 —— 开阀决策(过滤/加权)的数据地基。
    shadowed = [it for it in items if it.get("temporal_shadow")]
    gran_dist = Counter(it["temporal_shadow"].get("granularity") for it in shadowed)
    label_dist = Counter(it["temporal_shadow"].get("label") for it in shadowed)
    shadow_samples = {}
    for it in shadowed:
        g = it["temporal_shadow"].get("granularity")
        shadow_samples.setdefault(g, []).append({
            "query": (it.get("query") or "")[:60],
            "hint": it["temporal_shadow"],
        })
    report["D_temporal_shadow"] = {
        "log_size": n_q,
        "shadowed": len(shadowed),
        "pct": round(len(shadowed) * 100.0 / n_q, 1) if n_q else 0,
        "granularity": dict(gran_dist),
        "label": dict(label_dist),
        "samples": {k: v[:3] for k, v in shadow_samples.items()},
    }

    # ============ 输出 ============
    a = report["A_event_time_coverage"]
    print("=== A. event_time 覆盖率 ===")
    print(f"  桶总数 {a['total']} (type: {a['by_type']})")
    print(f"  有 event_time: {a['covered']} ({a['coverage_pct']}%)  粒度: {a['granularity']}")
    print(f"  月度cohort 总数/覆盖: ")
    for m in sorted(a["cohort_total"]):
        print(f"    {m}: {a['cohort_covered'].get(m, 0)}/{a['cohort_total'][m]}")
    print(f"  钉选(protected∪highlight): {a['pinned']['covered']}/{a['pinned']['total']}")
    print(f"  importance>=8: {a['importance_ge8']['covered']}/{a['importance_ge8']['total']}")
    print(f"  event_time与created日差: {a['event_time_vs_created_days']}")
    b = report["B_temporal_query_sample"]
    print("=== B. 真实时间询问样本 ===")
    print(f"  近{b['log_size']}条检索里含时间表达: {b['queries_with_temporal_expr']} ({b['pct']}%)")
    for k, v in b["by_label"].items():
        print(f"    {k}: {v}")
    c = report["C_scaffold_pollution"]
    print("=== C. SELF_WAKE脚手架污染 (t-gcplkd3x2u取证) ===")
    print(f"  污染query: {c['polluted_queries']}/{c['log_size']} ({c['pct']}%)  caller分布: {c['by_caller']}")
    d = report["D_temporal_shadow"]
    print("=== D. Temporal Shadow 观测 ===")
    if d["shadowed"]:
        print(f"  带shadow标注: {d['shadowed']}/{d['log_size']} ({d['pct']}%)")
        print(f"  粒度: {d['granularity']}  label: {d['label']}")
    else:
        print("  (日志里暂无 temporal_shadow 字段 — shadow 尚未部署或刚上线没攒到流量)")

    if args.json_out:
        with open(args.json_out, "w", encoding="utf-8") as f:
            json.dump(report, f, ensure_ascii=False, indent=2)
        print(f"[saved] {args.json_out}")


if __name__ == "__main__":
    main()
