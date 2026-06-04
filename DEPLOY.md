# 部署指南 · 本 fork 特有项

> **基础部署方式(Docker / 本地 / Obsidian 集成)请看 [README.md](./README.md)** — 那是原作者写的非常完整的指南。
> 本文档只补充本 fork 新增的部署选项。

## 一键部署到 Render(推荐云部署用户)

[![Deploy to Render](https://render.com/images/deploy-to-render-button.svg)](https://render.com/deploy?repo=https://github.com/ceshihaox-dotcom/OmbreBrain-folio)

点上面按钮 → Render 会自动读 `render.yaml` → 你只需要填几个环境变量就完事:

**🔴 安全(必填,不填拒绝启动)**:
- `OMBRE_ADMIN_TOKEN` - 一个强随机值(例 `openssl rand -hex 32`)。Render 是**公开 URL**,这是唯一的门。
  设了之后,除了静态页和 `/health`,所有 `/api/*` 和 `/mcp` 都必须带 `X-Admin-Token: <token>` header。
  **不设这个值,公网部署会直接拒绝启动**(没有门 = 任何人可读/删你的全部记忆)。

**LLM 配置(强烈建议填)** — 不填服务也能启动, 但脱水/打标会降级为本地关键词提取, 质量差很多:
- `OMBRE_API_KEY` - 你的 LLM API key
- `OMBRE_BASE_URL` - 例 `https://api.deepseek.com/v1`
- `OMBRE_MODEL` - 例 `deepseek-chat`

**强烈推荐**(给云部署用户长期保命):
- `OMBRE_BACKUP_REPO` - 你的私人 backup repo(例 `github.com/yourname/my-ombre-backup`)
- `OMBRE_BACKUP_TOKEN` - GitHub Personal Access Token(权限 `repo`)

**可选**:
- `OMBRE_EMBED_API_KEY` + `OMBRE_EMBED_BASE_URL` - embedding 模型独立配置
- `OMBRE_ALLOWED_ORIGINS` - CORS 允许的浏览器跨源 origin(逗号分隔,默认仅同源,一般不用填)
- 其他配置见 [.env.example](./.env.example)

部署完成后访问:
- 主网页: `https://your-app.onrender.com/v2/`
- 控制台: `https://your-app.onrender.com/v2/console/`
- 手机端: `https://your-app.onrender.com/v2/mobile/`

**首次打开网页**会弹窗要 `X-Admin-Token` —— 输入你设的 `OMBRE_ADMIN_TOKEN`,
存进浏览器 localStorage 后自动刷新,之后这台设备/浏览器就不用再输了。

### 接入说明(给程序化客户端)
- **claude.ai / Claude Desktop 等 MCP 连接器**:在连接器配置里加一个 header
  `X-Admin-Token: <你的 OMBRE_ADMIN_TOKEN>`,否则连不上 `/mcp`。
- **每日自动备份**(GitHub Actions,见下文):如果设了 `OMBRE_ADMIN_TOKEN`,
  必须在 OB 仓库的 `Settings > Secrets and variables > Actions` 里也加一个
  同名 secret `OMBRE_ADMIN_TOKEN`,值一致,否则 backup 会 401。

---

## 自动备份配置(强烈建议)

云部署的持久盘有概率出事(我之前因为环境变量错配丢过 7 天数据)。本 fork 自带每日自动备份机制:

### Step 1 — 建一个 backup repo

到 GitHub 建一个**空 private repo**,例如 `my-ombre-backup`。

### Step 2 — 创建 GitHub Token

[GitHub Settings → Developer settings → Personal access tokens](https://github.com/settings/tokens) → 生成新 token,只勾 `repo` 权限。

### Step 3 — 配置环境变量

```
OMBRE_BACKUP_REPO=github.com/yourname/my-ombre-backup
OMBRE_BACKUP_TOKEN=ghp_xxxxxxxxxxxxxxxxxxxx
OMBRE_BACKUP_USER=ombre-bot   # 可选
```

### Step 4 — 验证

部署后,POST `/api/backup` 手动触发一次:

```bash
curl -X POST https://your-app.onrender.com/api/backup
```

返回 `{"ok": true, "commit_sha": "..."}` 就是成了。

去你的 backup repo 看一下,应该有第一次提交。

### Step 5 — 启用每日 cron

GitHub Actions 工作流 `.github/workflows/daily-backup.yml` 已经写好了,只需在你 fork 的**代码仓库**里配置:

1. **必填 —— 一个 Variable(不是 Secret)**:
   - 仓库 → Settings → Secrets and variables → Actions → **Variables 标签页** → New repository variable
   - Name: `OMBRE_BACKUP_URL`
   - Value: `https://your-app.onrender.com` (你的部署域名,**不带尾斜杠、不带 `/api/backup`** —— 工作流会自己拼)
2. **仅当**你给服务设了 `OMBRE_ADMIN_TOKEN`,再加一个 **Secret**(Secrets 标签页):
   - Name: `OMBRE_ADMIN_TOKEN`,Value 跟服务端那个**完全一致**(否则备份会 401 失败)

完成后每天北京时间 03:00 自动触发。

> ⚠️ **重要(防"假装有备份")**: 如果没设 `OMBRE_BACKUP_URL`,工作流会**静默跳过、不报错也不备份**。配完**务必去 Actions 页面手动触发一次**(`每日备份 buckets` → Run workflow)确认跑出绿勾 + 你的 backup repo 里真有提交。别只配不验。

---

## 从上游 Ombre-Brain 迁移过来?

如果你之前在用 [上游版本](https://github.com/P0luz/Ombre-Brain) 想换到本 fork,**先看 [MIGRATION.md](./MIGRATION.md)**。

简短版:

```bash
# 备份原数据
cp -r ./buckets ./buckets.backup-original

# 检查兼容性 (dry-run)
python migrate_from_upstream.py --buckets-dir ./buckets

# 一键 normalize 老字段 (自动备份)
python migrate_from_upstream.py --buckets-dir ./buckets --fix

# 启动
python server.py
```

详细 FAQ + 故障处理见 [MIGRATION.md](./MIGRATION.md)。

---

## 本 fork 跟上游有什么区别?

见 [CHANGES.md](./CHANGES.md) - 完整功能清单 + 透明披露所有改动。简短版:

- 全套新前端(timeline / cells / network / console / mobile)
- 工作流增强(导入工作台 / 重新脱水 / 软删除 / Prompt 编辑器 / 等)
- **核心记忆机制(衰减/做梦/feel/记忆桶/情感权重)跟上游完全一致**;检索/排序的命中精度做了优化(尤其中文)。配置页有"⇆ 对齐原作者版本"按钮可一键回上游 prompt

---

## 部署后的常见问题

### Render 冷启动很慢?
- Starter plan 15 分钟没请求会休眠,首次访问要 30 秒醒
- 解决: 用 [UptimeRobot](https://uptimerobot.com/) 每 5 分钟 ping 一下 `/health`,免费

### 持久盘满了?
- 默认 1GB,200 条记忆约 1MB,通常够用
- 跑 5 年 + 万条记忆才会满
- 真满了到 Render dashboard 升级 disk size

### 想本地开发但又用云上的数据?
- 跑备份, 把私人 backup repo clone 到本地
- 把 `buckets/` 拷出来作为本地 OMBRE_BUCKETS_DIR

### 切换 LLM 不想改 .env 重启?
- 进 `/v2/console/config/` → API 配置 → 加多个 profile,一键切换不重启
