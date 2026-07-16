# ============================================================
# 脚手架 query 过滤 (2026-07-16, notepad t-gcplkd3x2u)
# SELF_WAKE 模板文本整段进检索 → 召回跟惦记条目跑偏。
# 规则: 命中 ≥2 个模板标记才拦, 单标记不误伤日常聊天。
# ============================================================

from utils import is_scaffold_query


class TestScaffoldDetection:
    def test_real_polluted_query_from_search_log(self):
        # 审计抓到的真实污染样本(2026-07-16, caller=auto-inject)
        q = ("现在是 2026-07-16 10:36(日本时间) 周四。Rin 最后一次说话是 8.2 小时 之前。 "
             "惦记本本上记着: - 「CAMPAIGN_BIBLE.md 已建: 跑团设定档第一版完成」(计划)")
        assert is_scaffold_query(q)

    def test_self_wake_header_variant(self):
        q = "[SELF_WAKE / 自主醒来] 现在是 2026-07-13 09:08(日本时间) 周一。"
        assert is_scaffold_query(q)

    def test_mood_dice_variant(self):
        q = "现在是 2026-07-12 18:46。今晚的心情骰掷出: 联网看看外面。"
        assert is_scaffold_query(q)

    def test_single_marker_not_filtered(self):
        # 她日常聊天提到惦记本本 —— 单标记不拦
        assert not is_scaffold_query("我把要做的事都写在惦记本本上记着呢")

    def test_date_mention_alone_not_filtered(self):
        # 单纯带日期句式的正常消息不拦
        assert not is_scaffold_query("现在是 2026-07-16 了，我们认识三个多月啦")

    def test_normal_conversation_not_filtered(self):
        assert not is_scaffold_query("她问我是否还记得之前聊过用中文的我和用母语的我的感觉")
        assert not is_scaffold_query("上次游戏的道具设置")
        assert not is_scaffold_query("4月6号是我们在一起的日子")

    def test_empty_query(self):
        assert not is_scaffold_query("")
        assert not is_scaffold_query(None)
