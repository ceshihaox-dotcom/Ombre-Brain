// console-config.jsx —— 配置页:profile 列表风格 + 策略参数真接通

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
  const [data, setData] = ccS(null);
  const [loadErr, setLoadErr] = ccS(null);
  const [editing, setEditing] = ccS(null);            // null | { id?, name, model, base_url, api_key, _preset }
  const [testing, setTesting] = ccS({});              // pid → 'pending'|'ok'|'fail'
  const [testInfo, setTestInfo] = ccS({});            // pid → { latency_ms, sample, error }
  const [switching, setSwitching] = ccS(null);
  const [showKey, setShowKey] = ccS(false);
  const [appliedAt, setAppliedAt] = ccS('');

  // 策略参数(merge_threshold / max_recall)
  const [strategy, setStrategy] = ccS({ merge_threshold: 75, max_recall: 5 });
  const [strategySaving, setStrategySaving] = ccS(false);

  // 权重配置 (decay engine 参数)
  const [decayCfg, setDecayCfg] = ccS(null);     // { current, defaults, schema }
  const [decaySaving, setDecaySaving] = ccS(false);
  const [decayResetting, setDecayResetting] = ccS(false);

  // Prompt 配置 (LLM system prompt 编辑)
  const [promptCfg, setPromptCfg] = ccS(null);   // { current, defaults, overridden, schema }
  const [promptDraft, setPromptDraft] = ccS({}); // key → 编辑中的草稿(未保存)
  const [promptSaving, setPromptSaving] = ccS({}); // key → bool
  const [promptOpen, setPromptOpen] = ccS({});   // key → 折叠展开
  const [promptResetAllBusy, setPromptResetAllBusy] = ccS(false);

  // 检索打分微调 (title 命中加分 / 关键词优先排序 / dryrun 日志)
  const [scoringCfg, setScoringCfg] = ccS(null);     // { current, defaults, schema }
  const [scoringSaving, setScoringSaving] = ccS(false);
  const [scoringResetting, setScoringResetting] = ccS(false);

  // 记忆命中频次统计 (反向看哪条记忆经常被检索)
  const [hitStats, setHitStats] = ccS(null);         // { total_searches, hit_buckets, zero_buckets, items: [...] }
  const [hitStatsLoading, setHitStatsLoading] = ccS(false);
  const [hitView, setHitView] = ccS('hot');          // 'hot' 高频在前 / 'cold' 冷门(含从未命中)在前

  // 最近搜索追溯 ("我这次发消息浮现了哪些"用)
  const [recentSearches, setRecentSearches] = ccS(null);   // { items: [{ts, query, top:[...]}] }
  const [recentLoading, setRecentLoading] = ccS(false);
  const [recentOpen, setRecentOpen] = ccS({});             // ts → bool: 展开第 N 条详情

  // 即时模拟 (输入一段话 → dry-run 看会检索/浮现哪些记忆, 不记统计)
  const [simQuery, setSimQuery] = ccS('');
  const [simResult, setSimResult] = ccS(null);             // { keyword_hits:[...], vector_hits:[...] } 或 { error }
  const [simLoading, setSimLoading] = ccS(false);

  const fetchAll = async () => {
    try {
      const r = await fetch('/api/config/api');
      if (!r.ok) throw new Error('HTTP ' + r.status);
      setData(await r.json());
    } catch (e) {
      setLoadErr(e.message || String(e));
    }
  };
  const fetchStrategy = async () => {
    try {
      const r = await fetch('/api/config/strategy');
      if (r.ok) setStrategy(await r.json());
    } catch (e) { /* 沉默 */ }
  };
  const fetchDecay = async () => {
    try {
      const r = await fetch('/api/decay-config');
      if (r.ok) setDecayCfg(await r.json());
    } catch (e) { /* 沉默 */ }
  };
  const fetchPrompts = async () => {
    try {
      const r = await fetch('/api/prompts-config');
      if (r.ok) {
        const d = await r.json();
        setPromptCfg(d);
        setPromptDraft({});  // 拉到新数据 → 清掉所有草稿
      }
    } catch (e) { /* 沉默 */ }
  };
  const fetchScoring = async () => {
    try {
      const r = await fetch('/api/scoring-config');
      if (r.ok) setScoringCfg(await r.json());
    } catch (e) { /* 沉默 */ }
  };
  const fetchHitStats = async (view) => {
    const mode = view || hitView;
    setHitStatsLoading(true);
    try {
      // 冷门视图: 并入从未命中的桶(count 0) + 排除钉选/永久参考/feel/已消化(它们 ×0 是预期) + 升序
      const qs = mode === 'cold'
        ? 'limit=300&include_zero=1&exclude_gated=1&order=asc'
        : 'limit=50&order=desc';
      const r = await fetch('/api/hit-stats?' + qs);
      if (r.ok) setHitStats(await r.json());
    } catch (e) { /* 沉默 */ }
    finally { setHitStatsLoading(false); }
  };
  const switchHitView = (view) => { setHitView(view); fetchHitStats(view); };
  const fetchRecentSearches = async () => {
    setRecentLoading(true);
    try {
      const r = await fetch('/api/recent-searches?limit=10');
      if (r.ok) setRecentSearches(await r.json());
    } catch (e) { /* 沉默 */ }
    finally { setRecentLoading(false); }
  };
  const runSimulate = async () => {
    const q = simQuery.trim();
    if (!q) return;
    setSimLoading(true);
    try {
      // simulate=true → dry-run, 不记命中统计、不进最近搜索; include_vector 顺带看语义召回
      const r = await fetch('/api/search?simulate=true&include_vector=true&limit=20&q=' + encodeURIComponent(q));
      if (r.ok) setSimResult(await r.json());
      else setSimResult({ error: 'HTTP ' + r.status });
    } catch (e) { setSimResult({ error: String(e) }); }
    finally { setSimLoading(false); }
  };
  ccE(() => { fetchAll(); fetchStrategy(); fetchDecay(); fetchPrompts(); fetchScoring(); fetchHitStats(); fetchRecentSearches(); }, []);

  // ─── Prompt 编辑相关 ───
  const isPromptOverridden = (key) => promptCfg && promptCfg.overridden && promptCfg.overridden.includes(key);
  const promptCurrent = (key) => promptDraft[key] !== undefined
    ? promptDraft[key]
    : (promptCfg ? (promptCfg.current[key] || '') : '');
  const promptIsDirty = (key) => {
    if (!promptCfg) return false;
    if (promptDraft[key] === undefined) return false;
    return promptDraft[key] !== promptCfg.current[key];
  };
  const savePrompt = async (key) => {
    if (!promptCfg) return;
    const val = promptDraft[key];
    if (val === undefined) return;
    setPromptSaving(s => ({ ...s, [key]: true }));
    try {
      const r = await fetch('/api/prompts-config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ [key]: val }),
      });
      if (!r.ok) throw new Error('HTTP ' + r.status);
      const d = await r.json();
      setPromptCfg(d);
      setPromptDraft(s => { const n = { ...s }; delete n[key]; return n; });
    } catch (e) {
      alert('保存失败: ' + e.message);
    } finally {
      setPromptSaving(s => ({ ...s, [key]: false }));
    }
  };
  const resetPromptOne = async (key) => {
    if (!promptCfg) return;
    if (!confirm(`恢复「${(promptCfg.schema.find(s => s.key === key) || {}).label || key}」为出厂默认?\n当前编辑/保存的版本会被清掉。`)) return;
    setPromptSaving(s => ({ ...s, [key]: true }));
    try {
      const r = await fetch('/api/prompts-config/reset', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ key }),
      });
      if (!r.ok) throw new Error('HTTP ' + r.status);
      const d = await r.json();
      setPromptCfg(d);
      setPromptDraft(s => { const n = { ...s }; delete n[key]; return n; });
    } catch (e) {
      alert('恢复失败: ' + e.message);
    } finally {
      setPromptSaving(s => ({ ...s, [key]: false }));
    }
  };
  const resetPromptAll = async () => {
    if (!promptCfg) return;
    if (!confirm('全部 prompt 恢复出厂默认?\n所有自定义版本将被清掉。')) return;
    setPromptResetAllBusy(true);
    try {
      const r = await fetch('/api/prompts-config/reset', { method: 'POST' });
      if (!r.ok) throw new Error('HTTP ' + r.status);
      const d = await r.json();
      setPromptCfg(d);
      setPromptDraft({});
    } catch (e) {
      alert('恢复失败: ' + e.message);
    } finally {
      setPromptResetAllBusy(false);
    }
  };
  const alignUpstream = async () => {
    if (!promptCfg) return;
    const upstreamKeys = promptCfg.upstream ? Object.keys(promptCfg.upstream) : [];
    if (upstreamKeys.length === 0) {
      alert('当前后端未提供上游 prompt 数据');
      return;
    }
    const skipped = (promptCfg.schema || []).filter(s => !upstreamKeys.includes(s.key)).map(s => s.label);
    const aligned = (promptCfg.schema || []).filter(s => upstreamKeys.includes(s.key)).map(s => s.label);
    const msg = `把以下 ${aligned.length} 个 prompt 切到原作者(P0luz/Ombre-Brain)版本:\n  · ${aligned.join('\n  · ')}\n\n` +
      (skipped.length > 0 ? `跳过(本项目独创, 上游没有):\n  · ${skipped.join('\n  · ')}\n\n` : '') +
      `这会覆盖你当前任何自定义版本(可以再用 ↺ 全部恢复默认 撤销)。继续?`;
    if (!confirm(msg)) return;
    setPromptResetAllBusy(true);
    try {
      const r = await fetch('/api/prompts-config/align-upstream', { method: 'POST' });
      if (!r.ok) throw new Error('HTTP ' + r.status);
      const d = await r.json();
      if (d.state) setPromptCfg(d.state);
      setPromptDraft({});
      alert(`已对齐上游 ${(d.aligned || []).length} 个 prompt` +
        (d.skipped && d.skipped.length ? ` · 跳过 ${d.skipped.length} 个独创 prompt` : ''));
    } catch (e) {
      alert('对齐失败: ' + e.message);
    } finally {
      setPromptResetAllBusy(false);
    }
  };
  const discardPromptDraft = (key) => {
    setPromptDraft(s => { const n = { ...s }; delete n[key]; return n; });
  };

  // 改单个权重参数: 乐观更新 + POST + 失败回滚
  const updateDecay = async (key, value) => {
    if (!decayCfg) return;
    const old = decayCfg.current[key];
    setDecayCfg(c => ({ ...c, current: { ...c.current, [key]: value } }));
    setDecaySaving(true);
    try {
      const r = await fetch('/api/decay-config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ [key]: value }),
      });
      if (!r.ok) throw new Error('HTTP ' + r.status);
      const d = await r.json();
      if (d && d.current) setDecayCfg(c => ({ ...c, current: d.current }));
    } catch (e) {
      alert('保存失败: ' + e.message);
      setDecayCfg(c => ({ ...c, current: { ...c.current, [key]: old } }));
    } finally {
      setDecaySaving(false);
    }
  };
  const resetDecayAll = async () => {
    if (!decayCfg) return;
    if (!confirm('全部参数恢复出厂默认?')) return;
    setDecayResetting(true);
    try {
      const r = await fetch('/api/decay-config/reset', { method: 'POST' });
      if (!r.ok) throw new Error('HTTP ' + r.status);
      const d = await r.json();
      if (d && d.current) setDecayCfg(c => ({ ...c, current: d.current }));
    } catch (e) {
      alert('恢复失败: ' + e.message);
    } finally {
      setDecayResetting(false);
    }
  };

  // 改单个 scoring 参数 (title_hit_bonus / keyword_first_sort / dryrun_log)
  const updateScoring = async (key, value) => {
    if (!scoringCfg) return;
    const old = scoringCfg.current[key];
    setScoringCfg(c => ({ ...c, current: { ...c.current, [key]: value } }));
    setScoringSaving(true);
    try {
      const r = await fetch('/api/scoring-config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ [key]: value }),
      });
      if (!r.ok) throw new Error('HTTP ' + r.status);
      const d = await r.json();
      if (d && d.current) setScoringCfg(c => ({ ...c, current: d.current }));
    } catch (e) {
      alert('保存失败: ' + e.message);
      setScoringCfg(c => ({ ...c, current: { ...c.current, [key]: old } }));
    } finally {
      setScoringSaving(false);
    }
  };
  const resetScoringAll = async () => {
    if (!scoringCfg) return;
    if (!confirm('打分微调全部关掉(回到默认零影响)?')) return;
    setScoringResetting(true);
    try {
      const r = await fetch('/api/scoring-config/reset', { method: 'POST' });
      if (!r.ok) throw new Error('HTTP ' + r.status);
      const d = await r.json();
      if (d && d.current) setScoringCfg(c => ({ ...c, current: d.current }));
    } catch (e) {
      alert('恢复失败: ' + e.message);
    } finally {
      setScoringResetting(false);
    }
  };

  const startNew = () => { setEditing({ id: '', name: '', model: '', base_url: '', api_key: '', _preset: '' }); setShowKey(false); };
  const startEdit = (p) => { setEditing({ id: p.id, name: p.name, model: p.model, base_url: p.base_url, api_key: '', _preset: '' }); setShowKey(false); };
  const cancelEdit = () => setEditing(null);

  const applyPreset = (presetId) => {
    const preset = API_PRESETS.find(p => p.id === presetId);
    if (!preset) return;
    setEditing(s => ({ ...s, name: s.name || preset.name, model: preset.model, base_url: preset.base_url, _preset: presetId }));
  };

  const saveProfile = async () => {
    if (!editing.name || !editing.model || !editing.base_url) { alert('名称 / 模型 / Base URL 都必填'); return; }
    if (!editing.id && !editing.api_key) { alert('新建 profile 必须填 API key'); return; }
    try {
      const r = await fetch('/api/config/api/profile', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(editing),
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error || ('HTTP ' + r.status));
      await fetchAll();
      setEditing(null);
      setAppliedAt(new Date().toLocaleString('zh-CN', { hour12: false }) + ' · 已保存');
    } catch (e) { alert('保存失败: ' + e.message); }
  };

  const deleteProfile = async (pid, name) => {
    if (!window.confirm(`删除 profile「${name}」?\n如果它是当前激活的,会回退到环境变量配置。`)) return;
    try {
      const r = await fetch(`/api/config/api/profile/${encodeURIComponent(pid)}/delete`, { method: 'POST' });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error || ('HTTP ' + r.status));
      await fetchAll();
    } catch (e) { alert('删除失败: ' + e.message); }
  };

  const setActive = async (pid) => {
    const p = data.profiles.find(x => x.id === pid);
    if (p && !p.has_key) { alert('该 profile 没有 API key,无法激活'); return; }
    setSwitching(pid);
    try {
      const r = await fetch('/api/config/api/active', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: pid }),
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error || ('HTTP ' + r.status));
      await fetchAll();
      setAppliedAt(new Date().toLocaleString('zh-CN', { hour12: false }) + ' · 已激活并生效');
    } catch (e) { alert('切换失败: ' + e.message); }
    finally { setSwitching(null); }
  };

  const clearActive = async () => {
    if (!window.confirm('回退到环境变量(env)配置?')) return;
    setSwitching('__clear__');
    try {
      await fetch('/api/config/api/active', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: null }),
      });
      await fetchAll();
      setAppliedAt(new Date().toLocaleString('zh-CN', { hour12: false }) + ' · 已回退到 env');
    } catch (e) { alert('失败: ' + e.message); }
    finally { setSwitching(null); }
  };

  const testProfile = async (pid) => {
    setTesting(t => ({ ...t, [pid]: 'pending' }));
    setTestInfo(i => ({ ...i, [pid]: null }));
    try {
      const r = await fetch('/api/config/api/test', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: pid }),
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
    if (!editing.api_key) { alert('请先填 API key 再测试'); return; }
    setTesting(t => ({ ...t, __draft__: 'pending' }));
    setTestInfo(i => ({ ...i, __draft__: null }));
    try {
      const r = await fetch('/api/config/api/test', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
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

  // 策略参数提交(防抖一下)
  const saveStrategy = async (patch) => {
    setStrategy(s => ({ ...s, ...patch }));
    setStrategySaving(true);
    try {
      const r = await fetch('/api/config/strategy', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(patch),
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error || ('HTTP ' + r.status));
      setStrategy({ merge_threshold: d.merge_threshold, max_recall: d.max_recall });
    } catch (e) {
      alert('策略保存失败: ' + e.message);
      fetchStrategy();  // 失败回滚
    } finally { setStrategySaving(false); }
  };

  if (loadErr) {
    return <main className="oc-main"><div style={{ padding: 20, color: '#8B4A4A', fontSize: 13 }}>配置加载失败: {loadErr} · <a onClick={fetchAll} style={{ cursor: 'pointer', textDecoration: 'underline' }}>重试</a></div></main>;
  }
  if (!data) {
    return <main className="oc-main"><div style={{ padding: 40, textAlign: 'center', color: 'var(--ink-3)' }}>加载配置…</div></main>;
  }

  const eff = data.current_effective || {};
  const activeProfile = data.profiles.find(p => p.id === data.active);

  return (
    <main className="oc-main">
      <ConsolePageHd
        title="配置"
        sub={<>系统运行参数 —— 脱水/打标 API、向量化模型、回忆策略。修改即时生效,持久化在 runtime_config.json。</>}
        rightSlot={
          <>
            <div className="oc-status-pill ok">{eff.api_available ? '运行中' : '未配置'}</div>
            <div className="ob-page-counter">{appliedAt || '—'}</div>
          </>
        }
      />

      {/* 当前生效 摘要 */}
      <ConsoleCard label="当前生效" sub={data.active ? `Profile · ${activeProfile?.name || data.active}` : '回退到环境变量(env)配置'}>
        <div style={{ display: 'grid', gridTemplateColumns: '120px 1fr', gap: '8px 14px', alignItems: 'baseline', fontSize: 13 }}>
          <div style={{ color: 'var(--ink-4)', fontFamily: 'var(--mono)', fontSize: 11, letterSpacing: '0.06em' }}>MODEL</div>
          <div style={{ fontFamily: 'var(--mono)', color: 'var(--ink)' }}>{eff.model || '—'}</div>
          <div style={{ color: 'var(--ink-4)', fontFamily: 'var(--mono)', fontSize: 11, letterSpacing: '0.06em' }}>BASE URL</div>
          <div style={{ fontFamily: 'var(--mono)', color: 'var(--ink-2)', fontSize: 12 }}>{eff.base_url || '—'}</div>
          <div style={{ color: 'var(--ink-4)', fontFamily: 'var(--mono)', fontSize: 11, letterSpacing: '0.06em' }}>API KEY</div>
          <div style={{ fontFamily: 'var(--mono)', color: eff.api_available ? 'var(--ink-2)' : '#8B4A4A', fontSize: 12 }}>{eff.api_key_mask || '(未设置)'}</div>
        </div>
        {data.active && (
          <div style={{ marginTop: 12 }}>
            <button className="oc-btn oc-btn-ghost" onClick={clearActive} disabled={switching === '__clear__'} style={{ fontSize: 11 }}>
              {switching === '__clear__' ? '⌛ 切换中…' : '↺ 回退到环境变量配置'}
            </button>
          </div>
        )}
      </ConsoleCard>

      {/* API Profiles */}
      <ConsoleCard label="API Profiles" sub={`${data.profiles.length} 个 profile · 点左侧 ◉ 切换激活;导入用 Claude Sonnet,日常用 Gemini Flash 都很方便`}>
        {!editing && (
          <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 10 }}>
            <button
              className="oc-btn"
              onClick={startNew}
              style={{
                fontSize: 11, padding: '5px 12px',
                background: 'color-mix(in oklab, var(--accent) 8%, var(--paper))',
                color: 'var(--accent)',
                borderColor: 'var(--accent)',
              }}
            >+ 新建 profile</button>
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
                <button
                  type="button"
                  onClick={() => !isActive && setActive(p.id)}
                  disabled={switching !== null || isActive}
                  title={isActive ? '当前激活' : '点击激活'}
                  style={{
                    width: 16, height: 16, borderRadius: '50%',
                    border: '1.5px solid ' + (isActive ? 'var(--accent)' : 'var(--ink-4)'),
                    background: isActive ? 'var(--accent)' : 'transparent',
                    cursor: isActive ? 'default' : 'pointer', padding: 0,
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
                  <button className="oc-btn oc-btn-ghost" onClick={() => testProfile(p.id)} disabled={t === 'pending' || !p.has_key} style={{ fontSize: 10.5, padding: '3px 9px' }} title={p.has_key ? '发送一个 ping 请求测试连通' : '没填 key 无法测试'}>
                    {t === 'pending' ? '◐ 测试中' : '◇ 测试'}
                  </button>
                  <button className="oc-btn oc-btn-ghost" onClick={() => startEdit(p)} style={{ fontSize: 10.5, padding: '3px 9px' }}>编辑</button>
                  <button className="oc-btn oc-btn-ghost" onClick={() => deleteProfile(p.id, p.name)} style={{ fontSize: 10.5, padding: '3px 9px', color: '#8B4A4A' }}>删除</button>
                </div>
              </div>
            );
          })}
        </div>

        {/* 内联编辑表单 */}
        {editing && (() => {
          const td = testing.__draft__;
          const tdi = testInfo.__draft__;
          return (
            <div style={{
              marginTop: 14, padding: '14px 16px',
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
                  <select className="oc-select" value={editing._preset || ''} onChange={(e) => applyPreset(e.target.value)}>
                    <option value="">— 选模板自动填 model + base_url —</option>
                    {API_PRESETS.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
                  </select>
                </div>
              )}
              <div className="oc-field">
                <div className="oc-field-label">名称</div>
                <input className="oc-input" placeholder="比如 'Claude Sonnet 主力'" value={editing.name} onChange={(e) => setEditing(s => ({ ...s, name: e.target.value }))} />
              </div>
              <div className="oc-field">
                <div className="oc-field-label">MODEL</div>
                <input className="oc-input oc-input-mono" placeholder="claude-sonnet-4-6" value={editing.model} onChange={(e) => setEditing(s => ({ ...s, model: e.target.value }))} />
              </div>
              <div className="oc-field">
                <div className="oc-field-label">BASE URL</div>
                <input className="oc-input oc-input-mono" placeholder="https://api.anthropic.com/v1/" value={editing.base_url} onChange={(e) => setEditing(s => ({ ...s, base_url: e.target.value }))} />
              </div>
              <div className="oc-field">
                <div className="oc-field-label">API KEY</div>
                <div style={{ display: 'flex', gap: 6, alignItems: 'center', flex: 1 }}>
                  <input className="oc-input oc-input-mono" type={showKey ? 'text' : 'password'} placeholder={editing.id ? '留空 = 不修改' : 'sk-ant-...'} value={editing.api_key} onChange={(e) => setEditing(s => ({ ...s, api_key: e.target.value }))} style={{ flex: 1 }} />
                  <button className="oc-btn oc-btn-ghost" onClick={() => setShowKey(s => !s)} style={{ fontSize: 11, padding: '5px 10px', flexShrink: 0 }}>{showKey ? '隐藏' : '显示'}</button>
                </div>
              </div>
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
                <button className="oc-btn oc-btn-ghost" onClick={testDraft} disabled={td === 'pending' || !editing.api_key}>
                  {td === 'pending' ? '◐ 测试中…' : '◇ 测试连接'}
                </button>
                <button className="oc-btn oc-btn-ghost" onClick={cancelEdit}>取消</button>
                <button className="oc-btn oc-btn-primary" onClick={saveProfile} style={{ marginLeft: 'auto' }}>
                  {editing.id ? '保存修改' : '创建 profile'}
                </button>
              </div>
              <div style={{ marginTop: 8, fontSize: 10.5, color: 'var(--ink-4)', fontFamily: 'var(--mono)' }}>
                {editing.id ? '保存后不会自动激活,需要点列表里的 ◉ 切换' : '创建后不会自动激活,建议先测试连接再激活'}
              </div>
            </div>
          );
        })()}
      </ConsoleCard>

      {/* 向量化 Embedding */}
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

      {/* 回忆 / 合并策略 */}
      <ConsoleCard label="回忆 / 合并策略" sub={<>合并阈值 / Max Recall · 即时生效 {strategySaving && <span style={{ color: 'var(--accent)', fontFamily: 'var(--mono)' }}>· 保存中…</span>}</>}>
        <div className="oc-field">
          <div className="oc-field-label">合并阈值</div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <input
              type="range" min={0} max={100} step={1}
              value={strategy.merge_threshold}
              onChange={(e) => setStrategy(s => ({ ...s, merge_threshold: +e.target.value }))}
              onMouseUp={(e) => saveStrategy({ merge_threshold: +e.target.value })}
              onTouchEnd={(e) => saveStrategy({ merge_threshold: +e.target.value })}
              className="oc-slider" style={{ flex: 1 }}
            />
            <input
              className="oc-input oc-input-mono" style={{ width: 80 }} type="number"
              min={0} max={100}
              value={strategy.merge_threshold}
              onChange={(e) => setStrategy(s => ({ ...s, merge_threshold: +e.target.value }))}
              onBlur={(e) => saveStrategy({ merge_threshold: +e.target.value })}
            />
          </div>
        </div>
        <div className="oc-field-help" style={{ paddingLeft: 126, marginTop: -8 }}>
          0–100 · 越高越严格(少合并),越低越松(频繁合并) · 导入时用
        </div>

        <div className="oc-field">
          <div className="oc-field-label">Max Recall</div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <input
              className="oc-input oc-input-mono" type="number" min={1} max={50}
              value={strategy.max_recall}
              onChange={(e) => setStrategy(s => ({ ...s, max_recall: +e.target.value }))}
              onBlur={(e) => saveStrategy({ max_recall: +e.target.value })}
            />
          </div>
        </div>
        <div className="oc-field-help" style={{ paddingLeft: 126, marginTop: -6 }}>
          1–50 · bucket_mgr.search 默认返回数;breath 工具 max_results 兜底
        </div>
      </ConsoleCard>

      {/* 权重配置 (decay 引擎参数) */}
      <ConsoleCard label="权重配置" sub="调 score 公式 · 改完即刻生效 · 重启后保留">
        {!decayCfg && <div style={{ color: 'var(--ink-4)', fontSize: 12 }}>载入中…</div>}
        {decayCfg && (
          <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 12 }}>
            <button
              className="oc-btn oc-btn-ghost"
              onClick={resetDecayAll}
              disabled={decayResetting}
              style={{ fontSize: 11, padding: '3px 12px' }}
            >{decayResetting ? '⌛' : '↺ 全部恢复默认'}</button>
          </div>
        )}
        {decayCfg && decayCfg.schema.map(item => {
          const cur = decayCfg.current[item.key];
          const def = decayCfg.defaults[item.key];
          const isDefault = Math.abs((cur ?? 0) - (def ?? 0)) < 1e-6;
          return (
            <div className="oc-field" key={item.key} style={{ alignItems: 'flex-start' }}>
              <div className="oc-field-label" style={{ paddingTop: 6 }}>{item.label}</div>
              <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 4 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                  <input
                    type="range"
                    min={item.min}
                    max={item.max}
                    step={item.step}
                    value={cur}
                    onChange={(e) => updateDecay(item.key, +e.target.value)}
                    className="oc-decay-slider"
                    style={{ flex: 1, accentColor: 'var(--accent)' }}
                  />
                  <span style={{
                    fontFamily: 'var(--mono)', fontSize: 13,
                    color: isDefault ? 'var(--ink-3)' : 'var(--accent)',
                    fontWeight: isDefault ? 400 : 600,
                    minWidth: 56, textAlign: 'right',
                  }}>
                    {item.step < 1 ? Number(cur).toFixed(2) : Math.round(cur)}
                  </span>
                  <button
                    className="oc-btn oc-btn-ghost"
                    title={`恢复默认 ${def}`}
                    onClick={() => updateDecay(item.key, def)}
                    disabled={isDefault || decaySaving}
                    style={{ fontSize: 10, padding: '2px 8px', minWidth: 32 }}
                  >↺</button>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 10, color: 'var(--ink-4)', fontFamily: 'var(--mono)' }}>
                  <span>{item.hint}</span>
                  <span>范围 {item.min} – {item.max} · 默认 {item.step < 1 ? Number(def).toFixed(2) : Math.round(def)}</span>
                </div>
              </div>
            </div>
          );
        })}
        {decayCfg && (
          <div className="oc-field-help" style={{ paddingLeft: 126, marginTop: 10, color: 'var(--ink-4)' }}>
            高亮 = 已偏离默认 · 改动写入 buckets/runtime_config.json, 重启自动加载
          </div>
        )}
      </ConsoleCard>

      {/* 检索打分微调 (title 命中加分 / 关键词优先 / dryrun 日志) */}
      <ConsoleCard label="检索打分微调" sub="解决「关键词在 title 命中却被弱命中桶顶下去」· 默认全关 = 零影响">
        {!scoringCfg && <div style={{ color: 'var(--ink-4)', fontSize: 12 }}>载入中…</div>}
        {scoringCfg && (
          <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 12 }}>
            <button
              className="oc-btn oc-btn-ghost"
              onClick={resetScoringAll}
              disabled={scoringResetting}
              style={{ fontSize: 11, padding: '3px 12px' }}
            >{scoringResetting ? '⌛' : '↺ 全部关掉'}</button>
          </div>
        )}
        {scoringCfg && scoringCfg.schema.map(item => {
          const cur = scoringCfg.current[item.key];
          const def = scoringCfg.defaults[item.key];
          const isDefault = item.type === 'bool'
            ? (!!cur === !!def)
            : Math.abs((cur ?? 0) - (def ?? 0)) < 1e-6;
          return (
            <div className="oc-field" key={item.key} style={{ alignItems: 'flex-start' }}>
              <div className="oc-field-label" style={{ paddingTop: 6 }}>{item.label}</div>
              <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 4 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                  {item.type === 'bool' ? (
                    <button
                      onClick={() => updateScoring(item.key, !cur)}
                      disabled={scoringSaving}
                      className="oc-btn"
                      style={{
                        flex: 'none',
                        background: cur ? 'var(--accent)' : 'transparent',
                        color: cur ? 'var(--paper)' : 'var(--ink-3)',
                        border: '1px solid var(--ink-4)',
                        fontSize: 12, padding: '4px 14px', minWidth: 60,
                      }}
                    >{cur ? '已开' : '关'}</button>
                  ) : (
                    <>
                      <input
                        type="range"
                        min={item.min}
                        max={item.max}
                        step={item.step}
                        value={cur ?? 0}
                        onChange={(e) => updateScoring(item.key, +e.target.value)}
                        className="oc-decay-slider"
                        style={{ flex: 1, accentColor: 'var(--accent)' }}
                      />
                      <span style={{
                        fontFamily: 'var(--mono)', fontSize: 13,
                        color: isDefault ? 'var(--ink-3)' : 'var(--accent)',
                        fontWeight: isDefault ? 400 : 600,
                        minWidth: 56, textAlign: 'right',
                      }}>
                        {item.step < 1 ? Number(cur ?? 0).toFixed(2) : Math.round(cur ?? 0)}
                      </span>
                      <button
                        className="oc-btn oc-btn-ghost"
                        title={`恢复默认 ${def}`}
                        onClick={() => updateScoring(item.key, def)}
                        disabled={isDefault || scoringSaving}
                        style={{ fontSize: 10, padding: '2px 8px', minWidth: 32 }}
                      >↺</button>
                    </>
                  )}
                </div>
                <div style={{ fontSize: 10, color: 'var(--ink-4)', fontFamily: 'var(--mono)' }}>
                  {item.hint}
                </div>
              </div>
            </div>
          );
        })}
        {scoringCfg && (
          <div className="oc-field-help" style={{ paddingLeft: 126, marginTop: 10, color: 'var(--ink-4)' }}>
            推荐起步: title 加分 +15 + dryrun 打开, 观察一天再调
          </div>
        )}
      </ConsoleCard>

      {/* 即时模拟: 输入一段话, dry-run 看会检索到哪些记忆 (配合上面的旋钮实时调) */}
      <ConsoleCard label="即时模拟" sub="输入一句话 → 看 OB 会检索出哪些记忆 + 为什么命中 · dry-run 不记统计 · 调上面旋钮后在这实测效果">
        <div style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
          <input
            type="text"
            value={simQuery}
            onChange={(e) => setSimQuery(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') runSimulate(); }}
            placeholder="输入一段话试试，比如「上次去爬山」"
            style={{ flex: 1, padding: '6px 10px', fontSize: 13, border: '1px solid var(--ink-4)', borderRadius: 4, background: 'var(--paper)', color: 'var(--ink-1)' }}
          />
          <button className="oc-btn oc-btn-primary" onClick={runSimulate} disabled={simLoading || !simQuery.trim()} style={{ fontSize: 12, padding: '4px 18px' }}>
            {simLoading ? '⌛' : '模拟'}
          </button>
        </div>
        {simResult && simResult.error && (
          <div style={{ color: '#c44', fontSize: 12 }}>出错: {simResult.error}</div>
        )}
        {simResult && !simResult.error && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4, fontSize: 12 }}>
            <div style={{ fontSize: 11, color: 'var(--ink-4)', fontFamily: 'var(--mono)', marginBottom: 4 }}>
              关键词命中 {(simResult.keyword_hits || []).length} · 语义召回 {(simResult.vector_hits || []).length}
            </div>
            {(simResult.keyword_hits || []).length === 0 && (simResult.vector_hits || []).length === 0 && (
              <div style={{ color: 'var(--ink-4)', padding: '8px 0' }}>没有命中 —— 这段话不会让任何记忆浮现</div>
            )}
            {(simResult.keyword_hits || []).map((h) => {
              const titleHit = (h.matched_in || []).includes('title');
              return (
                <div key={h.id} title={h.id} style={{ display: 'flex', alignItems: 'baseline', gap: 8, padding: '4px 0', borderBottom: '1px solid var(--ink-5, rgba(0,0,0,0.05))' }}>
                  <span style={{ fontFamily: 'var(--mono)', color: titleHit ? 'var(--accent)' : 'var(--ink-3)', minWidth: 44, textAlign: 'right' }}>{Number(h.score || 0).toFixed(1)}</span>
                  <span style={{ flex: 1, color: 'var(--ink-2)' }}>{h.name}</span>
                  <span style={{ fontFamily: 'var(--mono)', fontSize: 10, color: 'var(--ink-4)' }}>{(h.matched_in || []).join('/') || '—'}</span>
                </div>
              );
            })}
            {(simResult.vector_hits || []).length > 0 && (
              <div style={{ fontSize: 10, color: 'var(--ink-4)', marginTop: 6, marginBottom: 2 }}>— 语义召回 (query 不在文本里但意思相近) —</div>
            )}
            {(simResult.vector_hits || []).map((h) => (
              <div key={h.id} title={h.id} style={{ display: 'flex', alignItems: 'baseline', gap: 8, padding: '4px 0', opacity: 0.8 }}>
                <span style={{ fontFamily: 'var(--mono)', color: 'var(--ink-4)', minWidth: 44, textAlign: 'right' }}>~{Number(h.similarity || 0).toFixed(2)}</span>
                <span style={{ flex: 1, color: 'var(--ink-3)' }}>{h.name}</span>
                <span style={{ fontFamily: 'var(--mono)', fontSize: 10, color: 'var(--ink-4)' }}>语义</span>
              </div>
            ))}
          </div>
        )}
        <div className="oc-field-help" style={{ marginTop: 10, color: 'var(--ink-4)' }}>
          分数 = 检索权重 (紫色 = title 命中) · 右侧是命中字段 · 改上面旋钮后再模拟同一句, 看排序怎么变
        </div>
      </ConsoleCard>

      {/* 记忆命中频次 (反向反馈写作: 哪些桶经常被检索 / 哪些从未) */}
      <ConsoleCard label="记忆被想起" sub="被检索(关键词命中) + 被浮现(权重池自动浮现) · 哪条常被想起、哪条被冷落 · 反向指导 title 写作">
        {/* 热门 / 冷门 视图切换 */}
        <div style={{ display: 'flex', gap: 6, marginBottom: 10 }}>
          {[['hot', '🔥 高频'], ['cold', '🧊 冷落 (含从未命中)']].map(([v, label]) => (
            <button
              key={v}
              className={'oc-btn ' + (hitView === v ? 'oc-btn-primary' : 'oc-btn-ghost')}
              onClick={() => switchHitView(v)}
              disabled={hitStatsLoading}
              style={{ fontSize: 11, padding: '3px 12px' }}
            >{label}</button>
          ))}
        </div>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
          <div style={{ fontSize: 11, color: 'var(--ink-4)', fontFamily: 'var(--mono)' }}>
            {hitStats
              ? `累计 ${hitStats.total_searches ?? 0} 次搜索` +
                (hitStats.total_buckets != null
                  ? ` · 命中 ${hitStats.hit_buckets}/${hitStats.total_buckets} 桶 · 从未 ${hitStats.zero_buckets}`
                  : ` · top ${(hitStats.items || []).length} 桶`)
              : '载入中…'}
          </div>
          <button
            className="oc-btn oc-btn-ghost"
            onClick={() => fetchHitStats()}
            disabled={hitStatsLoading}
            style={{ fontSize: 11, padding: '3px 12px' }}
          >{hitStatsLoading ? '⌛' : '↻ 刷新'}</button>
        </div>
        {hitStats && hitStats.items && hitStats.items.length === 0 && (
          <div style={{ color: 'var(--ink-4)', fontSize: 12, padding: '12px 0' }}>
            还没有命中记录 · 搜一下记忆或让 AI 浮现就会有数据
          </div>
        )}
        {hitStats && hitStats.items && hitStats.items.length > 0 && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4, fontSize: 12, maxHeight: hitView === 'cold' ? 420 : 'none', overflowY: hitView === 'cold' ? 'auto' : 'visible' }}>
            {hitStats.items.map((it, i) => {
              const zero = (it.count || 0) === 0;
              return (
                <div key={it.id} title={it.id} style={{
                  display: 'flex', alignItems: 'baseline', gap: 8,
                  padding: '4px 0',
                  borderBottom: i < hitStats.items.length - 1 ? '1px solid var(--ink-5, rgba(0,0,0,0.05))' : 'none',
                  opacity: zero ? 0.7 : 1,
                }}>
                  <span style={{ fontFamily: 'var(--mono)', minWidth: 64, textAlign: 'right', whiteSpace: 'nowrap' }}>
                    <span style={{ color: zero ? 'var(--ink-4)' : 'var(--accent)' }} title="被关键词检索命中次数">×{it.count}</span>
                    {(it.surface_count || 0) > 0 && (
                      <span style={{ color: 'var(--ink-4)', fontSize: 10, marginLeft: 4 }} title="被权重池自动浮现次数">浮{it.surface_count}</span>
                    )}
                  </span>
                  <span style={{ flex: 1, color: 'var(--ink-2)' }}>
                    {it.name || it.id}
                    {it.missing && <span style={{ color: 'var(--ink-4)', marginLeft: 6 }}>[已删/归档]</span>}
                  </span>
                  <span style={{ fontFamily: 'var(--mono)', fontSize: 10, color: 'var(--ink-4)' }}>
                    {zero
                      ? ((it.surface_count || 0) > 0 ? '仅浮现 · 从未被搜索' : '从未被想起')
                      : (it.last_query ? `"${String(it.last_query).slice(0, 20)}"` : (it.last_hit ? String(it.last_hit).slice(0, 10) : ''))}
                  </span>
                </div>
              );
            })}
          </div>
        )}
        <div className="oc-field-help" style={{ marginTop: 10, color: 'var(--ink-4)' }}>
          {hitView === 'cold'
            ? '冷落视图: 升序排, 已排除钉选/永久参考/feel/已消化 (它们本就不参与普通浮现/检索, ×0 是预期) · ×0 且你在意的桶 → 改 title/内容让它更容易被想起'
            : '累计落盘, 重启不再清零 · 切到「冷落」看哪些在意的记忆没被想起'}
        </div>
      </ConsoleCard>

      {/* 最近搜索追溯 ("我这次发消息浮现了哪些"用) */}
      <ConsoleCard label="最近搜索追溯" sub="最近 10 次 search 的 query + top 命中 · 直击「这次发消息浮现了什么」">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
          <div style={{ fontSize: 11, color: 'var(--ink-4)', fontFamily: 'var(--mono)' }}>
            {recentSearches ? `共 ${(recentSearches.items || []).length} 条记录` : '载入中…'}
          </div>
          <button
            className="oc-btn oc-btn-ghost"
            onClick={fetchRecentSearches}
            disabled={recentLoading}
            style={{ fontSize: 11, padding: '3px 12px' }}
          >{recentLoading ? '⌛' : '↻ 刷新'}</button>
        </div>
        {recentSearches && recentSearches.items && recentSearches.items.length === 0 && (
          <div style={{ color: 'var(--ink-4)', fontSize: 12, padding: '12px 0' }}>
            还没有搜索记录 · 发条消息或在前端搜一下记忆就有
          </div>
        )}
        {recentSearches && recentSearches.items && recentSearches.items.length > 0 && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6, fontSize: 12 }}>
            {recentSearches.items.map((tr, i) => {
              const isOpen = !!recentOpen[tr.ts];
              const tsShort = (tr.ts || '').slice(11, 19);  // HH:MM:SS
              return (
                <div key={tr.ts + '_' + i} style={{
                  border: '1px solid var(--ink-5, rgba(0,0,0,0.08))',
                  borderRadius: 4,
                  background: isOpen ? 'var(--paper-2, rgba(0,0,0,0.02))' : 'transparent',
                }}>
                  <div
                    onClick={() => setRecentOpen(s => ({ ...s, [tr.ts]: !s[tr.ts] }))}
                    style={{
                      display: 'flex', alignItems: 'baseline', gap: 8,
                      padding: '6px 10px', cursor: 'pointer', userSelect: 'none',
                    }}
                  >
                    <span style={{ fontFamily: 'var(--mono)', fontSize: 10, color: 'var(--ink-4)', minWidth: 60 }}>
                      {tsShort} UTC
                    </span>
                    <span style={{ flex: 1, color: 'var(--ink-2)' }}>
                      "{tr.query}"
                    </span>
                    <span style={{ fontFamily: 'var(--mono)', fontSize: 10, color: 'var(--ink-4)' }}>
                      命中 {tr.result_count}  ·  {isOpen ? '▾' : '▸'}
                    </span>
                  </div>
                  {isOpen && (
                    <div style={{ padding: '4px 10px 10px 10px', display: 'flex', flexDirection: 'column', gap: 3 }}>
                      {(tr.top || []).map((h, j) => (
                        <div key={h.id + '_' + j} style={{
                          display: 'flex', alignItems: 'baseline', gap: 8,
                          padding: '3px 0', fontSize: 11,
                          borderTop: j === 0 ? 'none' : '1px dotted var(--ink-5, rgba(0,0,0,0.06))',
                        }}>
                          <span style={{ fontFamily: 'var(--mono)', color: 'var(--accent)', minWidth: 36, textAlign: 'right' }}>
                            #{j + 1}
                          </span>
                          <span style={{
                            fontFamily: 'var(--mono)', fontSize: 10,
                            color: h.title_hit ? 'var(--accent)' : 'var(--ink-3)',
                            fontWeight: h.title_hit ? 600 : 400,
                            minWidth: 48,
                          }}>
                            {Number(h.score || 0).toFixed(1)}
                          </span>
                          <span style={{ flex: 1, color: 'var(--ink-2)' }}>
                            {h.name}
                            {h.type === 'feel' && <span style={{ color: 'var(--ink-4)', marginLeft: 6 }}>[feel]</span>}
                            {h.type === 'permanent' && <span style={{ color: 'var(--ink-4)', marginLeft: 6 }}>[钉]</span>}
                          </span>
                          <span style={{ fontFamily: 'var(--mono)', fontSize: 10, color: 'var(--ink-4)' }}>
                            {(h.matched_in || []).join(',') || '—'}
                          </span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
        <div className="oc-field-help" style={{ marginTop: 10, color: 'var(--ink-4)' }}>
          点条目展开看 top-10 详情 · score 紫色 = title 命中 · AI 主动检索 + 自动注入(API) 触发的 search 都在这看
        </div>
      </ConsoleCard>

      {/* Prompt 配置 (LLM system prompt 直接编辑) */}
      <ConsoleCard label="Prompt 配置" sub="改 LLM 系统提示词 · 改完即刻生效 · 重启后保留">
        {!promptCfg && <div style={{ color: 'var(--ink-4)', fontSize: 12 }}>载入中…</div>}
        {promptCfg && (
          <>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12, gap: 8 }}>
              <div style={{ fontSize: 11, color: 'var(--ink-4)', fontFamily: 'var(--mono)', flex: 1 }}>
                {promptCfg.overridden && promptCfg.overridden.length > 0
                  ? `${promptCfg.overridden.length} 个已自定义 · 其余使用出厂默认`
                  : '全部使用出厂默认'}
              </div>
              <button
                className="oc-btn oc-btn-ghost"
                onClick={alignUpstream}
                disabled={promptResetAllBusy}
                style={{ fontSize: 11, padding: '3px 12px' }}
                title="把上游 (P0luz/Ombre-Brain) 有的 prompt 全部切到上游版本"
              >{promptResetAllBusy ? '⌛' : '⇆ 对齐原作者版本'}</button>
              <button
                className="oc-btn oc-btn-ghost"
                onClick={resetPromptAll}
                disabled={promptResetAllBusy || !promptCfg.overridden || promptCfg.overridden.length === 0}
                style={{ fontSize: 11, padding: '3px 12px' }}
              >{promptResetAllBusy ? '⌛' : '↺ 全部恢复默认'}</button>
            </div>
            {promptCfg.schema.map(item => {
              const cur = promptCurrent(item.key);
              const overridden = isPromptOverridden(item.key);
              const dirty = promptIsDirty(item.key);
              const saving = !!promptSaving[item.key];
              const open = !!promptOpen[item.key];
              const charCount = (cur || '').length;
              return (
                <div key={item.key} className={'oc-prompt-row' + (overridden ? ' is-overridden' : '') + (dirty ? ' is-dirty' : '')}>
                  <div
                    className="oc-prompt-hd"
                    onClick={() => setPromptOpen(s => ({ ...s, [item.key]: !s[item.key] }))}
                  >
                    <span className="oc-prompt-chev">{open ? '▾' : '▸'}</span>
                    <span className="oc-prompt-label">{item.label}</span>
                    <code className="oc-prompt-key">{item.key}</code>
                    {overridden && <span className="oc-prompt-badge">已自定义</span>}
                    {dirty && <span className="oc-prompt-badge oc-prompt-badge-dirty">未保存</span>}
                    <span className="oc-prompt-meta">{charCount} 字</span>
                  </div>
                  {open && (
                    <div className="oc-prompt-body">
                      <div className="oc-prompt-desc">{item.desc}</div>
                      <textarea
                        className="oc-prompt-textarea"
                        rows={item.rows || 16}
                        value={cur}
                        onChange={(e) => setPromptDraft(s => ({ ...s, [item.key]: e.target.value }))}
                        spellCheck={false}
                        disabled={saving}
                      />
                      <div className="oc-prompt-foot">
                        <button
                          className="oc-btn oc-btn-ghost"
                          onClick={() => resetPromptOne(item.key)}
                          disabled={saving || (!overridden && !dirty)}
                          title={overridden ? '清掉这条覆盖, 回到出厂默认' : '当前已是出厂默认'}
                        >↺ 恢复默认</button>
                        <div style={{ flex: 1 }} />
                        {dirty && (
                          <button
                            className="oc-btn oc-btn-ghost"
                            onClick={() => discardPromptDraft(item.key)}
                            disabled={saving}
                          >放弃改动</button>
                        )}
                        <button
                          className="oc-btn oc-btn-primary"
                          onClick={() => savePrompt(item.key)}
                          disabled={saving || !dirty}
                        >{saving ? '保存中…' : '✓ 保存'}</button>
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
            <div className="oc-field-help" style={{ marginTop: 14, color: 'var(--ink-4)' }}>
              改动写入 buckets/runtime_config.json['prompts'], 重启自动加载 · 全部 prompt 都用 LLM system role 注入, 改完即刻生效
            </div>
          </>
        )}
      </ConsoleCard>

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
          <code style={{ fontFamily: 'var(--mono)', fontSize: 12, color: 'var(--ink-2)' }}>runtime_config.json · config.yaml · env vars</code>
        </div>
      </ConsoleCard>
    </main>
  );
}

window.ConfigPage = ConfigPage;
