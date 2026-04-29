/* app.jsx —— Ombre 手机端
 * Phase 1:基础 + 记忆 tab(首页天卡 / 当天详情 / 单条全貌)接通真后端
 *           日历 / 审阅 / 设置 / 创建 暂用占位屏,下次 chunk 填
 */

const { useState, useEffect, useMemo, useCallback } = React;

// ─────────────────────────────────────────
// API
// ─────────────────────────────────────────

async function api(path, opts) {
  const r = await fetch(path, opts);
  if (!r.ok) throw new Error(`HTTP ${r.status} ${r.statusText}`);
  return await r.json();
}

// ─────────────────────────────────────────
// Hash routing —— 仅 hash,server.py 不用动
//   #/                 → 首页
//   #/day/2026-04-26   → 当天详情
//   #/mem/<id>         → 单条全貌
//   #/cal              → 日历
//   #/review           → 审阅
//   #/setting          → 设置(主)
//   #/setting/trash    → 回收站
//   #/setting/import   → 导入(stub)
//   #/new              → 创建新条目
// ─────────────────────────────────────────

function parseHash() {
  const raw = (window.location.hash || '').replace(/^#\/?/, '');
  const parts = raw.split('/').filter(Boolean);
  return parts;
}

function navigate(path) {
  const next = path.startsWith('/') ? path : '/' + path;
  window.location.hash = '#' + next;
}

function useRoute() {
  const [parts, setParts] = useState(parseHash);
  useEffect(() => {
    const h = () => setParts(parseHash());
    window.addEventListener('hashchange', h);
    return () => window.removeEventListener('hashchange', h);
  }, []);
  return parts;
}

// ─────────────────────────────────────────
// Date / format helpers
// ─────────────────────────────────────────

const MO_EN = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
const WK_EN = ['sun','mon','tue','wed','thu','fri','sat'];

function bucketDate(b) {
  // 优先 event_time(用户/AI 设置的实际发生时间),否则 created
  const raw = b.event_time || b.created || b.last_active || '';
  if (!raw) return null;
  const dt = new Date(raw);
  if (isNaN(dt.getTime())) return null;
  return dt;
}

function dayKeyOf(dt) {
  // 本地时区 YYYY-MM-DD
  const y = dt.getFullYear();
  const m = String(dt.getMonth() + 1).padStart(2, '0');
  const d = String(dt.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function fmtDay(dt) {
  return {
    num: String(dt.getDate()),
    mo: MO_EN[dt.getMonth()],
    wk: WK_EN[dt.getDay()],
    year: String(dt.getFullYear()),
  };
}

function fmtTime(dt) {
  const h = String(dt.getHours()).padStart(2, '0');
  const m = String(dt.getMinutes()).padStart(2, '0');
  return `${h}:${m}`;
}

function isFeel(b) {
  return (b.tags || []).some(t => /feel/i.test(String(t)));
}

function bucketTitle(b) {
  return b.name || b.id;
}

function bucketSummary(b) {
  return b.summary || b.content_preview || '';
}

// ─────────────────────────────────────────
// 共用小组件
// ─────────────────────────────────────────

function ImpBar({ n, max = 9, height = 9, w = 2.5, gap = 1.5 }) {
  return (
    <span className="day-card-impbar" style={{ height: height + 'px', gap: gap + 'px' }}>
      {Array.from({ length: max }).map((_, i) => (
        <i key={i} style={{
          width: w + 'px',
          height: ((i + 1) / max * height + 1).toFixed(1) + 'px',
          background: i < n ? 'var(--accent)' : 'var(--bg-2)',
          borderRadius: '1px',
        }}/>
      ))}
    </span>
  );
}

function TabBar({ active }) {
  const tabs = [
    { id: 'home',    href: '/',         ic: '◐', label: '记忆' },
    { id: 'review',  href: '/review',   ic: '✓', label: '审阅' },
    { id: 'cal',     href: '/cal',      ic: '▦', label: '日历' },
    { id: 'setting', href: '/setting',  ic: '⚙', label: '设置' },
  ];
  return (
    <div className="tabbar">
      {tabs.map(t => (
        <button
          key={t.id}
          className={'tabbar-item' + (active === t.id ? ' on' : '')}
          onClick={() => navigate(t.href)}
        >
          <span className="ic">{t.ic}</span>
          <span>{t.label}</span>
        </button>
      ))}
    </div>
  );
}

// ─────────────────────────────────────────
// 屏 1 · 首页(天卡折叠)
// ─────────────────────────────────────────

function HomeScreen() {
  const [buckets, setBuckets] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    let cancel = false;
    api('/api/buckets')
      .then(d => { if (!cancel) setBuckets(Array.isArray(d) ? d : []); })
      .catch(e => { if (!cancel) setError(e.message); });
    return () => { cancel = true; };
  }, []);

  // 按日期分组(本地时区)
  const days = useMemo(() => {
    if (!buckets) return [];
    const grouped = new Map();
    for (const b of buckets) {
      const dt = bucketDate(b);
      if (!dt) continue;
      const k = dayKeyOf(dt);
      if (!grouped.has(k)) grouped.set(k, { dt, items: [] });
      grouped.get(k).items.push({ b, dt });
    }
    const arr = Array.from(grouped.entries()).map(([k, { dt, items }]) => {
      // 当天内按时间倒序
      items.sort((a, b) => b.dt - a.dt);
      const peakImp = items.reduce((m, it) => Math.max(m, it.b.importance || 5), 0);
      const dots = new Set();
      let hasHi = false;
      for (const { b } of items) {
        if (b.highlight) { dots.add('hi'); hasHi = true; }
        if (isFeel(b)) dots.add('feel');
        if (b.created_by === 'ai') dots.add('ai');
        if (b.created_by === 'user') dots.add('note');
      }
      return {
        key: k,
        dt,
        dayFmt: fmtDay(dt),
        cnt: items.length,
        peakImp,
        hi: hasHi,
        dots: Array.from(dots),
        items,
      };
    });
    arr.sort((a, b) => b.dt - a.dt);
    return arr;
  }, [buckets]);

  if (error) return (
    <div className="home">
      <div className="app-error">后端错: {error}</div>
      <TabBar active="home"/>
    </div>
  );
  if (!buckets) return (
    <div className="home">
      <div className="app-loading">载入中…</div>
      <TabBar active="home"/>
    </div>
  );

  return (
    <div className="home">
      <div className="home-top">
        <div className="home-brand">
          <div className="home-brand-mark"/>
          <span className="home-brand-name">Ombre</span>
          <div className="home-brand-stat">
            <b>{buckets.length}</b> mem · <b>{days.length}</b> 天
          </div>
        </div>
        <div className="home-search" onClick={() => { /* TODO: 搜索 */ }}>
          <span className="home-search-icon">⌕</span>
          <span className="home-search-text">搜索记忆 / 标签 / 内容…</span>
          <div className="home-search-mood" title="情感唤起"/>
        </div>
        <div className="home-chips">
          <span className="home-chip on">全部</span>
          <span className="home-chip hi">★ highlight</span>
          <span className="home-chip feel">feel</span>
          <span className="home-chip">近 7 天</span>
          <span className="home-chip">imp ≥ 7</span>
          <span className="home-chip">AI 写入</span>
        </div>
      </div>

      <div className="home-body">
        <div className="home-mood-row">
          <div className="home-mood-pad"/>
          <div className="home-mood-text">
            <b>情感唤起</b> · 按住罗盘选一个情绪坐标,看 AI 怎么挑相关记忆
          </div>
          <span className="home-mood-arrow">›</span>
        </div>

        {days.length === 0 && (
          <div style={{ textAlign: 'center', color: 'var(--ink-4)', padding: '40px 0', fontFamily: 'var(--mono)', fontSize: 11, letterSpacing: '0.1em' }}>
            没有记忆 — 先去后端导入或手动加几条
          </div>
        )}

        {days.map(d => (
          <div
            key={d.key}
            className={'day-card' + (d.hi ? ' hi' : '')}
            onClick={() => navigate('/day/' + d.key)}
          >
            <div className="day-card-hd">
              <div className="day-card-date">
                <div className="day-card-num">{d.dayFmt.num}</div>
                <div className="day-card-mo">{d.dayFmt.mo}</div>
                <div className="day-card-wk">{d.dayFmt.wk}</div>
              </div>
              <div className="day-card-mid">
                <div className="day-card-stat-row">
                  <span className="day-card-cnt"><b>{d.cnt}</b> 条</span>
                  <ImpBar n={d.peakImp}/>
                  <span style={{ color: 'var(--ink-4)' }}>峰 {d.peakImp}</span>
                  <span className="day-card-dots">
                    {d.dots.map((dt, i) => <span key={i} className={'day-card-dot ' + dt}/>)}
                  </span>
                </div>
                <div className="day-card-preview">
                  {d.items.slice(0, 2).map(({ b, dt }, i) => (
                    <div key={i} className="day-card-preview-row">
                      <span className="day-card-preview-time">{fmtTime(dt)}</span>
                      <span className="day-card-preview-title">{bucketTitle(b)}</span>
                      {isFeel(b) && <span className="day-card-preview-pip feel"/>}
                      {b.highlight && <span className="day-card-preview-pip hi"/>}
                    </div>
                  ))}
                  {d.cnt > 2 && (
                    <div className="day-card-more">+ 还有 {d.cnt - 2} 条 →</div>
                  )}
                </div>
              </div>
              <span className="day-card-arrow">›</span>
            </div>
          </div>
        ))}
      </div>

      <button className="home-fab" onClick={() => navigate('/new')} title="写新记忆">+</button>
      <TabBar active="home"/>
    </div>
  );
}

// ─────────────────────────────────────────
// 屏 2 · 当天详情
// ─────────────────────────────────────────

function DayDetailScreen({ dayKey }) {
  const [buckets, setBuckets] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    let cancel = false;
    api('/api/buckets')
      .then(d => { if (!cancel) setBuckets(Array.isArray(d) ? d : []); })
      .catch(e => { if (!cancel) setError(e.message); });
    return () => { cancel = true; };
  }, []);

  const dayInfo = useMemo(() => {
    if (!buckets) return null;
    const items = [];
    for (const b of buckets) {
      const dt = bucketDate(b);
      if (!dt) continue;
      if (dayKeyOf(dt) === dayKey) items.push({ b, dt });
    }
    items.sort((a, b) => b.dt - a.dt);
    const refDt = (items[0] && items[0].dt) || new Date(dayKey + 'T12:00:00');
    return {
      items,
      dayFmt: fmtDay(refDt),
      stats: {
        total: items.length,
        feel: items.filter(({ b }) => isFeel(b)).length,
        hi: items.filter(({ b }) => b.highlight).length,
        ai: items.filter(({ b }) => b.created_by === 'ai').length,
      },
    };
  }, [buckets, dayKey]);

  if (error) return (
    <div className="day-detail">
      <div className="app-error">后端错: {error}</div>
      <TabBar active="home"/>
    </div>
  );
  if (!buckets || !dayInfo) return (
    <div className="day-detail">
      <div className="app-loading">载入中…</div>
      <TabBar active="home"/>
    </div>
  );

  return (
    <div className="day-detail">
      <div className="day-detail-top">
        <div className="day-detail-back-row">
          <button className="app-back" onClick={() => navigate('/')}>‹ 记忆</button>
          <span className="app-eyebrow" style={{ marginLeft: 'auto' }}>
            <span>当天 · {dayInfo.items.length}</span>
          </span>
        </div>
        <div className="day-detail-date">
          {dayInfo.dayFmt.num}
          <span className="day-detail-date-mo">{dayInfo.dayFmt.mo} · {dayInfo.dayFmt.year}</span>
          <span className="day-detail-date-wk">{dayInfo.dayFmt.wk}</span>
        </div>
        <div className="day-detail-stats">
          <span><b>{dayInfo.stats.total}</b> 条</span>
          {dayInfo.stats.feel > 0 && <span><b>{dayInfo.stats.feel}</b> feel</span>}
          {dayInfo.stats.hi > 0 && <span><b>{dayInfo.stats.hi}</b> hi</span>}
          {dayInfo.stats.ai > 0 && <span><b>{dayInfo.stats.ai}</b> AI</span>}
        </div>
      </div>

      <div className="day-detail-body">
        {dayInfo.items.length === 0 && (
          <div style={{ textAlign: 'center', color: 'var(--ink-4)', padding: '40px 0', fontFamily: 'var(--mono)', fontSize: 11, letterSpacing: '0.1em' }}>
            这天没有记忆
          </div>
        )}
        {dayInfo.items.map(({ b, dt }) => (
          <div
            key={b.id}
            className={'dd-item' + (b.highlight ? ' hi' : '')}
            onClick={() => navigate('/mem/' + encodeURIComponent(b.id))}
          >
            <span className="dd-item-time">{fmtTime(dt)}</span>
            <div className="dd-item-mid">
              <div className="dd-item-title-row">
                <span className="dd-item-title">{bucketTitle(b)}</span>
                <span className="dd-item-tags">
                  {isFeel(b) && <span className="dd-pip feel"/>}
                  {b.highlight && <span className="dd-pip hi"/>}
                  {b.created_by === 'ai' && <span className="dd-pip ai"/>}
                </span>
              </div>
              <div className="dd-item-snip">{bucketSummary(b)}</div>
            </div>
            <span className="dd-item-imp">
              {Array.from({ length: 9 }).map((_, k) => (
                <i key={k} style={{
                  height: ((k + 1) * 1.4 + 3) + 'px',
                  background: k < (b.importance || 5) ? 'var(--accent)' : 'var(--bg-2)',
                }}/>
              ))}
            </span>
          </div>
        ))}
      </div>

      <TabBar active="home"/>
    </div>
  );
}

