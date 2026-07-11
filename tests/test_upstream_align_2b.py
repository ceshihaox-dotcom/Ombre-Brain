# ============================================================
# 上游对齐批次 2b 回归测试 (2026-07-11)
# 覆盖: grow(items=[...]) 预拆分逐字入库 + raw_merge 原文追加 (上游 2.5.0)
#       breath(catalog=True) 目录模式 (上游 2.5.0)
# 全离线: stub 掉 dehydrator/embedding, 不打任何 API。
# 同步 test + asyncio.run, 避开 pytest-asyncio async fixture 兼容坑。
# ============================================================

import asyncio
import os
import sys
import tempfile

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

# 必须在 import server 之前把桶目录指到临时目录(server 模块级初始化引擎)
_TMP_BUCKETS = tempfile.mkdtemp(prefix="ob_2b_buckets_")
os.environ["OMBRE_BUCKETS_DIR"] = _TMP_BUCKETS

import frontmatter  # noqa: E402

import server  # noqa: E402


def _fake_analyze(domain=None, tags=None, name=""):
    async def analyze(content):
        return {
            "domain": domain or ["测试域"],
            "valence": 0.6,
            "arousal": 0.4,
            "tags": tags or ["标签A"],
            "suggested_name": name,
        }
    return analyze


class TestGrowItems:
    def test_items_stored_verbatim_no_digest(self):
        """items 模式: 跳过 digest, 正文一字不动入库。"""
        calls = {"digest": 0}

        async def fail_digest(content):
            calls["digest"] += 1
            raise AssertionError("items 模式绝不能调 digest")

        orig_analyze = server.dehydrator.analyze
        orig_digest = server.dehydrator.digest
        server.dehydrator.analyze = _fake_analyze(name="逐字条目")
        server.dehydrator.digest = fail_digest
        try:
            out = asyncio.run(server.grow(
                items=["第一条：原话一字不动，包括标点。", "第二条：完整保留的第二段。"],
                event_time="2026-07-01",
            ))
            assert "2条(预拆分·逐字)" in out, out
            assert calls["digest"] == 0
            # 落盘内容逐字比对
            found = []
            for root, _, files in os.walk(_TMP_BUCKETS):
                for f in files:
                    if f.endswith(".md"):
                        post = frontmatter.load(os.path.join(root, f))
                        found.append((post.content, post.get("event_time")))
            contents = [c for c, _ in found]
            assert "第一条：原话一字不动，包括标点。" in contents, contents
            assert "第二条：完整保留的第二段。" in contents
            # event_time 共享
            for c, et in found:
                if c.startswith("第一条") or c.startswith("第二条"):
                    assert str(et).startswith("2026-07-01"), (c, et)
        finally:
            server.dehydrator.analyze = orig_analyze
            server.dehydrator.digest = orig_digest

    def test_items_tolerates_dict_and_empty(self):
        orig_analyze = server.dehydrator.analyze
        server.dehydrator.analyze = _fake_analyze()
        try:
            out = asyncio.run(server.grow(items=[
                {"content": "字典形式的条目"}, "", "   ", 123, None,
            ]))
            assert "1条(预拆分·逐字)" in out, out
            out2 = asyncio.run(server.grow(items=["", None]))
            assert "未创建任何桶" in out2
        finally:
            server.dehydrator.analyze = orig_analyze

    def test_items_analyze_failure_still_saves(self):
        """打标 LLM 挂掉 → 默认元数据照存, 正文不丢(与 hold 同降级哲学)。"""
        async def broken_analyze(content):
            raise RuntimeError("API down")

        orig_analyze = server.dehydrator.analyze
        server.dehydrator.analyze = broken_analyze
        try:
            out = asyncio.run(server.grow(items=["API 挂了也必须存下来的内容"]))
            assert "新1" in out, out
            all_contents = []
            for root, _, files in os.walk(_TMP_BUCKETS):
                for f in files:
                    if f.endswith(".md"):
                        all_contents.append(frontmatter.load(os.path.join(root, f)).content)
            assert "API 挂了也必须存下来的内容" in all_contents
        finally:
            server.dehydrator.analyze = orig_analyze


