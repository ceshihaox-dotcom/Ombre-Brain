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

  // 初次挂载自动跑一次,免得空白
  cbE(() => { runSimulation(); }, []);

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
