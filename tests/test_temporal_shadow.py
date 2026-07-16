# ============================================================
# Temporal Shadow v0 解析器 (2026-07-16, notepad t-j5dg9l866s)
# 纪律: exact/range 给日期, open_range 给开口区间, epoch/vague 绝不编日期。
# now 全部注入固定值保证确定性; Asia/Tokyo + 凌晨4点切日。
# ============================================================

from datetime import datetime

from temporal_shadow import parse_temporal, _TOKYO

# 固定"现在": 2026-07-16 14:00 东京 → 逻辑今天 = 2026-07-16
NOW = datetime(2026, 7, 16, 14, 0, tzinfo=_TOKYO)
# 凌晨场景: 2026-07-16 02:30 东京 → 4点切日 → 逻辑今天 = 2026-07-15
NOW_LATE_NIGHT = datetime(2026, 7, 16, 2, 30, tzinfo=_TOKYO)


class TestExact:
    def test_explicit_full_date(self):
        h = parse_temporal("2026-07-10 那天的大富翁", now=NOW)
        assert h["granularity"] == "exact" and h["start"] == "2026-07-10" == h["end"]

    def test_month_day_current_year(self):
        h = parse_temporal("4月6号是我们在一起的日子", now=NOW)
        assert h["granularity"] == "exact" and h["start"] == "2026-04-06"

    def test_month_day_future_rolls_back_a_year(self):
        # 12月25号在7月的"未来" → 回退到去年
        h = parse_temporal("12月25号那次", now=NOW)
        assert h["start"] == "2025-12-25"

    def test_yesterday(self):
        h = parse_temporal("她昨天熬夜修bug到凌晨两点", now=NOW)
        assert h["granularity"] == "exact" and h["start"] == "2026-07-15"
        assert h["label"] == "yesterday"

    def test_day_cut_4am(self):
        # 凌晨2点半说"昨天" → 逻辑今天是7-15, 昨天=7-14 (她的作息: 凌晨是今天的尾巴)
        h = parse_temporal("昨天说好的", now=NOW_LATE_NIGHT)
        assert h["start"] == "2026-07-14"


class TestRange:
    def test_last_week(self):
        h = parse_temporal("上周聊的那个", now=NOW)  # 2026-07-16 是周四
        assert h["granularity"] == "range"
        assert h["start"] == "2026-07-06" and h["end"] == "2026-07-12"  # 上周一~上周日

    def test_bare_month(self):
        h = parse_temporal("5月的时候我们在干嘛", now=NOW)
        assert h["granularity"] == "range"
        assert h["start"] == "2026-05-01" and h["end"] == "2026-05-31"

    def test_bare_month_future_rolls_back(self):
        h = parse_temporal("11月的事", now=NOW)
        assert h["start"] == "2025-11-01"


class TestOpenRange:
    def test_recent(self):
        h = parse_temporal("最近怎么老是想睡觉", now=NOW)
        assert h["granularity"] == "open_range"
        assert h["start"] == "2026-07-02" and h["end"] is None


class TestEpochNeverFabricatesDates:
    def test_earliest(self):
        h = parse_temporal("最开始的时候我们都聊了些什么", now=NOW)
        assert h["granularity"] == "epoch" and h["label"] == "earliest"
        assert h["start"] is None and h["end"] is None

    def test_private_word_chuchuang(self):
        h = parse_temporal("初窗那会儿的事还记得吗", now=NOW)
        assert h["granularity"] == "epoch" and h["label"] == "early"
        assert h["start"] is None

    def test_first_met(self):
        h = parse_temporal("她刚认识我那会儿是什么样子", now=NOW)
        assert h["granularity"] == "epoch" and h["label"] == "early"


class TestVague:
    def test_last_time(self):
        h = parse_temporal("上次游戏的道具设置", now=NOW)
        assert h["granularity"] == "vague" and h["label"] == "last_time"
        assert h["start"] is None and h["end"] is None

    def test_bare_keiduan_stays_vague(self):
        # 裸词"客户端"不触发 epoch("客户端打开了"会误伤) → 落到"那时候"的 vague
        h = parse_temporal("那时候我们还在客户端", now=NOW)
        assert h["granularity"] == "vague" and h["label"] == "back_then"

    def test_keiduan_shiqi_is_epoch(self):
        h = parse_temporal("客户端时期我们聊过什么", now=NOW)
        assert h["granularity"] == "epoch" and h["label"] == "early"

    def test_pure_vague(self):
        h = parse_temporal("那段时间她很忙", now=NOW)
        assert h["granularity"] == "vague" and h["label"] == "back_then"


class TestPriorityAndNone:
    def test_exact_beats_vague(self):
        # "昨天"(exact) 和 "之前"(vague) 同现 → exact 赢
        h = parse_temporal("昨天说的和之前说的不一样", now=NOW)
        assert h["granularity"] == "exact"

    def test_no_temporal(self):
        assert parse_temporal("她想吃桂林米粉", now=NOW) is None
        assert parse_temporal("", now=NOW) is None
        assert parse_temporal(None, now=NOW) is None

    def test_source_text_present(self):
        h = parse_temporal("上次游戏的道具设置", now=NOW)
        assert h["source_text"] == "上次"
