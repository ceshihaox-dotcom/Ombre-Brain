# -*- coding: utf-8 -*-
# ============================================================
# tools/eval_fusion.py — 双通道融合 A/B 评测台 (2026-07-12)
#
# 干什么: 评测台此前不模拟生产的 fuseChannels 融合(kw+vec 直接串接), 导致换说法
# 案例 eval❌ 生产✓ 的口径失真。这里 1:1 移植生产融合公式, 并 A/B 网友思路的
# dynamic-α(向量置信度动态权重 = confAbs × confMargin):
#   A = prod-static: 意图分类静态权重(回顾×1.4语义 / 事实×1.3关键词) + 孤证降权0.85
#   B = dynamic-α:   α=confAbs×confMargin ∈[0,1]; wVec=0.6+0.8α, wKw=1.4-0.8α
#   (B 替换意图静态权重; 其余融合/精排/池构建两组完全一致)
# 口径: idf=true + limit30 + 精排池 top15+钩子实证补到20 (对齐生产 2026-07-11 后形态)
#
# 用法: python tools/eval_fusion.py [--save]
# env: OMBRE_BRAIN_URL / OMBRE_ADMIN_TOKEN / SILICONFLOW_API_KEY
# ============================================================
import argparse
import io
import json
import os
import re
import sys
import time
import urllib.parse
import urllib.request

if sys.stdout.encoding and sys.stdout.encoding.lower() not in ("utf-8", "utf8"):
    sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8", errors="replace")

NEG_LEAK_SCORE = 70
STRONG_FIELDS = ("title", "tag", "summary")
RECALL_RE = re.compile(r"记得|还记|想起|那次|那天|那时候|之前|以前|上次|当时|后来|回忆")
FACT_RE = re.compile(r"什么时候|几点|哪天|哪一天|多少|几个|几次|第几|日期|地址|叫什么|名字是|[0-9]{1,4}\s*(年|月|日|号)")


def http(req, t=90):
    with urllib.request.urlopen(req, timeout=t) as r:
        return json.loads(r.read().decode("utf-8"))


def search(base, token, q):
    params = urllib.parse.urlencode({
        "q": q, "limit": 30, "include_vector": "true", "exclude_pinned": "true",
        "simulate": "true", "caller": "eval-fusion", "idf": "true",
    })
    req = urllib.request.Request(f"{base}/api/search?{params}",
                                 headers={"X-Admin-Token": token, "Accept": "application/json"})
    return http(req, 60)


def field_evidence(h):
    return any(f in (h.get("matched_in") or []) for f in STRONG_FIELDS)


def fuse(kw_hits, vec_hits, mode):
    """1:1 移植生产 fuseChannels + 意图权重(A) / dynamic-α(B)。"""
    vec_hits = vec_hits or []
    kw_hits = kw_hits or []
    vector_ran = len(vec_hits) > 0
    if mode == "static":
        # classifyIntent — 但 query 在外层传进来, 这里由调用方给权重
        raise RuntimeError("use fuse_with_weights")
    return None


def fuse_with_weights(kw_hits, vec_hits, w_kw, w_vec):
    by_id = {}
    for h in (kw_hits or []):
        if h.get("id") not in by_id:
            by_id[h["id"]] = {**h, "_kw": h.get("score") or 0, "_vec": 0, "_ch": "kw"}
    for h in (vec_hits or []):
        vs = round((h.get("similarity") or 0) * 100)
        ex = by_id.get(h.get("id"))
        if ex:
            ex["_vec"] = vs
            ex["_ch"] = "kw+vec"
        else:
            by_id[h["id"]] = {**h, "score": vs, "_kw": 0, "_vec": vs, "_ch": "vec"}
    vector_ran = len(vec_hits or []) > 0
    fused = []
    for h in by_id.values():
        s = min(100, round((h["_kw"] * w_kw + h["_vec"] * w_vec) / max(w_kw, w_vec)))
        if vector_ran and h["_ch"] == "kw" and not field_evidence(h):
            s = round(s * 0.85)  # 孤证降权(生产同款)
        fused.append({**h, "score": s})
    fused.sort(key=lambda x: -(x.get("score") or 0))
    return fused


