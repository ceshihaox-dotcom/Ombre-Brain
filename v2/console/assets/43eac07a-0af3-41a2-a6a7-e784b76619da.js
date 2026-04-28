// console-breath.jsx —— Breath 模拟管线
// 5 阶段：① 输入 → ② 候选 → ③ 四维评分 → ④ 阈值过滤 → ⑤ 重排序

const { useState: cbS, useEffect: cbE, useMemo: cbM } = React;

// 配置（与 v2 一致的 token）
const BREATH_WEIGHTS = {
  topic: 4, emotion: 2, time: 2.5, importance: 1
};
const BREATH_THRESHOLD = 50;
const BREATH_TOP_N = 4;

function BreathPage({ items }) {
  const [query, setQuery] = cbS('记忆');
  const [valence, setValence] = cbS(0.6);
  const [arousal, setArousal] = cbS(0.5);
  const [running, setRunning] = cbS(false);
  const [activeStage, setActiveStage] = cbS(0);
  const [topN, setTopN] = cbS(BREATH_TOP_N);
  const [threshold, setThreshold] = cbS(BREATH_THRESHOLD);

  // 候选评分（决定式：基于 query / 情感 / 时间 / 重要度）
  const scored = cbM(() => {
    const now = new Date('2026-04-26').getTime();
    return items.map((it) => {
      // topic：query 和 title/summary/tags 字符匹配模拟
      const text = `${it.title || ''} ${it.summary || ''} ${(it.tags || []).join(' ')}`;
      const topicHits = query ? (text.match(new RegExp(query, 'gi')) || []).length : 0;
      const topic = Math.min(1, topicHits * 0.35 + (text.length > 0 ? 0.05 : 0));

      // emotion：feel 项 + valence / arousal 接近度
      const itemValence = it.feel ? (it.importance >= 7 ? 0.78 : 0.55) : 0.5;
      const itemArousal = it.feel ? 0.6 : 0.3;
      const dValence = 1 - Math.abs(valence - itemValence);
      const dArousal = 1 - Math.abs(arousal - itemArousal);
      const emotion = (dValence + dArousal) / 2 * (it.feel ? 1 : 0.55);

      // time：最近活跃指数（30 天衰减）
      const ts = new Date(it.date || '2026-04-01').getTime();
      const days = Math.max(0, (now - ts) / (1000 * 86400));
      const time = Math.exp(-days / 14);

      // importance
      const imp = (it.importance || 5) / 10;

      // 加权
      const w = BREATH_WEIGHTS;
      const raw = topic * w.topic + emotion * w.emotion + time * w.time + imp * w.importance;
      const total = w.topic + w.emotion + w.time + w.importance;
      const score = (raw / total) * 100;

      return { ...it, _topic: topic, _emotion: emotion, _time: time, _imp: imp, _score: score };
    }).sort((a, b) => b._score - a._score);
  }, [items, query, valence, arousal]);

  const passed = scored.filter(s => s._score >= threshold);
  const finalList = passed.slice(0, topN);

  // 阶段动画
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
  };

  cbE(() => { setActiveStage(5); }, []);  // 默认全亮

  const stages = [
    { num: 'i', label: '输入', meta: 'query / valence / arousal' },
    { num: 'ii', label: '候选', meta: `${items.length} 条` },
    { num: 'iii', label: '四维评分', meta: `topic×4 + emotion×2 + time×2.5 + imp×1` },
    { num: 'iv', label: '阈值过滤', meta: `≥${threshold} · ${passed.length} 通过` },
    { num: 'v', label: '降序排序', meta: `返回 top ${topN}` },
  ];

  return (
    <main className="oc-main">
      <ConsolePageHd
        title="Breath 模拟"
        sub={<>记忆唤起的 5 阶段管线可视化 —— 输入 query 与情感坐标,观察候选记忆如何被四维评分、过滤、重排。</>}
        rightSlot={<div className="ob-page-counter"><b>{items.length}</b> 候选 · <b>{finalList.length}</b> 命中</div>}
      />

      {/* 概念演示提示 — 防止误解为真实行为 */}
      <div style={{
        margin: '0 0 14px',
        padding: '10px 14px',
        background: 'color-mix(in oklab, #b08040 6%, var(--paper))',
        border: '0.5px solid color-mix(in oklab, #b08040 35%, var(--line-2))',
        borderLeft: '2px solid #b08040',
        borderRadius: 8,
        display: 'flex', alignItems: 'flex-start', gap: 10,
        fontSize: 12, lineHeight: 1.6, color: 'var(--ink-2)',
      }}>
        <span style={{ color: '#b08040', fontFamily: 'var(--mono)', fontSize: 11, flexShrink: 0, marginTop: 1 }}>⚠ 概念演示</span>
        <span>
          此页是 breath 唤起逻辑的<b>可视化教学</b>,使用前端简化模型(4 维加权)。
          后端真实 breath 走的是 <code style={{ fontFamily: 'var(--mono)', fontSize: 11.5, color: 'var(--ink-3)' }}>BM25 关键词 + embedding 语义</code> 混合检索,
          调这里的权重和阈值<b style={{ color: '#b08040' }}>不影响真实行为</b>。想看真实唤起结果请用工作台"全库相似"或 breath 工具直接调用。
        </span>
      </div>

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
      <ConsoleCard label="权重配置" sub="在线调整四维权重与命中阈值。提交后会立即重算评分。">
        <div className="oc-weight-bar">
          <span><b>topic</b> = {BREATH_WEIGHTS.topic}</span>
          <span className="sep">·</span>
          <span><b>emotion</b> = {BREATH_WEIGHTS.emotion}</span>
          <span className="sep">·</span>
          <span><b>time</b> = {BREATH_WEIGHTS.time}</span>
          <span className="sep">·</span>
          <span><b>importance</b> = {BREATH_WEIGHTS.importance}</span>
          <span className="sep">|</span>
          <span>阈值 = <b>{threshold}</b></span>
          <span className="sep">|</span>
          <span>候选 = <b>{items.length}</b></span>
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
        sub={`${scored.length} 条 · ${passed.length} 过阈 · top ${topN} 入选`}
      >
        <div className="oc-candidates">
          {scored.slice(0, 18).map((s, i) => {
            const dropped = s._score < threshold || i >= topN;
            return (
              <div key={s.id} className={`oc-cand${dropped ? ' dropped' : ''}`}>
                <div className="oc-cand-rank">{String(i + 1).padStart(2, '0')}</div>
                <div className="oc-cand-title" title={s.title}>{s.title || s.id}</div>
                <div className="oc-cand-bars">
                  <BreathBar kind="topic" value={s._topic} weight={BREATH_WEIGHTS.topic} />
                  <BreathBar kind="emotion" value={s._emotion} weight={BREATH_WEIGHTS.emotion} />
                  <BreathBar kind="time" value={s._time} weight={BREATH_WEIGHTS.time} />
                  <BreathBar kind="imp" value={s._imp} weight={BREATH_WEIGHTS.importance} />
                </div>
                <div className="oc-cand-score">{s._score.toFixed(1)}</div>
              </div>
            );
          })}
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
