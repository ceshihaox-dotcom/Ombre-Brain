// console-config.jsx —— API 配置 / Embedding / 其他参数

const { useState: ccS } = React;

function ConfigPage() {
  const [api, setApi] = ccS({
    model: 'deepseek-chat',
    baseUrl: 'https://api.deepseek.com/v1',
    apiKey: '',
    apiKeyDisplay: 'sk-3...577a',
    maxTokens: 1024,
    temperature: 0.1,
  });
  const [embed, setEmbed] = ccS({
    enabled: true,
    model: 'gemini-embedding-001',
    dim: 768,
    batch: 32,
  });
  const [other, setOther] = ccS({
    mergeThreshold: 75,
    autoConsolidate: true,
    nightWindow: '02:00–04:00',
    maxRecall: 8,
    pinPolicy: 'manual',
  });
  const [appliedAt, setAppliedAt] = ccS('2026-04-26 18:42 · 仅运行时');

  const updateApi = (k, v) => setApi(s => ({ ...s, [k]: v }));
  const updateEmbed = (k, v) => setEmbed(s => ({ ...s, [k]: v }));
  const updateOther = (k, v) => setOther(s => ({ ...s, [k]: v }));

  const apply = (persist) => {
    setAppliedAt(new Date().toLocaleString('zh-CN', { hour12: false }) + (persist ? ' · 已写入 config.yaml' : ' · 仅运行时'));
  };

  return (
    <main className="oc-main">
      <ConsolePageHd
        title="配置"
        sub={<>系统运行参数 —— 脱水/打标 API、向量化模型、回忆策略。修改后选择"仅运行时"应用一次，或写入 config.yaml 长久生效。</>}
        rightSlot={
          <>
            <div className="oc-status-pill ok">运行中</div>
            <div className="ob-page-counter">{appliedAt}</div>
          </>
        }
      />

      {/* API */}
      <ConsoleCard label="脱水 / 打标 API" sub="负责把对话压缩成记忆条目、抽取标签与摘要。">
        <div className="oc-field">
          <div className="oc-field-label">Model</div>
          <input className="oc-input oc-input-mono" value={api.model} onChange={(e) => updateApi('model', e.target.value)} />
        </div>
        <div className="oc-field">
          <div className="oc-field-label">Base URL</div>
          <input className="oc-input oc-input-mono" value={api.baseUrl} onChange={(e) => updateApi('baseUrl', e.target.value)} />
        </div>
        <div className="oc-field">
          <div className="oc-field-label">API Key</div>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <input
              className="oc-input oc-input-mono"
              type="password"
              placeholder={`当前：${api.apiKeyDisplay}`}
              value={api.apiKey}
              onChange={(e) => updateApi('apiKey', e.target.value)}
            />
            <button className="oc-btn oc-btn-ghost" onClick={() => alert('从 .env 重载（mock）')}>重载</button>
          </div>
        </div>
        <div className="oc-field-help" style={{ paddingLeft: 126, marginTop: -6 }}>
          留空不替换，不会写入 yaml；清空后从环境变量读取
        </div>
        <div className="oc-field">
          <div className="oc-field-label">Max Tokens</div>
          <input type="number" className="oc-input oc-input-mono" value={api.maxTokens} onChange={(e) => updateApi('maxTokens', +e.target.value)} />
        </div>
        <div className="oc-field">
          <div className="oc-field-label">Temperature</div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <input
              type="range"
              min={0}
              max={1}
              step={0.05}
              value={api.temperature}
              onChange={(e) => updateApi('temperature', +e.target.value)}
              className="oc-slider"
              style={{ flex: 1 }}
            />
            <input
              className="oc-input oc-input-mono"
              style={{ width: 80 }}
              value={api.temperature}
              onChange={(e) => updateApi('temperature', +e.target.value)}
            />
          </div>
        </div>
      </ConsoleCard>

      {/* Embedding */}
      <ConsoleCard label="向量化 Embedding" sub="为每条记忆生成稠密向量，用于语义检索与相似聚合。">
        <div className="oc-field">
          <div className="oc-field-label">启用</div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <div className={`oc-switch${embed.enabled ? ' on' : ''}`} onClick={() => updateEmbed('enabled', !embed.enabled)} />
            <span style={{ fontSize: 12, color: 'var(--ink-3)', fontFamily: 'var(--mono)' }}>
              {embed.enabled ? '已开启 · 新写入会自动 embed' : '已关闭 · 仅依赖 tag 检索'}
            </span>
          </div>
        </div>
        <div className="oc-field">
          <div className="oc-field-label">Model</div>
          <input className="oc-input oc-input-mono" value={embed.model} onChange={(e) => updateEmbed('model', e.target.value)} />
        </div>
        <div className="oc-field">
          <div className="oc-field-label">维度</div>
          <input type="number" className="oc-input oc-input-mono" value={embed.dim} onChange={(e) => updateEmbed('dim', +e.target.value)} />
        </div>
        <div className="oc-field">
          <div className="oc-field-label">批量大小</div>
          <input type="number" className="oc-input oc-input-mono" value={embed.batch} onChange={(e) => updateEmbed('batch', +e.target.value)} />
        </div>
      </ConsoleCard>

      {/* 回忆与合并策略 */}
      <ConsoleCard label="回忆 / 合并策略" sub="如何唤起与合并相似记忆。">
        <div className="oc-field">
          <div className="oc-field-label">合并阈值</div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <input
              type="range"
              min={0}
              max={100}
              step={1}
              value={other.mergeThreshold}
              onChange={(e) => updateOther('mergeThreshold', +e.target.value)}
              className="oc-slider"
              style={{ flex: 1 }}
            />
            <input
              className="oc-input oc-input-mono"
              style={{ width: 80 }}
              type="number"
              value={other.mergeThreshold}
              onChange={(e) => updateOther('mergeThreshold', +e.target.value)}
            />
          </div>
        </div>
        <div className="oc-field-help" style={{ paddingLeft: 126, marginTop: -8 }}>
          0–100 · 越高越严格（少合并），越低越松（频繁合并）
        </div>
        <div className="oc-field">
          <div className="oc-field-label">夜间合并窗口</div>
          <input className="oc-input oc-input-mono" value={other.nightWindow} onChange={(e) => updateOther('nightWindow', e.target.value)} />
        </div>
        <div className="oc-field-help" style={{ paddingLeft: 126, marginTop: -6 }}>
          每天此时间段内执行睡眠式合并，建议占空闲段
        </div>
        <div className="oc-field">
          <div className="oc-field-label">Max Recall</div>
          <input type="number" className="oc-input oc-input-mono" value={other.maxRecall} onChange={(e) => updateOther('maxRecall', +e.target.value)} />
        </div>
        <div className="oc-field-help" style={{ paddingLeft: 126, marginTop: -6 }}>
          每次 Breath 唤起的最大记忆条数（top N）
        </div>
        <div className="oc-field">
          <div className="oc-field-label">钉决策略</div>
          <select className="oc-select" value={other.pinPolicy} onChange={(e) => updateOther('pinPolicy', e.target.value)}>
            <option value="manual">仅手动钉决</option>
            <option value="importance">imp ≥ 8 自动钉决</option>
            <option value="ai">AI 推荐 + 人工确认</option>
          </select>
        </div>
        <div className="oc-field">
          <div className="oc-field-label">自动内化</div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <div className={`oc-switch${other.autoConsolidate ? ' on' : ''}`} onClick={() => updateOther('autoConsolidate', !other.autoConsolidate)} />
            <span style={{ fontSize: 12, color: 'var(--ink-3)', fontFamily: 'var(--mono)' }}>
              {other.autoConsolidate ? '激活强度高 + 重复唤起 → 自动标记"已内化"' : '关闭 · 仅人工标记'}
            </span>
          </div>
        </div>
      </ConsoleCard>

      {/* 操作按钮 */}
      <div className="oc-btn-row" style={{ marginBottom: 24 }}>
        <button className="oc-btn oc-btn-primary" onClick={() => apply(false)}>应用（仅运行时）</button>
        <button className="oc-btn" onClick={() => apply(true)}>应用并写入 config.yaml</button>
        <button className="oc-btn oc-btn-ghost" onClick={() => alert('已重置（mock）')}>重置为默认</button>
        <button className="oc-btn oc-btn-danger" style={{ marginLeft: 'auto' }}>清空 API Key</button>
      </div>

      {/* 系统信息 */}
      <ConsoleCard label="系统信息" sub="只读 · 用于诊断">
        <div className="oc-field">
          <div className="oc-field-label">Transport</div>
          <code style={{ fontFamily: 'var(--mono)', fontSize: 12, color: 'var(--ink-2)' }}>streamable-http</code>
        </div>
        <div className="oc-field">
          <div className="oc-field-label">Buckets dir</div>
          <code style={{ fontFamily: 'var(--mono)', fontSize: 12, color: 'var(--ink-2)' }}>/opt/render/project/src/buckets</code>
        </div>
        <div className="oc-field">
          <div className="oc-field-label">配置文件</div>
          <code style={{ fontFamily: 'var(--mono)', fontSize: 12, color: 'var(--ink-2)' }}>./config.yaml</code>
        </div>
        <div className="oc-field">
          <div className="oc-field-label">运行版本</div>
          <code style={{ fontFamily: 'var(--mono)', fontSize: 12, color: 'var(--ink-2)' }}>ombre-brain v0.7.3 · 2026-04-26 build</code>
        </div>
      </ConsoleCard>
    </main>
  );
}

window.ConfigPage = ConfigPage;