class TestAuditFixes:
    """审计轮修复的回归锁。"""

    def test_valence_zero_preserved(self):
        """审计#1: analyze 返回 0.0(极负)不能被 or 折叠成 0.5。"""
        async def zero_analyze(content):
            return {"domain": ["测试域"], "valence": 0.0, "arousal": 0.0,
                    "tags": [], "suggested_name": "极负条目"}

        orig = server.dehydrator.analyze
        server.dehydrator.analyze = zero_analyze
        try:
            asyncio.run(server.grow(items=["一段极其负面的记忆内容"]))
            found = None
            for root, _, files in os.walk(_TMP_BUCKETS):
                for f in files:
                    if f.endswith(".md"):
                        post = frontmatter.load(os.path.join(root, f))
                        if post.content == "一段极其负面的记忆内容":
                            found = post
            assert found is not None
            assert float(found["valence"]) == 0.0, found["valence"]
            assert float(found["arousal"]) == 0.0, found["arousal"]
        finally:
            server.dehydrator.analyze = orig

    def test_items_none_explicit(self):
        """审计#2: 显式传 items=None 必须走 content 路径不炸(schema 层另有 list|None 修复)。"""
        orig = server.dehydrator.analyze
        server.dehydrator.analyze = _fake_analyze()
        try:
            out = asyncio.run(server.grow(content="短", items=None))
            assert "新建" in out or "合并" in out, out
        finally:
            server.dehydrator.analyze = orig

    def test_dict_item_importance(self):
        """审计#7: dict 形式可逐条指定 importance。"""
        orig = server.dehydrator.analyze
        server.dehydrator.analyze = _fake_analyze()
        try:
            asyncio.run(server.grow(items=[{"content": "高重要度逐字条目", "importance": 9}]))
            for root, _, files in os.walk(_TMP_BUCKETS):
                for f in files:
                    if f.endswith(".md"):
                        post = frontmatter.load(os.path.join(root, f))
                        if post.content == "高重要度逐字条目":
                            assert int(post["importance"]) == 9, post["importance"]
                            return
            raise AssertionError("bucket not found")
        finally:
            server.dehydrator.analyze = orig

    def test_raw_merge_idempotent_retry(self):
        """审计#3: 同一正文重试不重复追加。"""
        async def run():
            bid = await server.bucket_mgr.create(
                content="幂等靶内容", tags=[], importance=5, domain=["测试域"],
                valence=0.5, arousal=0.3, name="幂等靶",
            )
            target = await server.bucket_mgr.get(bid)

            async def fake_search(*a, **kw):
                hit = dict(await server.bucket_mgr.get(bid))
                hit["score"] = 99
                return [hit]

            orig_search = server.bucket_mgr.search
            server.bucket_mgr.search = fake_search
            try:
                for _ in range(2):  # 两次相同追加 = 模拟重试
                    await server._merge_or_create(
                        content="追加一次的内容", tags=[], importance=5,
                        domain=["测试域"], valence=0.5, arousal=0.3, raw_merge=True,
                    )
                after = await server.bucket_mgr.get(bid)
                assert after["content"].count("追加一次的内容") == 1, after["content"]
            finally:
                server.bucket_mgr.search = orig_search

        asyncio.run(run())

    def test_catalog_feel_via_domain_filter(self):
        """审计#5: breath(catalog=True, domain=\"feel\") 必须能列出 feel 桶(靠 type 匹配)。"""
        async def run():
            await server.bucket_mgr.create(
                content="一条feel内容", tags=[], importance=5,
                domain=[], valence=0.7, arousal=0.4, name="feel目录条目",
                bucket_type="feel",
            )
            out = await server.breath(catalog=True, domain="feel")
            assert "feel目录条目" in out, out[:300]

        asyncio.run(run())

    def test_catalog_excludes_noise(self):
        """审计#6: 噪声桶(resolved+importance=1)是软删, 目录不列。"""
        async def run():
            bid = await server.bucket_mgr.create(
                content="被软删的内容", tags=[], importance=5,
                domain=["目录域"], valence=0.5, arousal=0.3, name="噪声条目",
            )
            await server.bucket_mgr.update(bid, resolved=True, importance=1)
            out = await server.breath(catalog=True)
            assert "噪声条目" not in out

        asyncio.run(run())

    def test_catalog_domain_case_insensitive(self):
        """审计#8: domain 过滤大小写不敏感, 与 search 一致。"""
        async def run():
            await server.bucket_mgr.create(
                content="tech内容", tags=[], importance=5,
                domain=["Tech"], valence=0.5, arousal=0.3, name="大小写条目",
            )
            out = await server.breath(catalog=True, domain="tech")
            assert "大小写条目" in out, out[:300]

        asyncio.run(run())

    def test_catalog_respects_max_tokens(self):
        """审计#9: 超限截断并注明剩余数量。"""
        async def run():
            for i in range(10):
                await server.bucket_mgr.create(
                    content=f"截断测试内容{i}", tags=[], importance=5,
                    domain=["截断域"], valence=0.5, arousal=0.3,
                    name=f"截断测试条目编号很长占token{i}",
                )
            out = await server.breath(catalog=True, domain="截断域", max_tokens=60)
            assert "已截断" in out, out
            assert "桶未列出" in out

        asyncio.run(run())


