# ============================================================
# release.ps1 — 生成 Ombre-Brain「可公开快照」+ 泄漏复检 + (可选)推公开仓
#
# 模型: 私库(本仓)乱推随便; 公库只接「干净快照」。每次发布 = 从当前 HEAD 导出
#       已跟踪文件 → 剥离个人/朋友/备份文件 → 泄漏哨兵复检 → (可选)推公开仓。
#
# 为什么安全:
#   - git archive HEAD 只含「已跟踪」文件 → buckets/ runtime_config.json .env
#     hit_stats.json 这些 untracked 私有数据**天然不会进快照**。
#   - 再显式剥离 5 个虽被跟踪、但不该公开的边角文件(见 $STRIP)。
#   - 导出后跑「泄漏哨兵」搜一遍朋友 handle / PAT / 私人备份仓名, 命中就中止,
#     绝不带病 push。
#   - dry-run 默认: 不加 -Push 只生成快照目录给你检查; 推还要显式 -PublicRepo。
#   - 防呆: 拒绝把快照推回私有 origin。
#
# 用法 (在 Ombre-Brain 仓根, 工作区干净时):
#   pwsh ./release.ps1                                   # dry-run: 只导出+复检, 给你检查
#   pwsh ./release.ps1 -PublicRepo <公开仓url> -Push     # 确认无误后推公开仓
# ============================================================

param(
    [string]$OutDir = "../ombre-release-staging",   # 快照导出目录 (默认放仓外, 不污染本仓)
    [string]$PublicRepo = "",                         # 公开仓 git URL; 留空=只导出不推
    [switch]$Push                                     # 加 -Push 才真推 (需 -PublicRepo)
)
$ErrorActionPreference = "Stop"

# --- 剥离清单 (相对仓根; 个人/朋友/备份/发布脚本自身, 都不进公开仓) ---
$STRIP = @(
    ".github/workflows/mirror-to-friend-fork.yml",  # 暴露朋友 GH handle + FRIEND_FORK_PAT
    "backup_20260405_2124",                         # 误提交的个人备份快照目录
    "reclassify_domains.py",                        # 含亲密语义的个人一次性脚本
    "diagnose_bucket.py",                           # 个人调试脚本
    "validate_extract.py",                          # 开源前个人验证 harness(跑私人聊天 + 依赖 upstream remote, 新克隆者跑不了)
    "INTERNALS.md",                                 # 内部 dev 文档已严重过时(2026-04-19, 早于 fork 大改), 待重写为使用说明后再发
    "release.ps1"                                   # 发布脚本自身
)
# 注: daily-backup.yml 不再剥离 —— 它已完全参数化(vars.OMBRE_BACKUP_URL, 未设自动跳过),
#     是文档承诺的"GitHub Actions 自动备份"的真身; 剥了会让备份文档变成空头支票。

# --- 泄漏哨兵: 导出后全文搜这些词, 命中即中止 (只放"确定是私货"的词, 避免误杀) ---
$SENTINELS = @("nan1103chang-tech", "FRIEND_FORK_PAT", "ombre-buckets-backup")

# 0) 必须在仓根 + 工作区干净 (快照取自 HEAD, 脏工作区说明有没提交的改动)
if (-not (Test-Path ".git")) { throw "请在 Ombre-Brain 仓根运行 release.ps1" }
$dirty = git status --porcelain
if ($dirty) { throw "工作区有未提交改动, 先 commit/stash 再发布(快照只取 HEAD 的已提交内容)" }
$sha = (git rev-parse --short HEAD).Trim()
Write-Host "源 HEAD = $sha" -ForegroundColor Cyan

# 1) 干净导出 HEAD 的已跟踪文件 (zip + Expand, 纯 PowerShell, 不依赖 tar)
if (Test-Path $OutDir) { Remove-Item $OutDir -Recurse -Force }
New-Item -ItemType Directory -Path $OutDir | Out-Null
$zip = Join-Path ([System.IO.Path]::GetTempPath()) "ob-release-$sha.zip"
git archive --format=zip -o $zip HEAD
Expand-Archive -Path $zip -DestinationPath $OutDir -Force
Remove-Item $zip -Force

# 2) 剥离个人/朋友/备份文件 + 兜底清掉任何残留 backup_* 目录
foreach ($p in $STRIP) {
    $full = Join-Path $OutDir $p
    if (Test-Path $full) { Remove-Item $full -Recurse -Force; Write-Host "  剥离: $p" }
}
Get-ChildItem $OutDir -Directory -Filter "backup_*" | ForEach-Object {
    Remove-Item $_.FullName -Recurse -Force; Write-Host "  剥离(兜底): $($_.Name)/"
}

# 3) 泄漏哨兵复检 — 命中即中止, 绝不带病发布
$hits = Get-ChildItem $OutDir -Recurse -File |
    Select-String -Pattern ($SENTINELS -join "|") -ErrorAction SilentlyContinue
if ($hits) {
    Write-Host "`n✗ 泄漏哨兵命中, 已中止 (清掉这些再发):" -ForegroundColor Red
    $hits | ForEach-Object { Write-Host ("  {0}:{1}" -f $_.Path, $_.Line.Trim()) }
    throw "泄漏哨兵命中, 中止发布"
}

# 4) 报告
$fileCount = (Get-ChildItem $OutDir -Recurse -File).Count
Write-Host "`n✓ 干净快照已生成: $OutDir" -ForegroundColor Green
Write-Host "  $fileCount 个文件 · 源 HEAD=$sha · 已剥离个人/朋友/备份 · 哨兵复检通过"
Write-Host "  (不含 untracked 私有数据: buckets/ runtime_config.json .env hit_stats.json)"

# 5) 推送 (可选)
if (-not $Push) {
    Write-Host "`n[dry-run] 没推。检查 $OutDir 无误后, 加 -PublicRepo <url> -Push 推公开仓。" -ForegroundColor Yellow
    return
}
if (-not $PublicRepo) { throw "-Push 需要同时给 -PublicRepo <公开仓 git url>" }
$origin = (git remote get-url origin 2>$null)
if ($origin -and ($PublicRepo.Trim() -eq $origin.Trim())) {
    throw "拒绝: -PublicRepo 跟私有 origin 相同, 你大概不想把快照推回私库"
}
Push-Location $OutDir
try {
    git init -q -b main
    git add -A
    git -c user.name="Ombre Release" -c user.email="release@local" commit -q -m "release: snapshot from $sha"
    git remote add public $PublicRepo
    Write-Host "`n→ 强推快照到 $PublicRepo (main)..." -ForegroundColor Cyan
    git push -f public main
    Write-Host "✓ 已发布快照到公开仓。" -ForegroundColor Green
} finally {
    Pop-Location
}