// ─────────────────────────────────────────
// 屏 3 · 单条全貌
// ─────────────────────────────────────────

function MemFullScreen({ id }) {
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    let cancel = false;
    api('/api/bucket/' + encodeURIComponent(id))
      .then(d => { if (!cancel) setData(d); })
      .catch(e => { if (!cancel) setError(e.message); });
    return () => { cancel = true; };
  }, [id]);

  if (error) return (
    <div className="mem-full">
      <div className="app-error">后端错: {error}</div>
      <TabBar active="home"/>
    </div>
  );
  if (!data) return (
    <div className="mem-full">
      <div className="app-loading">载入中…</div>
      <TabBar active="home"/>
    </div>
  );

  const m = data.metadata || {};
  const dt = bucketDate({ event_time: m.event_time, created: m.created, last_active: m.last_active });
  const dayFmt = dt ? fmtDay(dt) : null;
  const time = dt ? fmtTime(dt) : '';
  const tags = (m.tags || []).filter(t => !String(t).startsWith('__')); // 隐藏 __* 内部 tag
  const feel = tags.some(t => /feel/i.test(String(t)));
  const importance = m.importance || 5;
  const content = data.content || '';
  // 把 content 拆成段落渲染(空行分段)
  const paragraphs = content.split(/\n\s*\n/).map(s => s.trim()).filter(Boolean);

  return (
    <div className="mem-full">
      <div className="mem-full-top">
        <div className="mem-full-back-row">
          <button className="app-back" onClick={() => window.history.back()}>
            ‹ {dayFmt ? `${dayFmt.num} ${dayFmt.mo}` : '返回'}
          </button>
          <span className="app-eyebrow" style={{ marginLeft: 'auto' }}>
            <span>记忆全貌</span>
          </span>
        </div>
        <div className="mem-full-meta">
          {dayFmt && <span>{dayFmt.num} {dayFmt.mo} {dayFmt.year}</span>}
          {time && <><span>·</span><span><b>{time}</b></span></>}
          <span>·</span>
          <span>{m.created_by === 'ai' ? 'AI 写入' : '亲手写'}</span>
        </div>
      </div>

      <div className="mem-full-body">
        <div className="mem-full-tags">
          {m.highlight && <span className="mem-full-tag hi">★ highlight</span>}
          {feel && <span className="mem-full-tag feel">feel</span>}
          {tags.map((t, i) => <span key={i} className="mem-full-tag">{t}</span>)}
        </div>

        <h1 className="mem-full-title">{m.name || data.id}</h1>

        <div className="mem-full-imp-row">
          <span>重要度</span>
          <span className="mem-full-imp-bar">
            {Array.from({ length: 9 }).map((_, i) => (
              <i key={i} style={{
                height: ((i + 1) * 0.9 + 3) + 'px',
                background: i < importance ? 'var(--accent)' : 'var(--bg-2)',
              }}/>
            ))}
          </span>
          <b style={{
            fontFamily: 'var(--serif)', fontStyle: 'italic',
            color: 'var(--accent)', fontWeight: 600, fontSize: '15px'
          }}>{importance} / 9</b>
        </div>

        {m.summary && (
          <>
            <div className="mem-full-section-hd">摘要 · summary</div>
            <div className="mem-full-text">
              <p className="lead">{m.summary}</p>
            </div>
          </>
        )}

        {paragraphs.length > 0 && (
          <>
            <div className="mem-full-section-hd">原文 · content</div>
            <div className="mem-full-text">
              {paragraphs.map((p, i) => <p key={i}>{p}</p>)}
            </div>
          </>
        )}

        {paragraphs.length === 0 && !m.summary && (
          <div style={{ color: 'var(--ink-4)', fontFamily: 'var(--mono)', fontSize: 11, letterSpacing: '0.1em', padding: '20px 0' }}>
            (这条记忆暂无正文)
          </div>
        )}
      </div>

      <div className="mem-full-action">
        <div className="mem-full-fab" title="编辑(暂未实装)">✎</div>
      </div>

      <TabBar active="home"/>
    </div>
  );
}

