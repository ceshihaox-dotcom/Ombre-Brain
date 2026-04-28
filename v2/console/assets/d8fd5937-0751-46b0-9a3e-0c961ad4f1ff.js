// console-config.jsx —— API profile 管理 + 一键切换
// 持久化:后端 {buckets_dir}/runtime_config.json
// 加载链:runtime_config.json > env vars > config.yaml > 默认

const { useState: ccS, useEffect: ccE, useMemo: ccM } = React;

// 预置模板:点"+ 新建"时可选,自动填 model/base_url
const API_PRESETS = [
  { id: 'deepseek',     name: 'DeepSeek Chat',         model: 'deepseek-chat',       base_url: 'https://api.deepseek.com/v1' },
  { id: 'gemini-flash', name: 'Gemini 2.5 Flash',      model: 'gemini-2.5-flash',    base_url: 'https://generativelanguage.googleapis.com/v1beta/openai/' },
  { id: 'gemini-pro',   name: 'Gemini 2.5 Pro',        model: 'gemini-2.5-pro',      base_url: 'https://generativelanguage.googleapis.com/v1beta/openai/' },
  { id: 'claude-haiku', name: 'Claude Haiku 4.5',      model: 'claude-haiku-4-5',    base_url: 'https://api.anthropic.com/v1/' },
  { id: 'claude-sonnet',name: 'Claude Sonnet 4.6',     model: 'claude-sonnet-4-6',   base_url: 'https://api.anthropic.com/v1/' },
  { id: 'qwen3',        name: 'Qwen3 (DashScope)',     model: 'qwen-max',            base_url: 'https://dashscope.aliyuncs.com/compatible-mode/v1' },
];

