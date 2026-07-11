# -*- coding: utf-8 -*-
# ============================================================
# tools/weekly_checkup.py — 记忆库每周体检 (方向D 观测制度化, 2026-07-11)
#
# 干什么: 每周自动产一份体检报告 md, 让库的健康状态有代谢——
#   库画像(总量/裸ID/缺摘要/死藏品) + 注入周报(轮数/跳过分布/注0率/fan-out占比)
#   + 反馈待收割(纠错/记一笔攒了多少没转评测用例)。
# 用法:  python tools/weekly_checkup.py            # env 或 --env 指到 soren-sub/server/.env
# 输出:  Desktop\记忆库优化\体检\体检-YYYYMMDD.md
# 排程:  schtasks 每周日 21:00 JST(装载见 00-总纲); 手动跑随时可以。
# ============================================================
import argparse
import io
import json
import os
import re
import sys
import time
import urllib.request
from datetime import datetime, timedelta

if sys.stdout.encoding and sys.stdout.encoding.lower() not in ("utf-8", "utf8"):
    sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8", errors="replace")

DEFAULT_ENV = r"C:\Users\LL\Desktop\soren-sub\server\.env"
OUT_DIR = r"C:\Users\LL\Desktop\记忆库优化\体检"
INJECT_LOG = r"C:\Users\LL\Desktop\soren-sub\server\inject-log.jsonl"
FEEDBACK = r"C:\Users\LL\Desktop\soren-sub\server\inject-feedback.jsonl"


def load_env(path):
    try:
        for line in open(path, encoding="utf-8", errors="ignore"):
            line = line.strip()
            if line and not line.startswith("#") and "=" in line:
                k, v = line.split("=", 1)
                os.environ.setdefault(k.strip(), v.strip())
    except Exception:
        pass


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--env", default=DEFAULT_ENV)
    args = ap.parse_args()
    load_env(args.env)
    base = (os.environ.get("OMBRE_BRAIN_URL") or "").rstrip("/")
    tok = os.environ.get("OMBRE_ADMIN_TOKEN") or ""
    if not base:
        sys.exit("缺 OMBRE_BRAIN_URL")

    lines = [f"# 记忆库体检 {datetime.now().strftime('%Y-%m-%d')}", ""]

    # ── 库画像 ──
    try:
        req = urllib.request.Request(base + "/api/buckets", headers={"X-Admin-Token": tok})
        bs = json.loads(urllib.request.urlopen(req, timeout=120).read())
        bare = sum(1 for b in bs if re.fullmatch(r"[0-9a-f]{10,16}", b.get("name") or ""))
        nosum = sum(1 for b in bs if not (b.get("summary") or "").strip())
        shortsum = sum(1 for b in bs if 0 < len((b.get("summary") or "").strip()) <= 20)
        never = sum(1 for b in bs if (b.get("activation_count") or 0) <= 1)
        voice = sum(1 for b in bs if re.search("用户|女友|男友", (b.get("name") or "") + (b.get("summary") or "")))
        lines += ["## 库画像",
                  f"- 总桶数 {len(bs)} | 裸ID名 {bare} | 无摘要 {nosum} | 零钩子短摘要 {shortsum}",
                  f"- 激活≤1(死藏品) {never} ({never*100//max(1,len(bs))}%) | 疑似视角错乱残留 {voice}", ""]
    except Exception as e:
        lines += ["## 库画像", f"- 拉取失败: {e}", ""]

    # ── 注入周报 (inject-log 最近7天) ──
    try:
        cutoff = (datetime.utcnow() - timedelta(days=7)).isoformat()
        rounds, zero, skips, multi, injected_names = 0, 0, {}, 0, {}
        for ln in open(INJECT_LOG, encoding="utf-8", errors="ignore"):
            try:
                e = json.loads(ln)
            except Exception:
                continue
            if (e.get("ts") or "") < cutoff:
                continue
            rounds += 1
            if e.get("skipped"):
                zero += 1
                key = str(e["skipped"]).split("(")[0]
                skips[key] = skips.get(key, 0) + 1
            if e.get("multiprobe"):
                multi += 1
            for it in (e.get("injected") or []):
                n = it.get("name") or it.get("id")
                injected_names[n] = injected_names.get(n, 0) + 1
        top = sorted(injected_names.items(), key=lambda x: -x[1])[:8]
        lines += ["## 注入周报(近7天)",
                  f"- 检索轮数 {rounds} | 注0条 {zero} ({zero*100//max(1,rounds)}%) | fan-out生效轮 {multi}",
                  "- 跳过分布: " + (", ".join(f"{k}×{v}" for k, v in sorted(skips.items(), key=lambda x: -x[1])) or "无"),
                  "- 高频注入桶(复读观察): " + (", ".join(f"{n}×{c}" for n, c in top) or "无"), ""]
    except Exception as e:
        lines += ["## 注入周报", f"- 读取失败: {e}", ""]

    # ── 反馈待收割 ──
    try:
        wrong, missing = 0, 0
        for ln in open(FEEDBACK, encoding="utf-8", errors="ignore"):
            try:
                e = json.loads(ln)
            except Exception:
                continue
            if e.get("action") == "wrong-hit":
                wrong += 1
            elif e.get("action") == "missing":
                missing += 1
        lines += ["## 反馈池(累计, 收割后手动清点)",
                  f"- 纠错 wrong-hit {wrong} 条 | 记一笔 missing {missing} 条",
                  "- 收割动作: 纠错→负控/forbid 用例; missing→find_memory 追猎→正例+tags 候选", ""]
    except Exception as e:
        lines += ["## 反馈池", f"- 读取失败: {e}", ""]

    lines += ["---", "生成: tools/weekly_checkup.py (每周日 21:00 JST 自动; 手动随时)"]
    os.makedirs(OUT_DIR, exist_ok=True)
    out = os.path.join(OUT_DIR, f"体检-{datetime.now().strftime('%Y%m%d')}.md")
    open(out, "w", encoding="utf-8").write("\n".join(lines))
    print("已写", out)


if __name__ == "__main__":
    main()