def fuse_normalized(kw_hits, vec_hits, w_kw, w_vec):
    """GenAgents式 per-query min-max 归一化融合(罗智实测 Recall@1 3.5×的那味药):
    每个通道的分数先在本查询内归一到[0,1], 再加权 — 治 kw(0-100粗粒) vs vec(挤在0.5-0.65)分布错配。"""
    def norm_map(pairs):  # [(id, raw)] -> {id: [0,1]}
        vals = [v for _, v in pairs]
        if not vals:
            return {}
        lo, hi = min(vals), max(vals)
        if hi <= lo:
            return {k: 1.0 for k, _ in pairs}
        return {k: (v - lo) / (hi - lo) for k, v in pairs}
    kn = norm_map([(h["id"], h.get("score") or 0) for h in (kw_hits or [])])
    vn = norm_map([(h["id"], h.get("similarity") or 0) for h in (vec_hits or [])])
    by_id = {}
    for h in (kw_hits or []):
        by_id.setdefault(h["id"], {**h, "_ch": "kw"})
    for h in (vec_hits or []):
        if h["id"] in by_id:
            by_id[h["id"]]["_ch"] = "kw+vec"
        else:
            by_id.setdefault(h["id"], {**h, "_ch": "vec"})
    vector_ran = len(vec_hits or []) > 0
    fused = []
    for hid, h in by_id.items():
        s = (kn.get(hid, 0.0) * w_kw + vn.get(hid, 0.0) * w_vec) / (w_kw + w_vec)
        if vector_ran and h["_ch"] == "kw" and not field_evidence(h):
            s *= 0.85
        fused.append({**h, "score": round(s * 100, 1)})
    fused.sort(key=lambda x: -(x.get("score") or 0))
    return fused


def weights_static(query):
    if RECALL_RE.search(query):
        return 1.0, 1.4
    if FACT_RE.search(query):
        return 1.3, 0.7
    return 1.0, 1.0


def weights_dynamic(vec_hits):
    """网友思路: α = confAbs × confMargin。confAbs=top1相似度; confMargin=(top1-top2)/top1。"""
    vs = sorted([h.get("similarity") or 0 for h in (vec_hits or [])], reverse=True)
    if not vs or vs[0] <= 0:
        return 1.4, 0.6  # 向量没开腔 → 信关键词
    conf_abs = min(1.0, vs[0] / 0.7)          # 0.7+ 相似度视为满自信(库内实测天花板~0.65)
    conf_margin = 1.0 if len(vs) < 2 else max(0.0, (vs[0] - vs[1]) / vs[0])
    alpha = conf_abs * min(1.0, conf_margin * 3)  # margin 通常很小, ×3 拉伸到可用区间
    return 1.4 - 0.8 * alpha, 0.6 + 0.8 * alpha


def rerank(query, hits, key, model, base_url):
    docs = [f"{h.get('name','')}: {h.get('summary') or h.get('content_preview') or ''}"[:300] for h in hits]
    body = json.dumps({"model": model, "query": query, "documents": docs}).encode()
    req = urllib.request.Request(base_url.rstrip("/") + "/rerank", data=body,
                                 headers={"Authorization": "Bearer " + key, "Content-Type": "application/json"})
    try:
        data = http(req, 40)
        return [hits[it["index"]] for it in (data.get("results") or []) if it["index"] < len(hits)]
    except Exception:
        return None


def build_pool(fused):
    pool = fused[:15]
    ids = {h["id"] for h in pool}
    for h in fused[15:40]:
        if len(pool) >= 20:
            break
        if field_evidence(h) and h["id"] not in ids:
            pool.append(h)
            ids.add(h["id"])
    return pool


