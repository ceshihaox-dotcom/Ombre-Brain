# 更新日志 / Changelog

本 fork 以快照方式发布（无版本号），条目按日期记录。上游对齐条目会标注对应的上游版本。

## 2026-07-11 · 上游对齐批次 2b（工具面新能力）

### 新增 / Added

- **grow(items=[...]) 预拆分逐字入库**（上游 2.5.0）：上层 AI 已把长文拆成 N 条最终正文时，传 `items` 字符串列表即可逐字入库——跳过内部模型的二次拆分与改写（正文一字不动），每条只自动打元数据（领域/情感/标签/命名）；命中相似桶时合并走**原文追加**（`raw_merge`），不再 LLM 压缩。消除"廉价模型重述原话"的失真。打标 API 不可用时用默认元数据照存，正文不丢。`event_time` 与整批共享。不传 `items` 时行为与旧版完全一致。
- **breath(catalog=True) 目录模式**（上游 2.5.0）：每桶一行（名称|域|重要度），按类型分区、重要度降序，零 LLM/零向量调用。适合开新对话先花极少 token 总览"都记得哪些事"，再 `breath(query=...)` 精准拉取。支持 domain 过滤；已内化桶不列（与"不再浮现/不检索"语义一致）。走活跃集内存缓存，成本近乎为零。

### 维护 / Chores

- `tools/weekly_checkup.py`（含本机路径的个人运维脚本）移出仓库跟踪，加入 .gitignore；磁盘文件与本地排程不受影响。
- CLAUDE_PROMPT.md 能力表补充两个新参数的使用说明。

### 审计后加固 / Hardened after review

- `items` 注解改 `list | None`：显式传 `items: null` 的 MCP 客户端不再被 pydantic 校验拒掉整个调用。
- `raw_merge` 幂等护栏：完全相同的正文已在桶里（客户端超时重试/AI 重发）时不重复追加。
- grow 三条路径（items/短内容快速路径/拆分兜底）的打标兜底收敛为共用 helper，并修复 `or 0.5` 把合法的 0.0 情感坐标（极负/极静）折叠成中性默认的问题。
- catalog：噪声桶（resolved+importance=1 的软删标记）不再列出；domain 过滤大小写不敏感并同时匹配类型名（`domain="feel"` 可列 feel 区）；尊重 `max_tokens`，超限截断并注明剩余数量。
- items 的 dict 形式支持逐条指定 `importance`（1-10，不指定默认 5；内部打标模型不产重要度）。

### 测试 / Tests

- 新增 `tests/test_upstream_align_2b.py`（15 例，全离线 stub）：items 逐字落盘与 event_time 共享、dict/空条目容错、打标失败降级保存、raw_merge 原文追加且绝不调 LLM、raw_merge 重试幂等、0.0 情感坐标保真、逐条 importance、catalog 单行格式/排序/域过滤(含大小写与 feel)/内化与噪声排除/max_tokens 截断、catalog 零 LLM 零向量断言。

## 2026-07-11 · 上游对齐批次 2a（小件收尾）

### 修复 / Fixed

- **脱水缓存按模型命中**（上游 2.5.2）：`dehydration_cache.db` 写入时一直存有模型名，但读取只按内容 hash 命中——切换脱水模型后长桶首次浮现会继续复用旧模型的摘要。读取改为 内容 hash + 模型 双条件；同模型存量缓存继续有效，老库缺 model 列时自动补列。

### 已核对、无需改动 / Verified not applicable

- **工具描述中性化**（上游 5ebd52c + 2.5.2）：本 fork 的 7 个 MCP 工具描述已是中性功能向文案，读类工具（source/pulse）已自带克制条款。上游"收紧写入意图"的部分是有意分叉不跟进（见 CHANGES.md「与上游的有意分叉」），用户侧另有 Dashboard「prompt 一键对齐原作者版本」逃生门。
- **"Claude" 硬编码 / AI_NAME**（上游 2.3.21）：本 fork 无 letters 功能（上游该改动的主战场）；前端无用户可见的 "Claude" 硬编码；README 中的 Claude 均为第三方固有名或面向 Claude 接入场景的叙事，保留。
- **claude.ai 网页版接入限制声明**：README 已有完整披露（自定义连接器不支持 header、`mcp-remote`/Claude Code 替代路径、`OMBRE_MCP_URL_KEY` URL 密钥通道），无需补写。

### 文档 / Docs

- CHANGES.md 新增「与上游的有意分叉」小节：合并语义（LLM 智能合并 vs 上游追加原文）、写入主动性（主动记忆 vs 上游克制风格）、鉴权模型（header token + URL key vs 上游密码 + OAuth）三条透明披露。

## 2026-07-10 · 上游对齐批次一（v2.3.19 → v2.5.3 修复类）