// ─────────────────────────────────────────
// 占位屏(下次 chunk 实装)
// ─────────────────────────────────────────

function PlaceholderScreen({ tab, ic, title, sub }) {
  return (
    <div style={{ height: '100%', position: 'relative', background: 'var(--bg)' }}>
      <div className="placeholder-screen">
        <div className="ic">{ic}</div>
        <h2>{title}</h2>
        <p>{sub}</p>
      </div>
      <TabBar active={tab}/>
    </div>
  );
}

// ─────────────────────────────────────────
// App · 路由分发
// ─────────────────────────────────────────

function App() {
  const route = useRoute();
  const [head, ...rest] = route;

  // 路由表
  switch (head) {
    case undefined:
    case '':
    case 'home':
      return <HomeScreen/>;
    case 'day':
      return <DayDetailScreen dayKey={rest[0] || ''}/>;
    case 'mem':
      return <MemFullScreen id={rest[0] || ''}/>;
    case 'review':
      return <PlaceholderScreen tab="review" ic="✓" title="审阅台" sub="下个 chunk 实装"/>;
    case 'cal':
      return <PlaceholderScreen tab="cal" ic="▦" title="日历" sub="下个 chunk · 双模式"/>;
    case 'setting':
      if (rest[0] === 'trash') return <PlaceholderScreen tab="setting" ic="⌫" title="回收站" sub="下个 chunk 实装"/>;
      if (rest[0] === 'import') return <PlaceholderScreen tab="setting" ic="↥" title="导入" sub="下个 chunk · stub"/>;
      return <PlaceholderScreen tab="setting" ic="⚙" title="设置" sub="下个 chunk 实装"/>;
    case 'new':
      return <PlaceholderScreen tab="home" ic="＋" title="写新记忆" sub="下个 chunk 实装"/>;
    default:
      return <PlaceholderScreen tab="home" ic="?" title="未知路由" sub={'#/' + route.join('/')}/>;
  }
}

ReactDOM.createRoot(document.getElementById('root')).render(<App/>);