class TestRawMerge:
    def test_raw_merge_appends_without_llm(self):
        """raw_merge=True: 命中相似桶时原文追加, 绝不调 dehydrator.merge。"""
        async def run():
            bid = await server.bucket_mgr.create(
                content="老桶的原有内容",
                tags=["旧"], importance=5, domain=["测试域"],
                valence=0.5, arousal=0.3, name="raw合并靶",
            )
            target = await server.bucket_mgr.get(bid)

            async def fake_search(*a, **kw):
                hit = dict(target)
                hit["score"] = 99
                return [hit]

            async def fail_merge(old, new):
                raise AssertionError("raw_merge 模式绝不能调 LLM merge")

            orig_search = server.bucket_mgr.search
            orig_merge = server.dehydrator.merge
            server.bucket_mgr.search = fake_search
            server.dehydrator.merge = fail_merge
            try:
                name, is_merged = await server._merge_or_create(
                    content="新追加的逐字内容",
                    tags=["新"], importance=5, domain=["测试域"],
                    valence=0.6, arousal=0.4, raw_merge=True,
                )
                assert is_merged is True
                after = await server.bucket_mgr.get(bid)
                assert after["content"] == "老桶的原有内容\n\n新追加的逐字内容", after["content"]
            finally:
                server.bucket_mgr.search = orig_search
                server.dehydrator.merge = orig_merge

        asyncio.run(run())


class TestBreathCatalog:
    def test_catalog_lists_one_line_per_bucket_no_llm(self):
        async def run():
            await server.bucket_mgr.create(
                content="目录条目甲的内容", tags=[], importance=8,
                domain=["目录域"], valence=0.5, arousal=0.3, name="目录条目甲",
            )
            await server.bucket_mgr.create(
                content="目录条目乙的内容", tags=[], importance=3,
                domain=["目录域"], valence=0.5, arousal=0.3, name="目录条目乙",
            )

            async def fail_dehydrate(*a, **kw):
                raise AssertionError("catalog 模式绝不能调脱水 LLM")

            async def fail_embed(*a, **kw):
                raise AssertionError("catalog 模式绝不能调 embedding")

            orig_de = server.dehydrator.dehydrate
            orig_ss = server.embedding_engine.search_similar
            server.dehydrator.dehydrate = fail_dehydrate
            server.embedding_engine.search_similar = fail_embed
            try:
                out = await server.breath(catalog=True)
            finally:
                server.dehydrator.dehydrate = orig_de
                server.embedding_engine.search_similar = orig_ss

            assert "=== 记忆目录" in out, out[:200]
            assert "目录条目甲 | 目录域 | 8" in out, out
            assert "目录条目乙 | 目录域 | 3" in out
            # 重要度降序: 甲(8) 在 乙(3) 前
            assert out.index("目录条目甲") < out.index("目录条目乙")
            # 目录不含正文
            assert "目录条目甲的内容" not in out

        asyncio.run(run())

    def test_catalog_domain_filter(self):
        async def run():
            out = await server.breath(catalog=True, domain="不存在的域名XYZ")
            assert "没有匹配 domain 过滤" in out

        asyncio.run(run())

    def test_catalog_excludes_internalized(self):
        async def run():
            bid = await server.bucket_mgr.create(
                content="被内化的记忆", tags=[], importance=5,
                domain=["目录域"], valence=0.5, arousal=0.3, name="已内化条目",
            )
            await server.bucket_mgr.update(bid, internalized=True)
            out = await server.breath(catalog=True)
            assert "已内化条目" not in out, "internalized 语义=不浮现不检索, 目录也不该列"

        asyncio.run(run())