从上游两条版本线（v2.4.x / v2.5.x）移植的修复与健壮性改动。功能类（OAuth、multi-owner、目录模式等）不在本批，另行评估。

### 修复 / Fixed

- **记忆桶原子写**（上游 2.5.0）：所有桶 `.md` 写入改为 临时文件 + fsync + `os.replace`，进程被杀/断电/磁盘写满不再产生半截文件；`runtime_config.json`、导入进度、命中统计等原有的手搓原子写一并收敛到同一 helper（补上 fsync）。Windows 下目标文件被同步盘/杀软短暂占用导致 `os.replace` 报 PermissionError 时短重试 3 次，仍失败则报错（不回退成截断式写入）。归档/回收站/恢复等移动操作补防撞名：目标已有同名文件时旁置为 `.stale-<时间戳>`（不带 `.md` 后缀，桶扫描自动忽略），不覆盖、不报错。
- **时间戳时区统一**（上游 2.5.3）：`created`/`last_active` 带 `Z` 后缀（本仓写入格式）或 UTC offset（导入数据）时，衰减引擎与检索时间新鲜度曾因 naive/aware 相减 `TypeError` 一律走 30 天兜底——**衰减打分对几乎所有桶失真，自动归档事实上从未生效**。统一经 `parse_iso_datetime`（naive UTC 口径）解析后恢复真实天数。注意：修复后第一次衰减周期，长期未激活的低重要度桶会按设计归档（归档可恢复、关键词仍可检索）。
- **桶元数据时间字段序列化归一**（上游 2.4.4）：YAML 把不带引号的时间戳解析成 `datetime` 对象，曾导致 dashboard 列表/详情、导入页、`dream()` 排序在遇到上游迁移桶时报错。读取层统一归一为 ISO 字符串。
- **LLM 回复 JSON 宽松解析**（上游 2.4.6，提取策略有意比上游严）：新增 `clean_llm_json()`，容忍 DeepSeek 等模型在 JSON 前后附带说明文字。整体可解析时原样返回；否则取**最后一个**平衡 JSON 值——上游取第一个，会把说明文字里的格式示例（如「请按 `{"k": 0.5}` 的格式」）当成结果吞进去。接入打标、日记拆分、正文重写、批量导入抽取五个解析点。
- **配置布尔安全归一**（上游 2.5.3）：YAML/JSON 里写成带引号的 `"false"`/`"0"` 不再被当作开启。涉及 embedding 开关、检索模式开关、auto_merge。

- **家族自动重建的时区偏移**：`built_at`（本地时间）与桶 `created`（UTC）曾直接字符串比较，JST 环境下"有没有新桶"的判断被压住最多 9 小时。families 状态时间戳改 UTC+Z 口径、比较改解析后进行；旧格式状态视为需要重建，一次收敛。

### 优化 / Improved

- **检索响应性能**（上游 2.5.0）：`list_all()` 活跃桶集内存缓存（写操作失效、touch/时间涟漪就地更新、命中返回逐桶拷贝防检索打分字段污染缓存、60 秒 TTL 兜底外部直接改盘的场景）；breath 浮现结果分波并发脱水（每波 4 条、波间检查 token 预算，不为被裁剪的结果整批调用 LLM）；touch 及时间涟漪移出 breath 响应路径改为后台补账。语义保留：last_active / activation_count / 涟漪照旧；取舍：进程在响应后、后台补账前被杀（重启/部署瞬间）会丢那一次激活计数，属可自愈的启发式数据。
- **embedding 进程内 LRU 查询缓存**（上游 2.4.13）：同一模型同一文本短时间内的重复向量请求只打一次 API。
- **API 超时可配**（上游 2.4.5）：新增 `dehydration.timeout_seconds` / `embedding.timeout_seconds`，环境变量 `OMBRE_COMPRESS_TIMEOUT_SECONDS` / `OMBRE_EMBED_TIMEOUT_SECONDS`。默认值不变（60 / 30 秒）。

### 已核对、无需移植 / Verified not applicable

- 上游 2.4.13 的"写入路径双重 embedding"：本 fork 的 `BucketManager` 不在内部生成向量，显式调用是唯一路径，无此问题。
- 上游 2.5.2 的"hold 降级保存"：本 fork 写入链路已是失败安全（打标失败用默认元数据照存正文；embedding 失败桶照写、事后 backfill；合并失败回落新建桶）。上游"合并只追加原文不走 LLM"的行为变更未采纳，本 fork 保留 LLM 智能合并。

### 测试 / Tests

- 新增 `tests/test_upstream_align_tier1.py`（21 例）：原子写、撞名旁置、时区解析各输入形态、clean_llm_json、时间字段归一、布尔/数值归一、活跃集缓存全生命周期、embedding LRU。
- 存量测试与基线逐项一致（3 failed / 20 errors 为预先存在的 pytest 9 环境兼容问题与已知的 permanent 打分期望值噪音，非本批引入）。