def match(h, x):
    return h.get("id") == x[3:] if x.startswith("id:") else (x in (h.get("name") or ""))


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--save", action="store_true")
    args = ap.parse_args()
    base = os.environ["OMBRE_BRAIN_URL"].rstrip("/")
    token = os.environ["OMBRE_ADMIN_TOKEN"]
    sf_key = os.environ.get("SILICONFLOW_API_KEY", "")
    sf_model = os.environ.get("OMBRE_RERANK_MODEL", "Qwen/Qwen3-Reranker-8B")
    sf_base = os.environ.get("OMBRE_RERANK_BASE_URL", "https://api.siliconflow.com/v1")

    with open(os.path.join(os.path.dirname(__file__), "eval_set.json"), encoding="utf-8") as f:
        eval_set = [e for e in json.load(f) if isinstance(e, dict) and e.get("query") and not e["query"].startswith("_")]
    positives = [e for e in eval_set if not e.get("negative") and not e.get("forbid")]
    negatives = [e for e in eval_set if e.get("negative") or e.get("forbid")]

    variants = ("static", "norm")
    stats = {v: {"rr": 0.0, "hit3": 0, "frr": 0.0, "fhit3": 0} for v in variants}
    print(f"正例 {len(positives)} 条 (融合序rank→精排后rank; idf+limit30+生产池口径):")
    for e in positives:
        q, expect = e["query"], e.get("expect") or []
        d = search(base, token, q)
        kw, vec = d.get("keyword_hits") or [], d.get("vector_hits") or []
        wk, wv = weights_static(q)
        row = {}
        for name in variants:
            fused = fuse_with_weights(kw, vec, wk, wv) if name == "static" else fuse_normalized(kw, vec, wk, wv)
            frank = next((i for i, h in enumerate(fused, 1) if any(match(h, x) for x in expect)), 0)
            stats[name]["frr"] += (1.0 / frank) if frank else 0.0
            if frank and frank <= 3:
                stats[name]["fhit3"] += 1
            pool = build_pool(fused)
            ranked = rerank(q, pool, sf_key, sf_model, sf_base) or pool
            rank = next((i for i, h in enumerate(ranked, 1) if any(match(h, x) for x in expect)), 0)
            stats[name]["rr"] += (1.0 / rank) if rank else 0.0
            if rank and rank <= 3:
                stats[name]["hit3"] += 1
            row[name] = f"{frank or '-'}→{rank or '-'}"
        print(f"  static={row['static']:>7} norm={row['norm']:>7} 「{q[:28]}」")

    leaks = {v: 0 for v in variants}
    for e in negatives:
        q, banned = e["query"], e.get("forbid")
        d = search(base, token, q)
        kw, vec = d.get("keyword_hits") or [], d.get("vector_hits") or []
        wk, wv = weights_static(q)
        for name in variants:
            fused = fuse_with_weights(kw, vec, wk, wv) if name == "static" else fuse_normalized(kw, vec, wk, wv)
            # A/B口径: 禁抓桶进top-3即算泄漏(名次制, 分数分布跨变体不可比)
            bad = [h for h in fused[:3] if (not banned or any(x in (h.get("name") or "") for x in banned))] if banned else \
                  [h for h in fused[:3] if (h.get("score") or 0) > 0]
            if banned and bad:
                leaks[name] += 1
            elif not banned and len(bad) >= 3:
                leaks[name] += 1

    n = max(1, len(positives))
    print("=" * 60)
    for name, label in (("static", "static(生产)"), ("norm", "per-query归一化")):
        s = stats[name]
        print(f"{label}: 融合序MRR={s['frr']/n:.4f} fhit@3={s['fhit3']}/{n} | 终MRR={s['rr']/n:.4f} hit@3={s['hit3']}/{n} | 泄漏轮={leaks[name]}/{len(negatives)}")
    if args.save:
        out = os.path.join(os.path.dirname(__file__), f"eval_fusion_{time.strftime('%Y%m%d_%H%M%S')}.json")
        json.dump({"stats": stats, "leaks": leaks}, open(out, "w", encoding="utf-8"), ensure_ascii=False, indent=1)
        print("已存", out)


if __name__ == "__main__":
    main()