function ConfigPage() {
  const [data, setData] = ccS(null);                  // {active, profiles, current_effective}
  const [loading, setLoading] = ccS(true);
  const [error, setError] = ccS(null);
  const [editing, setEditing] = ccS(null);            // null | { id?, name, model, base_url, api_key } 表单 draft
  const [testing, setTesting] = ccS({});              // { [pid]: 'pending' | 'ok' | 'fail' }
  const [testInfo, setTestInfo] = ccS({});            // { [pid]: { latency_ms, sample, error } }
  const [switching, setSwitching] = ccS(null);        // pid 正在切换中
  const [showKey, setShowKey] = ccS(false);

  const fetchAll = async () => {
    try {
      setError(null);
      const r = await fetch('/api/config/api');
      if (!r.ok) throw new Error('HTTP ' + r.status);
      const d = await r.json();
      setData(d);
      setLoading(false);
    } catch (e) {
      setError(e.message || String(e));
      setLoading(false);
    }
  };

  ccE(() => { fetchAll(); }, []);

  const startNew = () => {
    setEditing({ id: '', name: '', model: '', base_url: '', api_key: '', _preset: '' });
    setShowKey(false);
  };
  const startEdit = (p) => {
    setEditing({ id: p.id, name: p.name, model: p.model, base_url: p.base_url, api_key: '', _preset: '' });
    setShowKey(false);
  };
  const cancelEdit = () => setEditing(null);

  const applyPreset = (presetId) => {
    const preset = API_PRESETS.find(p => p.id === presetId);
    if (!preset) return;
    setEditing(s => ({ ...s, name: s.name || preset.name, model: preset.model, base_url: preset.base_url, _preset: presetId }));
  };

  const saveProfile = async () => {
    if (!editing.name || !editing.model || !editing.base_url) {
      alert('名称 / 模型 / Base URL 都必填');
      return;
    }
    const isNew = !editing.id;
    if (isNew && !editing.api_key) {
      alert('新建 profile 必须填 API key');
      return;
    }
    try {
      const r = await fetch('/api/config/api/profile', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(editing),
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error || ('HTTP ' + r.status));
      await fetchAll();
      setEditing(null);
    } catch (e) {
      alert('保存失败: ' + e.message);
    }
  };

  const deleteProfile = async (pid, name) => {
    if (!window.confirm(`删除 profile「${name}」?\n如果它是当前激活的,会回退到环境变量配置。`)) return;
    try {
      const r = await fetch(`/api/config/api/profile/${encodeURIComponent(pid)}/delete`, { method: 'POST' });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error || ('HTTP ' + r.status));
      await fetchAll();
    } catch (e) {
      alert('删除失败: ' + e.message);
    }
  };

  const setActive = async (pid) => {
    const p = data.profiles.find(x => x.id === pid);
    if (p && !p.has_key) {
      alert('该 profile 没有 API key,无法激活。请先编辑填入 key。');
      return;
    }
    setSwitching(pid);
    try {
      const r = await fetch('/api/config/api/active', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: pid }),
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error || ('HTTP ' + r.status));
      await fetchAll();
    } catch (e) {
      alert('切换失败: ' + e.message);
    } finally {
      setSwitching(null);
    }
  };

  const clearActive = async () => {
    if (!window.confirm('回退到环境变量(env)配置?\n会清掉当前激活,使用 OMBRE_API_KEY / OMBRE_BASE_URL / OMBRE_MODEL。')) return;
    setSwitching('__clear__');
    try {
      const r = await fetch('/api/config/api/active', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: null }),
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error || ('HTTP ' + r.status));
      await fetchAll();
    } catch (e) {
      alert('清除失败: ' + e.message);
    } finally {
      setSwitching(null);
    }
  };

  const testProfile = async (pid) => {
    setTesting(t => ({ ...t, [pid]: 'pending' }));
    setTestInfo(i => ({ ...i, [pid]: null }));
    try {
      const r = await fetch('/api/config/api/test', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: pid }),
      });
      const d = await r.json();
      if (d.ok) {
        setTesting(t => ({ ...t, [pid]: 'ok' }));
        setTestInfo(i => ({ ...i, [pid]: { latency_ms: d.latency_ms, sample: d.sample } }));
      } else {
        setTesting(t => ({ ...t, [pid]: 'fail' }));
        setTestInfo(i => ({ ...i, [pid]: { error: d.error || '未知错误' } }));
      }
    } catch (e) {
      setTesting(t => ({ ...t, [pid]: 'fail' }));
      setTestInfo(i => ({ ...i, [pid]: { error: e.message } }));
    }
  };

  const testDraft = async () => {
    if (!editing) return;
    if (!editing.api_key) {
      alert('请先填 API key 再测试');
      return;
    }
    setTesting(t => ({ ...t, __draft__: 'pending' }));
    setTestInfo(i => ({ ...i, __draft__: null }));
    try {
      const r = await fetch('/api/config/api/test', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ model: editing.model, base_url: editing.base_url, api_key: editing.api_key }),
      });
      const d = await r.json();
      if (d.ok) {
        setTesting(t => ({ ...t, __draft__: 'ok' }));
        setTestInfo(i => ({ ...i, __draft__: { latency_ms: d.latency_ms, sample: d.sample } }));
      } else {
        setTesting(t => ({ ...t, __draft__: 'fail' }));
        setTestInfo(i => ({ ...i, __draft__: { error: d.error || '未知错误' } }));
      }
    } catch (e) {
      setTesting(t => ({ ...t, __draft__: 'fail' }));
      setTestInfo(i => ({ ...i, __draft__: { error: e.message } }));
    }
  };

  if (loading) {
    return (
      <main className="oc-main">
        <div style={{ padding: 40, textAlign: 'center', color: 'var(--ink-3)' }}>加载配置…</div>
      </main>
    );
  }

  if (error) {
    return (
      <main className="oc-main">
        <div style={{ padding: 20, color: '#8B4A4A', fontSize: 13 }}>
          配置加载失败: {error} · <a onClick={fetchAll} style={{ cursor: 'pointer', textDecoration: 'underline' }}>重试</a>
        </div>
      </main>
    );
  }

  const eff = data.current_effective || {};
  const activeProfile = data.profiles.find(p => p.id === data.active);

  return (
    <main className="oc-main">
      <ConsolePageHd
        title="配置"
        sub={<>API profile 管理 —— 保存多组配置,一键切换。导入用 Claude Sonnet,日常用 Gemini Flash 都很方便。修改即时生效,不用动 Render env。</>}
        rightSlot={
          <div className="oc-status-pill ok">{eff.api_available ? '运行中' : '未配置'}</div>
        }
      />

      {/* 当前生效 — 摘要卡 */}
      <ConsoleCard label="当前生效" sub={data.active ? `Profile: ${activeProfile?.name || data.active}` : '回退到环境变量(env)配置'}>
        <div style={{ display: 'grid', gridTemplateColumns: '120px 1fr', gap: '8px 14px', alignItems: 'baseline', fontSize: 13 }}>
          <div style={{ color: 'var(--ink-4)', fontFamily: 'var(--mono)', fontSize: 11 }}>MODEL</div>
          <div style={{ fontFamily: 'var(--mono)', color: 'var(--ink)' }}>{eff.model || '—'}</div>
          <div style={{ color: 'var(--ink-4)', fontFamily: 'var(--mono)', fontSize: 11 }}>BASE URL</div>
          <div style={{ fontFamily: 'var(--mono)', color: 'var(--ink-2)', fontSize: 12, overflow: 'hidden', textOverflow: 'ellipsis' }}>{eff.base_url || '—'}</div>
          <div style={{ color: 'var(--ink-4)', fontFamily: 'var(--mono)', fontSize: 11 }}>API KEY</div>
          <div style={{ fontFamily: 'var(--mono)', color: eff.api_available ? 'var(--ink-2)' : '#8B4A4A', fontSize: 12 }}>
            {eff.api_key_mask || '(未设置)'}
          </div>
        </div>
        {data.active && (
          <div style={{ marginTop: 12 }}>
            <button className="oc-btn oc-btn-ghost" onClick={clearActive} disabled={switching === '__clear__'} style={{ fontSize: 11 }}>
              {switching === '__clear__' ? '⌛ 切换中…' : '↺ 回退到环境变量配置'}
            </button>
          </div>
        )}
      </ConsoleCard>

      {/* Profile 列表 */}
      <ConsoleCard
        label="API Profiles"
        sub={`${data.profiles.length} 个 profile · 点左侧 ◉ 切换激活`}
      >
        {!editing && (
          <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 10 }}>
            <button className="oc-btn oc-btn-primary" onClick={startNew} style={{ fontSize: 11, padding: '5px 12px' }}>+ 新建 profile</button>
          </div>
        )}
        {data.profiles.length === 0 && !editing && (
          <div style={{ padding: '24px 0', textAlign: 'center', color: 'var(--ink-4)', fontStyle: 'italic', fontSize: 12 }}>
            还没有保存过任何 profile · 点右上角"+ 新建 profile"开始
          </div>
        )}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {data.profiles.map(p => {
            const isActive = data.active === p.id;
            const t = testing[p.id];
            const ti = testInfo[p.id];
            return (
              <div
                key={p.id}
                style={{
                  padding: '12px 14px',
                  background: isActive ? 'color-mix(in oklab, var(--accent) 5%, var(--paper))' : 'var(--paper)',
                  border: '0.5px solid ' + (isActive ? 'var(--accent)' : 'var(--line-2)'),
                  borderRadius: 8,
                  display: 'grid',
                  gridTemplateColumns: '24px 1fr auto',
                  gap: 12,
                  alignItems: 'center',
                }}
              >
                {/* 激活 radio */}
                <button
                  type="button"
                  onClick={() => !isActive && setActive(p.id)}
                  disabled={switching !== null || isActive}
                  title={isActive ? '当前激活' : '点击激活'}
                  style={{
                    width: 16, height: 16, borderRadius: '50%',
                    border: '1.5px solid ' + (isActive ? 'var(--accent)' : 'var(--ink-4)'),
                    background: isActive ? 'var(--accent)' : 'transparent',
                    cursor: isActive ? 'default' : 'pointer',
                    padding: 0,
                    boxShadow: isActive ? '0 0 0 2px color-mix(in oklab, var(--accent) 18%, transparent)' : 'none',
                  }}
                />
                <div style={{ minWidth: 0 }}>
                  <div style={{ fontFamily: 'var(--serif)', fontSize: 14, fontStyle: 'italic', color: 'var(--ink)', fontWeight: 500 }}>
                    {p.name}
                    {isActive && <span style={{ marginLeft: 8, fontSize: 10, fontFamily: 'var(--mono)', color: 'var(--accent)', letterSpacing: '0.04em' }}>· 激活中</span>}
                  </div>
                  <div style={{ fontFamily: 'var(--mono)', fontSize: 11, color: 'var(--ink-3)', marginTop: 3, lineHeight: 1.6 }}>
                    {p.model} · {p.base_url} · key {p.has_key ? p.api_key_mask : <span style={{ color: '#8B4A4A' }}>未设置</span>}
                  </div>
                  {/* 测试结果展示 */}
                  {t === 'ok' && ti && (
                    <div style={{ marginTop: 4, fontSize: 10.5, color: '#5b8a5b', fontFamily: 'var(--mono)' }}>
                      ✓ 连通 · {ti.latency_ms}ms{ti.sample ? ` · "${ti.sample}"` : ''}
                    </div>
                  )}
                  {t === 'fail' && ti && (
                    <div style={{ marginTop: 4, fontSize: 10.5, color: '#8B4A4A', fontFamily: 'var(--mono)', wordBreak: 'break-word' }}>
                      ✕ 失败 · {ti.error}
                    </div>
                  )}
                </div>
                <div style={{ display: 'flex', gap: 4 }}>
                  <button
                    className="oc-btn oc-btn-ghost"
                    onClick={() => testProfile(p.id)}
                    disabled={t === 'pending' || !p.has_key}
                    style={{ fontSize: 10.5, padding: '3px 9px' }}
                    title={p.has_key ? '发送一个 ping 请求测试连通' : '没填 key 无法测试'}
                  >
                    {t === 'pending' ? '⌛' : '⚡ 测试'}
                  </button>
                  <button
                    className="oc-btn oc-btn-ghost"
                    onClick={() => startEdit(p)}
                    style={{ fontSize: 10.5, padding: '3px 9px' }}
                  >编辑</button>
                  <button
                    className="oc-btn oc-btn-ghost"
                    onClick={() => deleteProfile(p.id, p.name)}
                    style={{ fontSize: 10.5, padding: '3px 9px', color: '#8B4A4A' }}
                  >删除</button>
                </div>
              </div>
            );
          })}
        </div>

        {/* 编辑表单 — 内联展开 */}
        {editing && (() => {
          const td = testing.__draft__;
          const tdi = testInfo.__draft__;
          return (
            <div style={{
              marginTop: 14,
              padding: '14px 16px',
              background: 'var(--paper-2)',
              border: '0.5px dashed var(--accent)',
              borderRadius: 8,
            }}>
              <div style={{ fontFamily: 'var(--serif)', fontStyle: 'italic', fontSize: 14, color: 'var(--ink)', marginBottom: 10 }}>
                {editing.id ? '编辑 profile' : '新建 profile'}
              </div>
              {!editing.id && (
                <div className="oc-field">
                  <div className="oc-field-label">从模板</div>
                  <select
                    className="oc-select"
                    value={editing._preset || ''}
                    onChange={(e) => applyPreset(e.target.value)}
                  >
                    <option value="">— 选模板自动填 model + base_url —</option>
                    {API_PRESETS.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
                  </select>
                </div>
              )}
              <div className="oc-field">
                <div className="oc-field-label">名称</div>
                <input
                  className="oc-input"
                  placeholder="比如 'Claude Sonnet 主力'"
                  value={editing.name}
                  onChange={(e) => setEditing(s => ({ ...s, name: e.target.value }))}
                />
              </div>
              <div className="oc-field">
                <div className="oc-field-label">Model</div>
                <input
                  className="oc-input oc-input-mono"
                  placeholder="claude-sonnet-4-6"
                  value={editing.model}
                  onChange={(e) => setEditing(s => ({ ...s, model: e.target.value }))}
                />
              </div>
              <div className="oc-field">
                <div className="oc-field-label">Base URL</div>
                <input
                  className="oc-input oc-input-mono"
                  placeholder="https://api.anthropic.com/v1/"
                  value={editing.base_url}
                  onChange={(e) => setEditing(s => ({ ...s, base_url: e.target.value }))}
                />
              </div>
              <div className="oc-field">
                <div className="oc-field-label">API Key</div>
                <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                  <input
                    className="oc-input oc-input-mono"
                    type={showKey ? 'text' : 'password'}
                    placeholder={editing.id ? '留空 = 不修改' : 'sk-ant-...'}
                    value={editing.api_key}
                    onChange={(e) => setEditing(s => ({ ...s, api_key: e.target.value }))}
                  />
                  <button
                    className="oc-btn oc-btn-ghost"
                    onClick={() => setShowKey(s => !s)}
                    style={{ fontSize: 11, padding: '5px 10px', flexShrink: 0 }}
                    title={showKey ? '隐藏' : '显示'}
                  >{showKey ? '隐藏' : '显示'}</button>
                </div>
              </div>

              {/* 测试结果 */}
              {td === 'ok' && tdi && (
                <div style={{ padding: '8px 12px', marginTop: 8, fontSize: 11.5, color: '#5b8a5b', fontFamily: 'var(--mono)', background: 'rgba(91,138,91,0.06)', border: '0.5px solid rgba(91,138,91,0.25)', borderRadius: 5 }}>
                  ✓ 连通成功 · {tdi.latency_ms}ms{tdi.sample ? ` · 返回: "${tdi.sample}"` : ''}
                </div>
              )}
              {td === 'fail' && tdi && (
                <div style={{ padding: '8px 12px', marginTop: 8, fontSize: 11.5, color: '#8B4A4A', fontFamily: 'var(--mono)', background: 'rgba(139,74,74,0.06)', border: '0.5px solid rgba(139,74,74,0.25)', borderRadius: 5, wordBreak: 'break-word' }}>
                  ✕ 测试失败 · {tdi.error}
                </div>
              )}

              <div className="oc-btn-row" style={{ marginTop: 12 }}>
                <button
                  className="oc-btn oc-btn-ghost"
                  onClick={testDraft}
                  disabled={td === 'pending' || !editing.api_key}
                  title={!editing.api_key ? '需要填 API key 才能测试' : '直接用当前表单值测连通'}
                >
                  {td === 'pending' ? '⌛ 测试中…' : '⚡ 测试连接'}
                </button>
                <button className="oc-btn oc-btn-ghost" onClick={cancelEdit}>取消</button>
                <button className="oc-btn oc-btn-primary" onClick={saveProfile} style={{ marginLeft: 'auto' }}>
                  {editing.id ? '保存修改' : '创建 profile'}
                </button>
              </div>
              <div style={{ marginTop: 8, fontSize: 10.5, color: 'var(--ink-4)', fontFamily: 'var(--mono)' }}>
                {editing.id
                  ? '保存后不会自动激活,需要点列表里的 ◉ 切换'
                  : '创建后不会自动激活,需要点列表里的 ◉ 切换;建议先测试连接再激活'}
              </div>
            </div>
          );
        })()}
      </ConsoleCard>

      {/* 系统信息 */}
      <ConsoleCard label="系统信息" sub="只读 · 用于诊断">
        <div className="oc-field">
          <div className="oc-field-label">Embedding</div>
          <code style={{ fontFamily: 'var(--mono)', fontSize: 12, color: 'var(--ink-2)' }}>
            走独立的 OMBRE_EMBED_API_KEY / OMBRE_EMBED_BASE_URL,不在此切
          </code>
        </div>
        <div className="oc-field">
          <div className="oc-field-label">配置文件</div>
          <code style={{ fontFamily: 'var(--mono)', fontSize: 12, color: 'var(--ink-2)' }}>
            runtime_config.json (持久盘) · config.yaml (启动) · 环境变量 (兜底)
          </code>
        </div>
      </ConsoleCard>
    </main>
  );
}

window.ConfigPage = ConfigPage;
