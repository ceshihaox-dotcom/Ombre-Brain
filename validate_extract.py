#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
开源前验证 harness — DeepSeek 抽取质量。三种用法:

1) 内置短样本(快速 smoke):
     py validate_extract.py
2) 真实大 JSON — 测「原文 source_excerpt」忠实度(逐字/长度/省略号):
     py validate_extract.py 路径\\聊天.json [块数=3]
3) 真实大 JSON — 「你的 prompt vs 上游 prompt」并排(测 漏/零散/粒度):
     py validate_extract.py 路径\\聊天.json [块数=3] compare

用 OB 真实 detect_and_parse + chunk_turns(~10k token/块), 抽样几块跑(负载真实, 省钱)。无缓存。
⚠ 真实模式跑的是你私人聊天 → 本机看输出。
key: PowerShell  $env:OMBRE_API_KEY='sk-xxx'; py validate_extract.py ...
"""
import asyncio
import os
import re
import subprocess
import sys

from utils import load_config
from import_memory import (
    IMPORT_EXTRACT_PROMPT,
    IMPORT_EXTRACT_PROMPT_LONG,
    ImportEngine,
    detect_and_parse,
    chunk_turns,
)

MIN_EXCERPT_CHARS = 100
TINY_ITEM_CHARS = 50  # 单条 content < 这个字数视为"碎片"(digest 规则要求 ≥50)

SAMPLES = [
    {"name": "小·日程", "text": "我：帮我记一下，下周三下午三点去市中心口腔诊所看牙。\nAI：好，下周三 15:00 看牙，要提前一天提醒你吗？\n我：要，顺便提醒别喝咖啡。"},
    {"name": "大·多主题", "text": (
        "我：跟你梳理下最近。数据迁移项目熬两个通宵终于上线，当天出了个权限 bug 半小时修好。"
        "室友这周搬走了，房子空一半，有点不适应但清净。我还开始跑步了，每天五公里坚持四天了。\n"
        "AI：一次发生好多事。上线顶住线上 bug 不容易；室友搬走的失落很正常；跑步注意别太猛伤膝盖。\n"
        "我：膝盖确实酸。最近在追《漫长的季节》，强烈推荐。下周可能出差上海三天还没订酒店。\n"
        "AI：膝盖酸就降到三公里。要我帮你列个上海三天清单吗？")},
]


def _norm(s):
    return re.sub(r"\s+", "", s or "")


def verbatim_coverage(excerpt, source, k=12):
    """重叠 k-gram 命中率: 拼接接缝只罚 ~k 个窗口, 真改写才大片丢。"""
    ne, ns = _norm(excerpt), _norm(source)
    if not ne:
        return 0.0
    if len(ne) <= k:
        return 1.0 if ne in ns else 0.0
    grams = {ns[i:i + k] for i in range(len(ns) - k + 1)}
    total = len(ne) - k + 1
    return sum(1 for i in range(total) if ne[i:i + k] in grams) / total


def get_upstream_import_prompt():
    """从 git 拉上游 import_memory.py 的 IMPORT_EXTRACT_PROMPT(对比用)。"""
    try:
        out = subprocess.run(
            ["git", "show", "upstream/main:import_memory.py"],
            capture_output=True, text=True, encoding="utf-8",
        ).stdout
    except Exception as e:
        print(f"✗ 拉上游失败: {e}"); return None
    m = re.search(r'IMPORT_EXTRACT_PROMPT\s*=\s*"""(.*?)"""', out, re.DOTALL)
    return m.group(1) if m else None


async def extract(client, model, text, prompt):
    resp = await client.chat.completions.create(
        model=model,
        messages=[
            {"role": "system", "content": prompt},
            {"role": "user", "content": text[:12000]},
        ],
        max_tokens=16384,
        temperature=0.0,
    )
    raw = resp.choices[0].message.content or ""
    return ImportEngine._parse_extraction(raw), raw


# ── 模式2: source_excerpt 忠实度 ──
def report_items(items, source_text, acc):
    for i, it in enumerate(items, 1):
        name = it.get("name", "(无 name)")
        exc = it.get("source_excerpt") or ""
        elen = len(exc)
        cov = verbatim_coverage(exc, source_text)
        has_ell = (("..." in exc) or ("…" in exc)) and not (("..." in source_text) or ("…" in source_text))
        faithful = cov >= 0.9
        longenough = elen >= MIN_EXCERPT_CHARS or elen >= len(source_text) - 10
        acc[0] += 1; acc[1] += faithful; acc[2] += longenough; acc[3] += has_ell
        flags = ["逐字✓" if faithful else f"改写✗({cov:.0%})", "长度✓" if longenough else f"欠抄✗({elen})"]
        if has_ell:
            flags.append("省略号✗")
        print(f"  [{i}] {name}  | 原文{elen}字 | " + "  ".join(flags))
        if not faithful and exc:
            print(f"      excerpt: {exc[:500].replace(chr(10), ' / ')}")
            print("      ↑你读: 这是当时的原话(逐字)吗? 还是被 DeepSeek 重新措辞了?")


# ── 模式3: 并排粒度对比 ──
def print_side(label, items):
    n = len(items)
    sizes = [len((it.get("content") or "")) for it in items]
    tiny = sum(1 for s in sizes if s < TINY_ITEM_CHARS)
    avg = round(sum(sizes) / n) if n else 0
    print(f"  【{label}】 {n} 条 | 平均 {avg} 字 | 碎片(<{TINY_ITEM_CHARS}字) {tiny} 条")
    for it in items:
        c = (it.get("content") or "").replace("\n", " ")
        print(f"      · {it.get('name', '(无名)')} ({len(c)}字): {c[:54]}")
    return n, avg, tiny


async def main():
    config = load_config()
    dehy = config.get("dehydration", {})
    api_key = dehy.get("api_key", "") or os.environ.get("OMBRE_API_KEY", "") or os.environ.get("DEEPSEEK_API_KEY", "")
    base_url = dehy.get("base_url", "https://api.deepseek.com/v1")
    model = dehy.get("model", "deepseek-chat")
    if not api_key:
        print("✗ 没找到 key。 PowerShell:  $env:OMBRE_API_KEY='sk-xxx'; py validate_extract.py ...")
        return
    from openai import AsyncOpenAI
    client = AsyncOpenAI(api_key=api_key, base_url=base_url)

    args = sys.argv[1:]
    file_path = args[0] if args else None
    n_sample = int(args[1]) if len(args) > 1 and args[1].isdigit() else 3
    mode = "compare" if "compare" in args else "excerpt"

    if not file_path:
        # 内置短样本(excerpt)
        acc = [0, 0, 0, 0]
        print(f"模型={model}  内置样本={len(SAMPLES)}\n" + "=" * 72)
        for s in SAMPLES:
            try:
                items, _ = await extract(client, model, s["text"], IMPORT_EXTRACT_PROMPT_LONG)
            except Exception as e:
                print(f"\n## {s['name']}  ✗ {e}"); continue
            print(f"\n## {s['name']}  → {len(items)} 条")
            report_items(items, s["text"], acc)
        n = acc[0]
        if n:
            print(f"\n总计 {n} | 逐字 {acc[1]}/{n}({acc[1]/n:.0%}) 长度 {acc[2]}/{n}({acc[2]/n:.0%}) 省略号 {acc[3]}")
        return

    # ── 真实文件 ──
    try:
        with open(file_path, "r", encoding="utf-8") as f:
            raw_content = f.read()
    except Exception as e:
        print(f"✗ 读文件失败: {e}"); return
    turns = detect_and_parse(raw_content, file_path)
    chunks = chunk_turns(turns)
    print(f"模型={model}  文件={os.path.basename(file_path)} ({len(raw_content)//1024}KB)")
    print(f"解析: {len(turns)} 轮 → {len(chunks)} 块(~10k token/块)  模式={mode}")
    if len(turns) <= 1 or not chunks:
        print("⚠ 解析异常(≤1 轮/0 块)。把 JSON 结构发我, 我加解析分支。"); return
    idxs = sorted(set(round(i * (len(chunks) - 1) / max(1, n_sample - 1)) for i in range(n_sample)))[:n_sample] if len(chunks) > 1 else [0]
    print(f"抽样: 第 {[i + 1 for i in idxs]} 块\n" + "=" * 72)

    if mode == "compare":
        up_prompt = get_upstream_import_prompt()
        if not up_prompt:
            print("✗ 没拉到上游 prompt, 无法对比。"); return
        tot = {"你的": [0, 0, 0], "上游": [0, 0, 0]}  # [总条, 总碎片, 块数]
        for ci in idxs:
            content = chunks[ci]["content"]
            print(f"\n## 第 {ci + 1}/{len(chunks)} 块 ({len(content)}字, {chunks[ci].get('turn_count','?')}轮)")
            for label, prompt in (("你的", IMPORT_EXTRACT_PROMPT), ("上游", up_prompt)):
                try:
                    items, _ = await extract(client, model, content, prompt)
                except Exception as e:
                    print(f"  【{label}】✗ {e}"); continue
                n, _avg, tiny = print_side(label, items)
                tot[label][0] += n; tot[label][1] += tiny; tot[label][2] += 1
        print("\n" + "=" * 72)
        for label in ("你的", "上游"):
            t = tot[label]
            blk = max(1, t[2])
            print(f"{label}: 共 {t[0]} 条 (平均每块 {t[0]/blk:.1f} 条) | 碎片 {t[1]} 条")
        print("→ 上游条数明显多、碎片多 = 它过度切碎(你和朋友体感的'零碎'); 你的更整 = 开源该发你的。")
        print("  漏没漏 / 该不该合 → 你读上面每条 name+内容人工判(你最清楚那段该记什么)。")
    else:
        acc = [0, 0, 0, 0]
        for ci in idxs:
            content = chunks[ci]["content"]
            print(f"\n## 第 {ci + 1}/{len(chunks)} 块 ({len(content)}字, {chunks[ci].get('turn_count','?')}轮)")
            try:
                items, raw = await extract(client, model, content, IMPORT_EXTRACT_PROMPT_LONG)
            except Exception as e:
                print(f"   ✗ {e}"); continue
            print(f"   → {len(items)} 条")
            if items:
                report_items(items, content, acc)
            else:
                print(f"   ⚠ 空/解析失败: {raw[:160]}")
        n = acc[0]
        if n:
            print(f"\n总计 {n} 条原文 | 逐字 {acc[1]}/{n}({acc[1]/n:.0%}) | 长度 {acc[2]}/{n}({acc[2]/n:.0%}) | 省略号 {acc[3]}")


if __name__ == "__main__":
    asyncio.run(main())
