// console-config.jsx —— 配置页:还原旧版视觉,API 卡内嵌 profile 切换

const { useState: ccS, useEffect: ccE } = React;

const API_PRESETS = [
  { id: 'deepseek',     name: 'DeepSeek Chat',     model: 'deepseek-chat',     base_url: 'https://api.deepseek.com/v1' },
  { id: 'gemini-flash', name: 'Gemini 2.5 Flash',  model: 'gemini-2.5-flash',  base_url: 'https://generativelanguage.googleapis.com/v1beta/openai/' },
  { id: 'gemini-pro',   name: 'Gemini 2.5 Pro',    model: 'gemini-2.5-pro',    base_url: 'https://generativelanguage.googleapis.com/v1beta/openai/' },
  { id: 'claude-haiku', name: 'Claude Haiku 4.5',  model: 'claude-haiku-4-5',  base_url: 'https://api.anthropic.com/v1/' },
  { id: 'claude-sonnet',name: 'Claude Sonnet 4.6', model: 'claude-sonnet-4-6', base_url: 'https://api.anthropic.com/v1/' },
  { id: 'qwen3',        name: 'Qwen3 (DashScope)', model: 'qwen-max',          base_url: 'https://dashscope.aliyuncs.com/compatible-mode/v1' },
];

function ConfigPage() {
  const [data, setData] = ccS(null);                  // 后端 /api/config/api 全量
  const [loadErr, setLoadErr] = ccS(null);
  const [selectedPid, setSelectedPid] = ccS(null);    // 表单当前在编辑哪个 profile
  const [draft, setDraft] = ccS(null);                // 表单草稿(改字段时只动它,不动 data)
  const [showKey, setShowKey] = ccS(false);
  const [testStatus, setTestStatus] = ccS(null);      // null|'pending'|{ok|fail, latency_ms?, sample?, error?}
  const [busy, setBusy] = ccS(null);                  // 'save'|'activate'|'delete'|'test'|'clear'
  const [appliedAt, setAppliedAt] = ccS('');

  const fetchAll = async () => {
    try {
      const r = await fetch('/api/config/api');
      if (!r.ok) throw new Error('HTTP ' + r.status);
      const d = await r.json();
      setData(d);
      // 默认选中:激活的 profile,没有就选第一个,都没有就 null(显示新建表单)
      const initial = d.active || (d.profiles[0] && d.profiles[0].id) || null;
      setSelectedPid(initial);
      if (initial) {
        const p = d.profiles.find(x => x.id === initial);
        setDraft({ id: p.id, name: p.name, model: p.model, base_url: p.base_url, api_key: '' });
      } else {
        setDraft(null);
      }
    } catch (e) {
      setLoadErr(e.message || String(e));
    }
  };
  ccE(() => { fetchAll(); }, []);

  const switchSelected = (pid) => {
    setSelectedPid(pid);
    setShowKey(false);
    setTestStatus(null);
    if (pid === '__new__') {
      setDraft({ id: '', name: '', model: '', base_url: '', api_key: '', _preset: '' });
    } else {
      const p = data.profiles.find(x => x.id === pid);
      if (p) setDraft({ id: p.id, name: p.name, model: p.model, base_url: p.base_url, api_key: '' });
    }
  };

  const applyPreset = (presetId) => {
    const preset = API_PRESETS.find(p => p.id === presetId);
    if (!preset) return;
    setDraft(s => ({ ...s, name: s.name || preset.name, model: preset.model, base_url: preset.base_url, _preset: presetId }));
  };

  const save = async () => {
    if (!draft.name || !draft.model || !draft.base_url) {
      alert('名称 / 模型 / Base URL 都必填'); return;
    }
    if (!draft.id && !draft.api_key) {
      alert('新建 profile 必须填 API key'); return;
    }
    setBusy('save');
    try {
      const r = await fetch('/api/config/api/profile', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(draft),
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error || ('HTTP ' + r.status));
      const newPid = d.id;
      await fetchAll();
      setSelectedPid(newPid);
      const p = (await (await fetch('/api/config/api')).json()).profiles.find(x => x.id === newPid);
      if (p) setDraft({ id: p.id, name: p.name, model: p.model, base_url: p.base_url, api_key: '' });
      setAppliedAt(new Date().toLocaleString('zh-CN', { hour12: false }) + ' · 已保存');
    } catch (e) {
      alert('保存失败: ' + e.message);
    } finally { setBusy(null); }
  };

  const activate = async () => {
    if (!draft.id) { alert('请先保存这个 profile 再激活'); return; }
    const p = data.profiles.find(x => x.id === draft.id);
    if (p && !p.has_key) { alert('该 profile 没有 API key,无法激活'); return; }
    setBusy('activate');
    try {
      const r = await fetch('/api/config/api/active', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: draft.id }),
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error || ('HTTP ' + r.status));
      await fetchAll();
      setAppliedAt(new Date().toLocaleString('zh-CN', { hour12: false }) + ' · 已激活并生效');
    } catch (e) {
      alert('激活失败: ' + e.message);
    } finally { setBusy(null); }
  };

  const removeProfile = async () => {
    if (!draft.id) return;
    if (!window.confirm(`删除 profile「${draft.name}」?`)) return;
    setBusy('delete');
    try {
      const r = await fetch(`/api/config/api/profile/${encodeURIComponent(draft.id)}/delete`, { method: 'POST' });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error || ('HTTP ' + r.status));
      await fetchAll();
    } catch (e) {
      alert('删除失败: ' + e.message);
    } finally { setBusy(null); }
  };

  const test = async () => {
    setBusy('test'); setTestStatus('pending');
    try {
      const body = draft.api_key
        ? { model: draft.model, base_url: draft.base_url, api_key: draft.api_key }
        : (draft.id ? { id: draft.id } : null);
      if (!body) { alert('请填 API key 或先保存'); setBusy(null); setTestStatus(null); return; }
      const r = await fetch('/api/config/api/test', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
      });
      const d = await r.json();
      if (d.ok) setTestStatus({ ok: true, latency_ms: d.latency_ms, sample: d.sample });
      else setTestStatus({ ok: false, error: d.error || '未知错误' });
    } catch (e) {
      setTestStatus({ ok: false, error: e.message });
    } finally { setBusy(null); }
  };

  const clearActive = async () => {
    if (!window.confirm('清空当前激活,回退到环境变量(env)配置?')) return;
    setBusy('clear');
    try {
      const r = await fetch('/api/config/api/active', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: null }),
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error || ('HTTP ' + r.status));
      await fetchAll();
      setAppliedAt(new Date().toLocaleString('zh-CN', { hour12: false }) + ' · 已回退到 env');
    } catch (e) {
      alert('失败: ' + e.message);
    } finally { setBusy(null); }
  };

  if (loadErr) {
    return (
      <main className="oc-main">
        <div style={{ padding: 20, color: '#8B4A4A', fontSize: 13 }}>
          配置加载失败: {loadErr} · <a onClick={fetchAll} style={{ cursor: 'pointer', textDecoration: 'underline' }}>重试</a>
        </div>
      </main>
    );
  }
  if (!data) {
    return <main className="oc-main"><div style={{ padding: 40, textAlign: 'center', color: 'var(--ink-3)' }}>加载配置…</div></main>;
  }

  const eff = data.current_effective || {};
  const isNew = draft && !draft.id;
  const isActiveSelected = draft && draft.id && data.active === draft.id;

  return (
    <main className="oc-main">
      <ConsolePageHd
        title="配置"
        sub={<>系统运行参数 —— 脱水/打标 API、向量化模型、回忆策略。修改 API profile 即时生效,会写入持久盘的 runtime_config.json。</>}
        rightSlot={
          <>
            <div className="oc-status-pill ok">{eff.api_available ? '运行中' : '未配置'}</div>
            <div className="ob-page-counter">{appliedAt || '—'}</div>
          </>
        }
      />

      {/* === 脱水/打标 API === */}
      <ConsoleCard label="脱水 / 打标 API" sub="负责把对话压缩成记忆条目、抽取标签与摘要。多组 profile 可保存,一键切换。">
        {/* Profile 切换器 */}
        <div className="oc-field">
          <div className="oc-field-label">PROFILE</div>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', flex: 1 }}>
            <select
              className="oc-select"
              value={selectedPid || '__new__'}
              onChange={(e) => switchSelected(e.target.value)}
              style={{ flex: 1 }}
            >
              {data.profiles.map(p => (
                <option key={p.id} value={p.id}>
                  {p.name}{data.active === p.id ? ' · 激活中' : ''}{!p.has_key ? ' · 无 key' : ''}
                </option>
              ))}
              <option value="__new__">+ 新建 profile…</option>
            </select>
            {draft && draft.id && !isActiveSelected && (
              <button className="oc-btn oc-btn-ghost" onClick={removeProfile} disabled={busy === 'delete'} style={{ flexShrink: 0, color: '#8B4A4A' }}>
                删除
              </button>
            )}
          </div>
        </div>

        {/* 模板下拉(只在新建时显示) */}
        {isNew && (
          <div className="oc-field">
            <div className="oc-field-label">模板</div>
            <select
              className="oc-select"
              value={draft._preset || ''}
              onChange={(e) => applyPreset(e.target.value)}
            >
              <option value="">— 选模板自动填 model + base_url —</option>
              {API_PRESETS.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
          </div>
        )}

        {draft && (
          <>
            <div className="oc-field">
              <div className="oc-field-label">名称</div>
              <input
                className="oc-input"
                value={draft.name}
                onChange={(e) => setDraft(s => ({ ...s, name: e.target.value }))}
                placeholder="比如 'Claude Sonnet 主力'"
              />
            </div>
            <div className="oc-field">
              <div className="oc-field-label">MODEL</div>
              <input
                className="oc-input oc-input-mono"
                value={draft.model}
                onChange={(e) => setDraft(s => ({ ...s, model: e.target.value }))}
              />
            </div>
            <div className="oc-field">
              <div className="oc-field-label">BASE URL</div>
              <input
                className="oc-input oc-input-mono"
                value={draft.base_url}
                onChange={(e) => setDraft(s => ({ ...s, base_url: e.target.value }))}
              />
            </div>
            <div className="oc-field">
              <div className="oc-field-label">API KEY</div>
              <div style={{ display: 'flex', gap: 8, alignItems: 'center', flex: 1 }}>
                <input
                  className="oc-input oc-input-mono"
                  type={showKey ? 'text' : 'password'}
                  value={draft.api_key}
                  placeholder={draft.id ? '留空 = 不修改 (当前已存)' : 'sk-...'}
                  onChange={(e) => setDraft(s => ({ ...s, api_key: e.target.value }))}
                  style={{ flex: 1 }}
                />
                <button className="oc-btn oc-btn-ghost" onClick={() => setShowKey(s => !s)} style={{ flexShrink: 0 }}>
                  {showKey ? '隐藏' : '显示'}
                </button>
              </div>
            </div>
            <div className="oc-field-help" style={{ paddingLeft: 126, marginTop: -6 }}>
              {draft.id ? '留空不替换;持久化在 runtime_config.json' : '新建必填;持久化在 runtime_config.json'}
            </div>

            {/* 测试结果展示行 */}
            {testStatus && testStatus !== 'pending' && (
              <div className="oc-field" style={{ alignItems: 'flex-start' }}>
                <div className="oc-field-label" style={{ marginTop: 4 }}>测试</div>
                <div style={{ flex: 1, fontFamily: 'var(--mono)', fontSize: 12, lineHeight: 1.6 }}>
                  {testStatus.ok ? (
                    <span style={{ color: '#5b8a5b' }}>✓ 连通 · {testStatus.latency_ms}ms{testStatus.sample ? ` · "${testStatus.sample}"` : ''}</span>
                  ) : (
                    <span style={{ color: '#8B4A4A', wordBreak: 'break-word' }}>✕ 失败 · {testStatus.error}</span>
                  )}
                </div>
              </div>
            )}
          </>
        )}

        {/* 操作按钮行 */}
        {draft && (
          <div className="oc-btn-row" style={{ marginTop: 14 }}>
            <button className="oc-btn oc-btn-ghost" onClick={test} disabled={busy === 'test'}>
              {busy === 'test' ? '⌛ 测试中…' : '⚡ 测试连接'}
            </button>
            <button className="oc-btn" onClick={save} disabled={busy === 'save'}>
              {busy === 'save' ? '⌛ 保存中…' : (isNew ? '创建 profile' : '保存修改')}
            </button>
            <button
              className="oc-btn oc-btn-primary"
              onClick={activate}
              disabled={busy === 'activate' || isNew || isActiveSelected}
              style={{ marginLeft: 'auto' }}
              title={isNew ? '先保存再激活' : isActiveSelected ? '当前已激活' : '切换为当前生效配置'}
            >
              {busy === 'activate' ? '⌛ 激活中…' : (isActiveSelected ? '✓ 已激活' : '激活此 profile')}
            </button>
          </div>
        )}

        {/* 当前生效信息条(简洁,放在卡底部) */}
        <div style={{
          marginTop: 14, padding: '10px 12px', background: 'var(--paper-2)',
          borderRadius: 6, border: '0.5px solid var(--line-2)',
          fontSize: 11.5, fontFamily: 'var(--mono)', color: 'var(--ink-3)',
          display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap',
        }}>
          <span style={{ color: 'var(--ink-4)' }}>当前生效:</span>
          <span style={{ color: 'var(--ink-2)' }}>
            {data.active ? (data.profiles.find(x => x.id === data.active)?.name || data.active) : '环境变量(env)'}
          </span>
          <span style={{ color: 'var(--ink-4)' }}>·</span>
          <span style={{ color: 'var(--ink-2)' }}>{eff.model || '—'}</span>
          <span style={{ color: 'var(--ink-4)' }}>·</span>
          <span style={{ color: 'var(--ink-3)' }}>{eff.api_key_mask || '(未设置)'}</span>
          {data.active && (
            <button className="oc-btn oc-btn-ghost" onClick={clearActive} disabled={busy === 'clear'} style={{ marginLeft: 'auto', fontSize: 10.5, padding: '3px 9px' }}>
              {busy === 'clear' ? '⌛' : '↺ 回退到 env'}
            </button>
          )}
        </div>
      </ConsoleCard>

      {/* === 向量化 Embedding === */}
      <ConsoleCard label="向量化 Embedding" sub="为每条记忆生成稠密向量,用于语义检索与相似聚合。">
        <div className="oc-field">
          <div className="oc-field-label">启用</div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <div className="oc-switch on" />
            <span style={{ fontSize: 12, color: 'var(--ink-3)', fontFamily: 'var(--mono)' }}>已开启 · 新写入会自动 embed</span>
          </div>
        </div>
        <div className="oc-field">
          <div className="oc-field-label">MODEL</div>
          <input className="oc-input oc-input-mono" value="gemini-embedding-001" disabled />
        </div>
        <div className="oc-field">
          <div className="oc-field-label">维度</div>
          <input className="oc-input oc-input-mono" type="number" value={768} disabled />
        </div>
        <div className="oc-field">
          <div className="oc-field-label">批量大小</div>
          <input className="oc-input oc-input-mono" type="number" value={32} disabled />
        </div>
      </ConsoleCard>

      {/* === 回忆 / 合并策略 === */}
      <ConsoleCard label="回忆 / 合并策略" sub="如何唤起与合并相似记忆。">
        <div className="oc-field">
          <div className="oc-field-label">合并阈值</div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <input type="range" min={0} max={100} step={1} value={75} disabled className="oc-slider" style={{ flex: 1 }} />
            <input className="oc-input oc-input-mono" style={{ width: 80 }} type="number" value={75} disabled />
          </div>
        </div>
        <div className="oc-field-help" style={{ paddingLeft: 126, marginTop: -8 }}>
          0–100 · 越高越严格(少合并),越低越松(频繁合并)
        </div>
        <div className="oc-field">
          <div className="oc-field-label">夜间合并窗口</div>
          <input className="oc-input oc-input-mono" value="02:00–04:00" disabled />
        </div>
        <div className="oc-field-help" style={{ paddingLeft: 126, marginTop: -6 }}>
          每天此时间段内执行睡眠式合并,建议占空闲段
        </div>
        <div className="oc-field">
          <div className="oc-field-label">Max Recall</div>
          <input className="oc-input oc-input-mono" type="number" value={8} disabled />
        </div>
        <div className="oc-field-help" style={{ paddingLeft: 126, marginTop: -6 }}>
          每次 Breath 唤起的最大记忆条数(top N)
        </div>
        <div className="oc-field">
          <div className="oc-field-label">钉决策略</div>
          <select className="oc-select" value="manual" disabled>
            <option value="manual">仅手动钉决</option>
          </select>
        </div>
        <div className="oc-field">
          <div className="oc-field-label">自动内化</div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <div className="oc-switch on" />
            <span style={{ fontSize: 12, color: 'var(--ink-3)', fontFamily: 'var(--mono)' }}>激活强度高 + 重复唤起 → 自动标记"已内化"</span>
          </div>
        </div>
      </ConsoleCard>

      {/* === 系统信息 === */}
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
          <code style={{ fontFamily: 'var(--mono)', fontSize: 12, color: 'var(--ink-2)' }}>runtime_config.json · config.yaml</code>
        </div>
        <div className="oc-field">
          <div className="oc-field-label">运行版本</div>
          <code style={{ fontFamily: 'var(--mono)', fontSize: 12, color: 'var(--ink-2)' }}>ombre-brain · 2026-04-28 build</code>
        </div>
      </ConsoleCard>
    </main>
  );
}

window.ConfigPage = ConfigPage;
