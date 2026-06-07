// console-breath.jsx —— Breath 模拟管线（接通真后端 /api/breath-debug）
// 5 阶段：① 输入 → ② 候选 → ③ 四维评分 → ④ 阈值过滤 → ⑤ 重排序

const { useState: cbS, useEffect: cbE } = React;

// 初始 token（threshold/topN 给前端 slider 当起点；权重由后端返回真实值覆盖）
const BREATH_THRESHOLD = 50;
const BREATH_TOP_N = 4;
const DEFAULT_WEIGHTS = { topic: 4, emotion: 2, time: 2.5, importance: 1 };

function BreathPage({ items }) {
  const [query, setQuery] = cbS('记忆');
  const [valence, setValence] = cbS(0.6);
  const [arousal, setArousal] = cbS(0.5);
  const [running, setRunning] = cbS(false);
  const [activeStage, setActiveStage] = cbS(0);
  const [topN, setTopN] = cbS(BREATH_TOP_N);
  const [threshold, setThreshold] = cbS(BREATH_THRESHOLD);

  // 后端 /api/breath-debug 返回的真实数据
  const [results, setResults] = cbS([]);
  const [weights, setWeights] = cbS(DEFAULT_WEIGHTS);
  const [totalCandidates, setTotalCandidates] = cbS(0);
  const [error, setError] = cbS(null);
  const [hasFetched, setHasFetched] = cbS(false);

  // 客户端二次过滤(slider 即时反馈,不发新请求)
  const passed = results.filter(r => r.normalized >= threshold);
  const finalList = passed.slice(0, topN);

  // ─── 从配置页迁来 (2026-06-07): 检索打分微调 / 即时模拟 / 被想起统计 / 最近搜索 ───
  // 都是"看检索/浮现怎么发生"的观测面, 跟上面的 breath-debug 模拟同类, 聚到 Breath tab。
  const [scoringCfg, setScoringCfg] = cbS(null);
  const [scoringSaving, setScoringSaving] = cbS(false);
  const [scoringResetting, setScoringResetting] = cbS(false);
  const [hitStats, setHitStats] = cbS(null);
  const [hitStatsLoading, setHitStatsLoading] = cbS(false);
  const [hitView, setHitView] = cbS('hot');           // 'hot' 高频在前 / 'cold' 冷门在前
  const [recentSearches, setRecentSearches] = cbS(null);
  const [recentLoading, setRecentLoading] = cbS(false);
  const [recentOpen, setRecentOpen] = cbS({});
  const [simQuery, setSimQuery] = cbS('');             // 即时模拟: /api/search dry-run (区别于上面 breath-debug 管线)
  const [simResult, setSimResult] = cbS(null);
  const [simLoading, setSimLoading] = cbS(false);

  const fetchScoring = async () => {
    try {
      const r = await fetch('/api/scoring-config');
      if (r.ok) setScoringCfg(await r.json());
    } catch (e) { /* 沉默 */ }
  };
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
  const fetchHitStats = async (view) => {
    const mode = view || hitView;
    setHitStatsLoading(true);
    try {
      // 冷门视图: 并入从未命中的桶(count 0) + 排除钉选/永久参考/feel/已消化 + 升序
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

  const fetchBreath = async () => {
    setError(null);
    try {
      const params = new URLSearchParams({
        q: query,
        valence: String(valence),
        arousal: String(arousal),
      });
      const r = await fetch(`/api/breath-debug?${params.toString()}`);
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const data = await r.json();
      if (data.error) throw new Error(data.error);
      setResults(Array.isArray(data.results) ? data.results : []);
      setWeights(data.weights || DEFAULT_WEIGHTS);
      setTotalCandidates(data.total_candidates || 0);
      setHasFetched(true);
    } catch (err) {
      setError(err && err.message ? err.message : String(err));
      setResults([]);
      setTotalCandidates(0);
      setHasFetched(true);
    }
  };

  // 阶段动画 + fetch 并行
  const runSimulation = () => {
    setRunning(true);
    setActiveStage(0);
    let s = 0;
    const tick = () => {
      s += 1;
      setActiveStage(s);
      if (s < 5) setTimeout(tick, 320);
      else setTimeout(() => { setRunning(false); }, 200);
    };
    setTimeout(tick, 200);
    fetchBreath();
  };

  // 初次挂载自动跑一次,免得空白 + 拉迁来的 scoring/统计数据
  cbE(() => { runSimulation(); fetchScoring(); fetchHitStats(); fetchRecentSearches(); }, []);

  const stages = [
    { num: 'i', label: '输入', meta: 'query / valence / arousal' },
    { num: 'ii', label: '候选', meta: `${totalCandidates} 条` },
    { num: 'iii', label: '四维评分', meta: `topic×${weights.topic} + emotion×${weights.emotion} + time×${weights.time} + imp×${weights.importance}` },
    { num: 'iv', label: '阈值过滤', meta: `≥${threshold} · ${passed.length} 通过` },
    { num: 'v', label: '降序排序', meta: `返回 top ${topN}` },
  ];

  return (
    <main className="oc-main">
      <ConsolePageHd
        title="Breath 模拟"
        sub={<>记忆唤起的 5 阶段管线可视化 —— 输入 query 与情感坐标,观察候选记忆如何被四维评分、过滤、重排。</>}
        rightSlot={<div className="ob-page-counter"><b>{totalCandidates}</b> 候选 · <b>{finalList.length}</b> 命中</div>}
      />

      {error && (
        <div style={{
          margin: '0 0 14px',
          padding: '10px 14px',
          background: 'color-mix(in oklab, #c44 6%, var(--paper))',
          border: '0.5px solid color-mix(in oklab, #c44 35%, var(--line-2))',
          borderLeft: '2px solid #c44',
          borderRadius: 8,
          display: 'flex', alignItems: 'flex-start', gap: 10,
          fontSize: 12, lineHeight: 1.6, color: 'var(--ink-2)',
        }}>
          <span style={{ color: '#c44', fontFamily: 'var(--mono)', fontSize: 11, flexShrink: 0, marginTop: 1 }}>⚠ 后端失败</span>
          <span>{error}</span>
        </div>
      )}

      {/* 管线可视化 */}
      <ConsoleCard>
        <div className="oc-breath-pipeline">
          {stages.map((s, i) => (
            <div
              key={i}
              className={`oc-breath-stage${activeStage > i ? ' active' : ''}`}
            >
              <div className="oc-breath-stage-num">stage {s.num}</div>
              <div className="oc-breath-stage-name">{s.label}</div>
              <div className="oc-breath-stage-meta">{s.meta}</div>
            </div>
          ))}
        </div>
      </ConsoleCard>

      {/* 输入控制台 */}
      <ConsoleCard label="输入" sub='按 Enter 或点"模拟 Breath"运行管线'>
        <div className="oc-breath-form">
          <div className="oc-field">
            <div className="oc-field-label">Query</div>
            <input
              className="oc-input"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && runSimulation()}
              placeholder="输入想唤起的关键词…"
            />
          </div>
          <div className="oc-field">
            <div className="oc-field-label">Valence</div>
            <input
              type="range" min={0} max={1} step={0.05}
              value={valence}
              onChange={(e) => setValence(+e.target.value)}
              className="oc-slider"
            />
            <div className="oc-field-help">{valence.toFixed(2)} · {valence < 0.4 ? '低' : valence > 0.65 ? '正向' : '中性'}</div>
          </div>
          <div className="oc-field">
            <div className="oc-field-label">Arousal</div>
            <input
              type="range" min={0} max={1} step={0.05}
              value={arousal}
              onChange={(e) => setArousal(+e.target.value)}
              className="oc-slider"
            />
            <div className="oc-field-help">{arousal.toFixed(2)} · {arousal < 0.4 ? '平静' : arousal > 0.65 ? '激越' : '适度'}</div>
          </div>
          <button
            className="oc-btn oc-btn-primary"
            onClick={runSimulation}
            disabled={running}
          >
            {running ? '◐ 模拟中…' : '▶ 模拟 Breath'}
          </button>
        </div>
      </ConsoleCard>

      {/* 权重 + 阈值配置 */}
      <ConsoleCard label="权重配置" sub="权重展示后端真实值。阈值与 top N 在客户端二次过滤,不影响后端评分。">
        <div className="oc-weight-bar">
          <span><b>topic</b> = {weights.topic}</span>
          <span className="sep">·</span>
          <span><b>emotion</b> = {weights.emotion}</span>
          <span className="sep">·</span>
          <span><b>time</b> = {weights.time}</span>
          <span className="sep">·</span>
          <span><b>importance</b> = {weights.importance}</span>
          <span className="sep">|</span>
          <span>阈值 = <b>{threshold}</b></span>
          <span className="sep">|</span>
          <span>候选 = <b>{totalCandidates}</b></span>
          <span className="sep">→</span>
          <span>通过 <b>{passed.length}</b> 条</span>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 18, marginTop: 14 }}>
          <div className="oc-field-row">
            <div className="oc-field-label" style={{ marginBottom: 8 }}>命中阈值（0-100）</div>
            <input type="range" min={0} max={100} step={1} value={threshold} onChange={(e) => setThreshold(+e.target.value)} className="oc-slider" />
            <div className="oc-field-help">分数 ≥ {threshold} 才会进入排序阶段</div>
          </div>
          <div className="oc-field-row">
            <div className="oc-field-label" style={{ marginBottom: 8 }}>返回 top N</div>
            <input type="range" min={1} max={20} step={1} value={topN} onChange={(e) => setTopN(+e.target.value)} className="oc-slider" />
            <div className="oc-field-help">最终给上层的记忆条数 = {topN}</div>
          </div>
        </div>
      </ConsoleCard>

      {/* 候选条形图 */}
      <ConsoleCard
        label="候选评分"
        sub={`${results.length} 条 · ${passed.length} 过阈 · top ${topN} 入选`}
      >
        {!hasFetched ? (
          <div style={{ padding: '24px 0', textAlign: 'center', color: 'var(--ink-3)', fontSize: 12 }}>
            正在拉取后端数据…
          </div>
        ) : results.length === 0 ? (
          <div style={{ padding: '24px 0', textAlign: 'center', color: 'var(--ink-3)', fontSize: 12 }}>
            {error ? '后端返回错误,见上方提示' : '后端返回 0 条候选(全库可能为空,或 query 没匹配上)'}
          </div>
        ) : (
          <div className="oc-candidates">
            {results.slice(0, 18).map((s, i) => {
              const dropped = s.normalized < threshold || i >= topN;
              const sc = s.scores || {};
              return (
                <div key={s.id} className={`oc-cand${dropped ? ' dropped' : ''}`}>
                  <div className="oc-cand-rank">{String(i + 1).padStart(2, '0')}</div>
                  <div className="oc-cand-title" title={s.name}>{s.name || s.id}</div>
                  <div className="oc-cand-bars">
                    <BreathBar kind="topic" value={sc.topic || 0} weight={weights.topic} />
                    <BreathBar kind="emotion" value={sc.emotion || 0} weight={weights.emotion} />
                    <BreathBar kind="time" value={sc.time || 0} weight={weights.time} />
                    <BreathBar kind="imp" value={sc.importance || 0} weight={weights.importance} />
                  </div>
                  <div className="oc-cand-score">{(s.normalized || 0).toFixed(1)}</div>
                </div>
              );
            })}
          </div>
        )}
      </ConsoleCard>

      {/* ═══ 以下从配置页迁来: 检索打分微调 / 即时模拟 / 被想起 / 最近搜索 (2026-06-07) ═══ */}

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
    </main>
  );
}

function BreathBar({ kind, value, weight }) {
  const pct = Math.max(0, Math.min(1, value)) * 100;
  return (
    <div className="oc-cand-bar" title={`${kind} = ${value.toFixed(2)} (×${weight})`}>
      <div
        className={`oc-cand-bar-fill ${kind}`}
        style={{ width: `${pct}%` }}
      />
      <span className="oc-cand-bar-label">{kind}×{weight}</span>
    </div>
  );
}

window.BreathPage = BreathPage;
