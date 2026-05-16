"""
单桶诊断脚本 — 给定 bucket_id, 查它在哪个目录, 能不能 load, metadata/content 长什么样.
回答 'id 能搜到但内容空 / 名字标签搜不到' 这类问题.

用法 (在 OB server 仓库根目录执行):
    python diagnose_bucket.py <bucket_id>

例:
    python diagnose_bucket.py 058114f3e30
"""
import sys
import os
import yaml
from pathlib import Path

try:
    import frontmatter
except ImportError:
    print("[!] 请先 pip install python-frontmatter")
    sys.exit(1)


def main():
    if len(sys.argv) < 2:
        print("用法: python diagnose_bucket.py <bucket_id>")
        sys.exit(1)
    target_id = sys.argv[1].strip()

    base_dir = Path("buckets")
    if not base_dir.exists():
        print(f"[!] 没找到 buckets/ 目录, 当前工作目录: {os.getcwd()}")
        sys.exit(1)

    # 5 个可能存放地点
    dirs = {
        "permanent": base_dir / "permanent",
        "dynamic":   base_dir / "dynamic",
        "feel":      base_dir / "feel",
        "archive":   base_dir / "archive",
        "trash":     base_dir / "trash",
    }

    print(f"\n===== 查 bucket_id: {target_id} =====\n")

    hits = []
    for tag, d in dirs.items():
        if not d.exists():
            print(f"  [{tag:9}]  目录不存在")
            continue
        for root, _, files in os.walk(d):
            for fname in files:
                if not fname.endswith(".md"):
                    continue
                name_part = fname[:-3]
                # 文件名: <bucket_id>.md 或 <name>_<bucket_id>.md
                if name_part == target_id or name_part.endswith(f"_{target_id}"):
                    hits.append((tag, os.path.join(root, fname)))

    if not hits:
        print(f"[X] 5 个目录里都没找到 {target_id} — 桶可能已被物理删除 (purge)")
        print("    或 id 写错了")
        sys.exit(0)

    if len(hits) > 1:
        print(f"[!] 警告: 在多个目录找到, 文件名重复:")
        for tag, path in hits:
            print(f"    - [{tag}] {path}")
        print()

    for location, path in hits:
        print(f"\n>>> 位置: {location}")
        print(f"    路径: {path}")
        size = os.path.getsize(path)
        print(f"    文件大小: {size} bytes")

        # 尝试 frontmatter.load
        try:
            post = frontmatter.load(path)
            meta = dict(post.metadata)
            content = post.content or ""
        except Exception as e:
            print(f"    [X] frontmatter 解析失败: {e}")
            print(f"        → 这很可能是 'id 能见但内容空' 的真凶")
            # 试着原文读一下前 5 行看看 YAML 有没有明显坏掉
            try:
                with open(path, "r", encoding="utf-8") as f:
                    first_lines = [next(f, "").rstrip() for _ in range(8)]
                print(f"    原文前 8 行:")
                for i, line in enumerate(first_lines, 1):
                    print(f"      {i:2}| {line[:80]}")
            except Exception as e2:
                print(f"    [X] 连 raw read 都失败: {e2}")
            continue

        # 关键字段一览
        print(f"    metadata:")
        important_keys = [
            "id", "name", "type", "domain", "tags",
            "importance", "valence", "arousal",
            "resolved", "protected", "highlight", "pinned",
            "internalized", "digested",
            "created", "last_active", "event_time",
            "trashed_at", "archived_at",
        ]
        for k in important_keys:
            if k in meta:
                v = meta[k]
                # 截断长值
                vs = repr(v)
                if len(vs) > 100:
                    vs = vs[:100] + "…"
                print(f"      {k:14} = {vs}")
        # 剩下的杂项 key
        others = set(meta.keys()) - set(important_keys)
        if others:
            print(f"    其他字段: {sorted(others)}")

        # content
        print(f"    content 长度: {len(content)} 字符")
        if content:
            preview = content.strip()[:300].replace("\n", " ")
            print(f"    content 预览: {preview}{'…' if len(content) > 300 else ''}")
        else:
            print(f"    [!] content 为空 — 这桶只有 frontmatter 元数据, 没有正文")
            print(f"        → 这很可能是 'id 找到但内容空 + tag/name 搜不到' 的真凶")

        # 命中条件检查
        print(f"\n    [诊断]")
        if location == "trash":
            print(f"      ⊘ 桶在 trash, list_all 不含 trash → 关键字搜索看不到 (设计如此)")
            print(f"      解法: 让朋友去回收站 restore, 或 purge 彻底删除")
        elif location == "archive":
            print(f"      ⊘ 桶在 archive, breath 搜索默认 include_archive=False → 关键字搜索看不到")
            print(f"      解法: 让朋友 unarchive, 或忽略 (archive 桶设计上就是软隐藏)")
        else:
            # 在 active 目录但搜不到 → 一定是字段问题
            name = meta.get("name", "").strip() if isinstance(meta.get("name"), str) else ""
            tags = meta.get("tags", [])
            if not name and not tags and not content:
                print(f"      ✗ name + tags + content 全空 → fuzz 找不到任何匹配信号")
            elif not name and not tags:
                print(f"      ⚠ name 和 tags 都空, 只能靠 content 模糊匹配")
            elif not content:
                print(f"      ⚠ content 空, 只能靠 name/tags 匹配")
            else:
                print(f"      ✓ 字段完整, 应该能搜到 (除非 query 真没匹配)")

            if meta.get("resolved") and meta.get("importance", 5) == 1:
                print(f"      ⊘ resolved+importance=1 → 标了 noise (软删除), 搜索显式排除")

            if meta.get("internalized") or meta.get("digested"):
                print(f"      ⊘ internalized=True → 搜索显式排除 (设计上 已内化的桶 不浮现)")


if __name__ == "__main__":
    main()
