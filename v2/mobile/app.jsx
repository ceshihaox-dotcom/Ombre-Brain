/* app.jsx —— Ombre 手机端
 * Phase 1:基础 + 记忆 tab(首页天卡 / 当天详情 / 单条全貌)接通真后端
 *           日历 / 审阅 / 设置 / 创建 暂用占位屏,下次 chunk 填
 */

const { useState, useEffect, useMemo, useCallback, useRef } = React;

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

// ISO 字符串 ↔ datetime-local 输入(YYYY-MM-DDTHH:MM,本地时区)
function toLocalDateTimeStr(iso) {
  if (!iso) return '';
  const dt = new Date(iso);
  if (isNaN(dt.getTime())) return '';
  const tzMs = dt.getTimezoneOffset() * 60000;
  return new Date(dt.getTime() - tzMs).toISOString().slice(0, 16);
}
function fromLocalDateTimeStr(local) {
  if (!local) return '';
  const dt = new Date(local);
  if (isNaN(dt.getTime())) return '';
  return dt.toISOString();
}

// ─────────────────────────────────────────
// 共用小组件
// ─────────────────────────────────────────

function ImpBar({ n, max = 10, height = 9, w = 2.5, gap = 1.5 }) {
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
    { id: 'setting', href: '/setting',  ic: '⊙', label: '设置' },
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
  const [searchQuery, setSearchQuery] = useState('');
  const [filters, setFilters] = useState(() => new Set());
  const [moodOpen, setMoodOpen] = useState(false);

  useEffect(() => {
    let cancel = false;
    api('/api/buckets')
      .then(d => { if (!cancel) setBuckets(Array.isArray(d) ? d : []); })
      .catch(e => { if (!cancel) setError(e.message); });
    return () => { cancel = true; };
  }, []);

  const toggleFilter = (key) => {
    setFilters(prev => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  // 应用 chip 筛选 + 搜索 → flat 结果集
  const filteredBuckets = useMemo(() => {
    if (!buckets) return [];
    let result = buckets;
    if (filters.has('hi'))      result = result.filter(b => b.highlight);
    if (filters.has('feel'))    result = result.filter(b => isFeel(b));
    if (filters.has('recent7')) {
      const cutoff = Date.now() - 7 * 86400000;
      result = result.filter(b => {
        const dt = bucketDate(b);
        return dt && dt.getTime() >= cutoff;
      });
    }
    if (filters.has('imp7')) result = result.filter(b => (b.importance || 5) >= 7);
    if (filters.has('ai'))   result = result.filter(b => b.created_by === 'ai');

    const q = searchQuery.trim().toLowerCase();
    if (q) {
      result = result.filter(b => {
        const visTags = (b.tags || []).filter(t => !String(t).startsWith('__')).join(' ');
        const hay = ((b.name || '') + ' ' + (b.summary || '') + ' ' + (b.content_preview || '') + ' ' + visTags).toLowerCase();
        return hay.indexOf(q) >= 0;
      });
    }
    return result;
  }, [buckets, filters, searchQuery]);

  // 默认模式:按本地日期分组
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
      return { key: k, dt, dayFmt: fmtDay(dt), cnt: items.length, peakImp, hi: hasHi, dots: Array.from(dots), items };
    });
    arr.sort((a, b) => b.dt - a.dt);
    return arr;
  }, [buckets]);

  const isFiltering = !!searchQuery.trim() || filters.size > 0;
  const flatResults = useMemo(() => {
    if (!isFiltering) return null;
    return [...filteredBuckets].sort((a, b) => {
      const ta = bucketDate(a), tb = bucketDate(b);
      if (!ta && !tb) return 0;
      if (!ta) return 1;
      if (!tb) return -1;
      return tb - ta;
    });
  }, [isFiltering, filteredBuckets]);

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
        <div className="home-hd-row">
          <div className="home-hd-l">
            <h1 className="home-page-title">
              <span className="home-page-mark"/>
              Ombre Brain
            </h1>
            <p className="home-page-sub">按事件时间倒序 · 点天卡看当日全部</p>
          </div>
          <div className="home-page-stat">
            <b>{buckets.length}</b> 条<br/>
            <b>{days.length}</b> 天
          </div>
        </div>

        <div className="home-search">
          <span className="home-search-icon">⌕</span>
          <input
            className="home-search-text"
            type="text"
            placeholder="搜索记忆 / 标签 / 内容…"
            value={searchQuery}
            onChange={e => setSearchQuery(e.target.value)}
          />
          {searchQuery && (
            <button className="home-search-clear" onClick={() => setSearchQuery('')} title="清空">×</button>
          )}
          <div
            className="home-search-mood"
            title="情感唤起 · 选一个心情坐标"
            role="button"
            onClick={() => setMoodOpen(true)}
          />
        </div>

        <div className="home-chips">
          <span
            className={'home-chip' + (filters.size === 0 ? ' on' : '')}
            onClick={() => setFilters(new Set())}
          >全部</span>
          <span
            className={'home-chip hi' + (filters.has('hi') ? ' on' : '')}
            onClick={() => toggleFilter('hi')}
          >★ highlight</span>
          <span
            className={'home-chip feel' + (filters.has('feel') ? ' on' : '')}
            onClick={() => toggleFilter('feel')}
          >feel</span>
          <span
            className={'home-chip' + (filters.has('recent7') ? ' on' : '')}
            onClick={() => toggleFilter('recent7')}
          >近 7 天</span>
          <span
            className={'home-chip' + (filters.has('imp7') ? ' on' : '')}
            onClick={() => toggleFilter('imp7')}
          >imp ≥ 7</span>
          <span
            className={'home-chip' + (filters.has('ai') ? ' on' : '')}
            onClick={() => toggleFilter('ai')}
          >AI 写入</span>
        </div>
      </div>

      <div className="home-body">
        {isFiltering ? (
          <>
            <div className="filter-result-meta">
              共 <b>{flatResults.length}</b> 条
              {searchQuery.trim() && <span> · 关键词「{searchQuery.trim()}」</span>}
              {filters.size > 0 && <span> · {filters.size} 个筛选</span>}
              <button className="clear-all" onClick={() => { setSearchQuery(''); setFilters(new Set()); }}>清空 ↺</button>
            </div>
            {flatResults.length === 0 && (
              <div style={{ color: 'var(--ink-4)', textAlign: 'center', padding: '40px 0', fontFamily: 'var(--mono)', fontSize: 11, letterSpacing: '0.1em' }}>
                没有匹配的记忆
              </div>
            )}
            {flatResults.slice(0, 100).map(b => {
              const dt = bucketDate(b);
              return (
                <div
                  key={b.id}
                  className={'dd-item' + (b.highlight ? ' hi' : '')}
                  onClick={() => navigate('/mem/' + encodeURIComponent(b.id))}
                >
                  <span className="dd-item-time">{dt ? `${fmtDay(dt).num} ${fmtDay(dt).mo}` : '—'}</span>
                  <div className="dd-item-mid">
                    <div className="dd-item-title-row">
                      <span className="dd-item-title">{b.name || b.id}</span>
                      <span className="dd-item-tags">
                        {isFeel(b) && <span className="dd-pip feel"/>}
                        {b.highlight && <span className="dd-pip hi"/>}
                        {b.created_by === 'ai' && <span className="dd-pip ai"/>}
                      </span>
                    </div>
                    <div className="dd-item-snip">{bucketSummary(b)}</div>
                  </div>
                  <span className="dd-item-imp">
                    {Array.from({ length: 10 }).map((_, k) => (
                      <i key={k} style={{
                        height: ((k + 1) * 1.2 + 3) + 'px',
                        background: k < (b.importance || 5) ? 'var(--accent)' : 'var(--bg-2)',
                      }}/>
                    ))}
                  </span>
                </div>
              );
            })}
            {flatResults.length > 100 && (
              <div style={{ color: 'var(--ink-4)', textAlign: 'center', padding: '20px 0', fontFamily: 'var(--mono)', fontSize: 10, letterSpacing: '0.08em' }}>
                · 余 {flatResults.length - 100} 条未显示 — 缩小筛选范围 ·
              </div>
            )}
          </>
        ) : (
          <>
            <div className="home-mood-row" role="button" onClick={() => setMoodOpen(true)}>
              <div className="home-mood-pad"/>
              <div className="home-mood-text">
                <b>情感唤起</b> · 选一个情绪坐标, 看 AI 用这个心情串相关记忆
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
          </>
        )}
      </div>

      <button className="home-fab" onClick={() => navigate('/new')} title="写新记忆">+</button>
      <TabBar active="home"/>

      {moodOpen && <MoodEvokeOverlay onClose={() => setMoodOpen(false)}/>}
    </div>
  );
}

// ─────────────────────────────────────────
// 情感唤起浮层 (MoodEvokeOverlay)
// 2D pad: 横轴 valence(左消极→右积极) / 纵轴 arousal(下平静→上激动)
// 选定坐标 → POST /api/mood-evoke → 返回叙事 + 引用源
// ─────────────────────────────────────────
// 灵敏度档位 → radius (距离上限, 含象限加权)
const MOOD_RADIUS = { strict: 0.20, normal: 0.35, loose: 0.60 };

function MoodEvokeOverlay({ onClose }) {
  // 默认中性偏低, 让用户自己挪
  const [v, setV] = useState(0.5);
  const [a, setA] = useState(0.4);
  const [sens, setSens] = useState('normal');   // strict / normal / loose
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState(null);   // { narrative, sources, mood_label, relaxed }
  const [error, setError] = useState(null);
  // 源记忆全文预览浮层: { id, name, content, loading?, error? }
  // 同一条再点关闭(toggle), 不同条切换显示
  const [preview, setPreview] = useState(null);
  const padRef = useRef(null);

  const openSource = async (src) => {
    // 同一条再点 → 关闭
    if (preview && preview.id === src.id) { setPreview(null); return; }
    setPreview({ id: src.id, name: src.name, loading: true });
    try {
      const r = await fetch('/api/bucket/' + encodeURIComponent(src.id));
      const d = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(d.error || ('HTTP ' + r.status));
      setPreview(p => p && p.id === src.id ? { ...p, loading: false, content: d.content || '', meta: d.metadata || {} } : p);
    } catch (e) {
      setPreview(p => p && p.id === src.id ? { ...p, loading: false, error: e.message } : p);
    }
  };

  // pad 拖动: pointer 事件统一处理 mouse/touch
  const handlePointer = (e) => {
    const el = padRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const px = (e.clientX ?? (e.touches && e.touches[0]?.clientX) ?? 0) - rect.left;
    const py = (e.clientY ?? (e.touches && e.touches[0]?.clientY) ?? 0) - rect.top;
    const vx = Math.max(0, Math.min(1, px / rect.width));
    // 屏幕 y 向下增大, arousal 反过来(上=高)
    const vy = Math.max(0, Math.min(1, 1 - py / rect.height));
    setV(vx);
    setA(vy);
  };

  const onPadDown = (e) => {
    e.preventDefault();
    handlePointer(e);
    const move = (ev) => handlePointer(ev);
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  };

  const moodLabel = (() => {
    const hiA = a >= 0.6, loA = a <= 0.4;
    const posV = v >= 0.6, negV = v <= 0.4;
    if (posV && hiA) return '兴奋 / 欣快';
    if (posV && loA) return '平和 / 满足';
    if (negV && hiA) return '焦虑 / 愤怒';
    if (negV && loA) return '低落 / 沮丧';
    if (hiA) return '激动';
    if (loA) return '平静';
    if (posV) return '微微正向';
    if (negV) return '微微负向';
    return '中性';
  })();

  const submit = async () => {
    if (busy) return;
    setBusy(true);
    setError(null);
    setResult(null);
    try {
      const r = await fetch('/api/mood-evoke', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ valence: v, arousal: a, top_n: 5, radius: MOOD_RADIUS[sens] }),
      });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(d.error || ('HTTP ' + r.status));
      setResult(d);
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="mood-overlay" onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="mood-sheet">
        <div className="mood-hd">
          <div>
            <div className="mood-hd-eyebrow">MOOD · evoke</div>
            <div className="mood-hd-ttl">情感唤起</div>
          </div>
          <button className="mood-x" onClick={onClose} aria-label="关闭">×</button>
        </div>

        <div className="mood-pad-wrap">
          {/* 四角参照标签 */}
          <span className="mood-pad-corner tl">焦虑 / 愤怒</span>
          <span className="mood-pad-corner tr">兴奋 / 欣快</span>
          <span className="mood-pad-corner bl">低落 / 沮丧</span>
          <span className="mood-pad-corner br">平和 / 满足</span>
          {/* 轴标签 */}
          <span className="mood-pad-axis ax-v">→ 效价 valence</span>
          <span className="mood-pad-axis ax-a">↑ 唤醒 arousal</span>
          {/* pad 本体 */}
          <div
            ref={padRef}
            className="mood-pad"
            onPointerDown={onPadDown}
          >
            <div className="mood-pad-grid"/>
            <div className="mood-pad-cross-h"/>
            <div className="mood-pad-cross-v"/>
            <div
              className="mood-pad-dot"
              style={{ left: `${v * 100}%`, top: `${(1 - a) * 100}%` }}
            />
          </div>
        </div>

        <div className="mood-meta">
          <span><b>{moodLabel}</b></span>
          <span className="mood-meta-coord">v {v.toFixed(2)} · a {a.toFixed(2)}</span>
        </div>

        {/* 灵敏度: 控制后端 radius, 严=近圈才收, 宽=放大圈 */}
        <div className="mood-sens-row">
          <span className="mood-sens-lbl">灵敏度</span>
          {[
            { k: 'strict', label: '严' },
            { k: 'normal', label: '正常' },
            { k: 'loose',  label: '宽' },
          ].map(opt => (
            <button
              key={opt.k}
              className={'mood-sens-chip' + (sens === opt.k ? ' on' : '')}
              onClick={() => setSens(opt.k)}
            >{opt.label}</button>
          ))}
        </div>

        <button className="mood-submit" onClick={submit} disabled={busy}>
          {busy ? '正在唤起 …' : '让 AI 用这个心情串记忆'}
        </button>

        {error && <div className="mood-err">{error}</div>}

        {result && (
          <div className="mood-result">
            <div className="mood-result-narr">{result.narrative}</div>
            {result.relaxed && (
              <div className="mood-result-relaxed">
                ⚠ 当前灵敏度下没有匹配项, 已放宽到最近 {result.sources.length} 条
              </div>
            )}
            <div className="mood-result-srcs-hd">
              引自 {result.sources.length} 条记忆 · 距离越小越像
            </div>
            <div className="mood-result-srcs">
              {result.sources.map((s) => {
                const isOpen = preview && preview.id === s.id;
                return (
                  <div
                    key={s.id}
                    className={'mood-result-src' + (isOpen ? ' on' : '')}
                    onClick={() => openSource(s)}
                  >
                    <div className="mood-result-src-ttl">{s.name}</div>
                    <div className="mood-result-src-sum">{s.summary}</div>
                    <div className="mood-result-src-coord">
                      v {s.valence.toFixed(2)} · a {s.arousal.toFixed(2)}
                      {typeof s.distance === 'number' && (
                        <span className="mood-result-src-dist"> · dist {s.distance.toFixed(2)}</span>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </div>

      {/* 源记忆全文预览浮层(浮在 mood-sheet 之上) */}
      {preview && (
        <div className="mood-preview-bd" onClick={() => setPreview(null)}>
          <div className="mood-preview-card" onClick={(e) => e.stopPropagation()}>
            <div className="mood-preview-hd">
              <div className="mood-preview-ttl">{preview.name}</div>
              <button
                className="mood-preview-x"
                onClick={() => setPreview(null)}
                aria-label="关闭"
              >×</button>
            </div>
            <div className="mood-preview-body">
              {preview.loading && <div className="mood-preview-loading">载入中…</div>}
              {preview.error && <div className="mood-err" style={{ marginTop: 0 }}>{preview.error}</div>}
              {!preview.loading && !preview.error && (
                <>
                  {(preview.content || '').split(/\n\s*\n/).filter(Boolean).map((p, i) => (
                    <p key={i}>{p}</p>
                  ))}
                  {!preview.content && <p style={{ color: 'var(--ink-4)' }}>(无内容)</p>}
                </>
              )}
            </div>
            <button
              className="mood-preview-jump"
              onClick={() => { onClose(); navigate('/mem/' + encodeURIComponent(preview.id)); }}
              title="去单条全貌界面(支持编辑等)"
            >去全貌界面 ›</button>
          </div>
        </div>
      )}
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
              {Array.from({ length: 10 }).map((_, k) => (
                <i key={k} style={{
                  height: ((k + 1) * 1.2 + 3) + 'px',
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
  const [editing, setEditing] = useState(false);
  const [refreshKey, setRefreshKey] = useState(0);

  useEffect(() => {
    let cancel = false;
    setData(null);
    setError(null);
    api('/api/bucket/' + encodeURIComponent(id))
      .then(d => { if (!cancel) setData(d); })
      .catch(e => { if (!cancel) setError(e.message); });
    return () => { cancel = true; };
  }, [id, refreshKey]);

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
            {Array.from({ length: 10 }).map((_, i) => (
              <i key={i} style={{
                height: ((i + 1) * 0.85 + 3) + 'px',
                background: i < importance ? 'var(--accent)' : 'var(--bg-2)',
              }}/>
            ))}
          </span>
          <b style={{
            fontFamily: 'var(--serif)', fontStyle: 'italic',
            color: 'var(--accent)', fontWeight: 600, fontSize: '15px'
          }}>{importance} / 10</b>
        </div>

        <div className="mem-full-text">
          {m.summary && <p className="lead">{m.summary}</p>}
          {paragraphs.map((p, i) => <p key={i}>{p}</p>)}
          {!m.summary && paragraphs.length === 0 && (
            <p style={{ color: 'var(--ink-4)', fontFamily: 'var(--mono)', fontSize: 11, letterSpacing: '0.1em' }}>
              (暂无内容)
            </p>
          )}
        </div>

        {/* 关联记忆等以后接通时再加 mem-full-section-hd */}
      </div>

      <div className="mem-full-action">
        <button className="mem-full-fab" onClick={() => setEditing(true)} title="编辑" style={{ cursor: 'pointer' }}>✎</button>
      </div>

      {editing && (
        <EditSheet
          bucketId={data.id}
          onClose={() => setEditing(false)}
          onSaved={() => setRefreshKey(k => k + 1)}
        />
      )}

      <TabBar active="home"/>
    </div>
  );
}

// ─────────────────────────────────────────
// EditSheet · 共用编辑底弹(MemFull / Review 都用)
//   bucketId: 要编辑的桶 ID;打开时自动 fetch 完整 metadata + content
//   onClose:  取消 / 关闭
//   onSaved:  成功保存后回调,参数是新 metadata,父组件用来 refresh 自己
// ─────────────────────────────────────────

// 显示用:把 "YYYY-MM-DDTHH:MM" 拆成"YYYY · MM · DD  HH:MM"
function formatLocalDateTimeForDisplay(local) {
  if (!local) return '';
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/.exec(local);
  if (!m) return local;
  return `${m[1]} · ${m[2]} · ${m[3]}    ${m[4]}:${m[5]}`;
}

function DateTimePicker({ value, onChange, onClose }) {
  // value 是本地 datetime 字符串 "YYYY-MM-DDTHH:MM",可空
  const initialDt = value ? new Date(value) : new Date();
  const safeDt = isNaN(initialDt.getTime()) ? new Date() : initialDt;

  const [year, setYear] = useState(safeDt.getFullYear());
  const [month, setMonth] = useState(safeDt.getMonth() + 1);
  const [day, setDay] = useState(safeDt.getDate());
  const [hour, setHour] = useState(safeDt.getHours());
  const [minute, setMinute] = useState(safeDt.getMinutes());

  const today = new Date();
  const todayY = today.getFullYear();
  const todayM = today.getMonth() + 1;
  const todayD = today.getDate();

  const firstDow = new Date(year, month - 1, 1).getDay();
  const lastDay = new Date(year, month, 0).getDate();
  const cells = [];
  for (let i = 0; i < firstDow; i++) cells.push(null);
  for (let d = 1; d <= lastDay; d++) cells.push(d);

  const prevMonth = () => {
    let y = year, m = month - 1;
    if (m < 1) { m = 12; y -= 1; }
    setYear(y); setMonth(m);
    if (day > new Date(y, m, 0).getDate()) setDay(new Date(y, m, 0).getDate());
  };
  const nextMonth = () => {
    let y = year, m = month + 1;
    if (m > 12) { m = 1; y += 1; }
    setYear(y); setMonth(m);
    if (day > new Date(y, m, 0).getDate()) setDay(new Date(y, m, 0).getDate());
  };

  const setNow = () => {
    const n = new Date();
    setYear(n.getFullYear());
    setMonth(n.getMonth() + 1);
    setDay(n.getDate());
    setHour(n.getHours());
    setMinute(n.getMinutes());
  };

  const apply = () => {
    const yy = String(year).padStart(4, '0');
    const mm = String(month).padStart(2, '0');
    const dd = String(day).padStart(2, '0');
    const hh = String(hour).padStart(2, '0');
    const mn = String(minute).padStart(2, '0');
    onChange(`${yy}-${mm}-${dd}T${hh}:${mn}`);
    onClose();
  };

  return (
    <div className="dt-picker-overlay" onClick={onClose}>
      <div className="dt-picker" onClick={e => e.stopPropagation()}>
        <div className="dt-picker-grip"/>

        <div className="dt-picker-month-row">
          <button className="dt-picker-nav" onClick={prevMonth} title="上个月">‹</button>
          <span className="dt-picker-month-label">
            {MO_EN[month - 1]}
            <span className="y">{year}</span>
          </span>
          <button className="dt-picker-nav" onClick={nextMonth} title="下个月">›</button>
        </div>

        <div className="dt-picker-weekrow">
          <span>S</span><span>M</span><span>T</span><span>W</span><span>T</span><span>F</span><span>S</span>
        </div>
        <div className="dt-picker-grid">
          {cells.map((c, i) => {
            const isToday = c === todayD && month === todayM && year === todayY;
            const isOn = c === day;
            const cls = 'dt-picker-cell'
              + (c === null ? ' ph' : '')
              + (isToday && !isOn ? ' today' : '')
              + (isOn ? ' on' : '');
            return (
              <button
                key={i}
                className={cls}
                onClick={() => c && setDay(c)}
                disabled={c === null}
              >{c || ''}</button>
            );
          })}
        </div>

        <div className="dt-picker-time-row">
          <span className="lbl">时间</span>
          <input
            type="number"
            inputMode="numeric"
            className="dt-picker-time-input"
            value={String(hour).padStart(2, '0')}
            onChange={e => {
              const v = parseInt(e.target.value, 10);
              if (isNaN(v)) setHour(0);
              else setHour(Math.max(0, Math.min(23, v)));
            }}
            min="0" max="23"
          />
          <span className="dt-picker-time-sep">:</span>
          <input
            type="number"
            inputMode="numeric"
            className="dt-picker-time-input"
            value={String(minute).padStart(2, '0')}
            onChange={e => {
              const v = parseInt(e.target.value, 10);
              if (isNaN(v)) setMinute(0);
              else setMinute(Math.max(0, Math.min(59, v)));
            }}
            min="0" max="59"
          />
        </div>

        <div className="dt-picker-actions">
          <button className="dt-picker-cancel" onClick={onClose}>取消</button>
          <button className="dt-picker-now" onClick={setNow}>此刻</button>
          <button className="dt-picker-done" onClick={apply}>完成</button>
        </div>
      </div>
    </div>
  );
}

function EventTimeField({ value, onChange }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        type="button"
        className="dt-trigger"
        onClick={() => setOpen(true)}
      >
        <span className="dt-trigger-ic">⌘</span>
        {value ? (
          <span className="dt-trigger-value">{formatLocalDateTimeForDisplay(value)}</span>
        ) : (
          <span className="dt-trigger-value empty">点击选择时间 · 留空则用创建时间</span>
        )}
        {value && (
          <span
            className="dt-trigger-clear"
            onClick={(e) => { e.stopPropagation(); onChange(''); }}
            title="清空"
          >×</span>
        )}
      </button>
      {open && (
        <DateTimePicker
          value={value}
          onChange={onChange}
          onClose={() => setOpen(false)}
        />
      )}
    </>
  );
}

function FormFields({
  name, setName, summary, setSummary, content, setContent,
  imp, setImp, pin, setPin, tags, setTags, tagInput, setTagInput,
  eventTime, setEventTime,
  showSummary = true, showPin = true, contentRequired = false,
  onRedehydrate, redehydrating,    // 可选:编辑既有桶时传入,新建时不传
}) {
  const feel = tags.some(t => /^feel/i.test(String(t)));
  const toggleFeel = () => {
    if (feel) setTags(tags.filter(t => !/^feel/i.test(String(t))));
    else setTags(tags.concat(['feel']));
  };
  const addTag = () => {
    const t = tagInput.trim();
    if (!t) return;
    if (tags.indexOf(t) >= 0) { setTagInput(''); return; }
    setTags(tags.concat([t]));
    setTagInput('');
  };
  const removeTag = (t) => setTags(tags.filter(x => x !== t));

  return (
    <>
      <div className="edit-field">
        <div className="edit-field-lbl">标题{!contentRequired && ' · 可选'}</div>
        <input
          className="edit-input"
          value={name}
          onChange={e => setName(e.target.value)}
          placeholder={contentRequired ? '(留空 AI 起一个)' : '(留空则用 ID)'}
        />
      </div>

      {showSummary && (
        <div className="edit-field">
          <div className="edit-field-lbl">摘要 · 可选</div>
          <input
            className="edit-input"
            value={summary}
            onChange={e => setSummary(e.target.value)}
            placeholder="(留空就行 · 没摘要时直接展示正文)"
          />
        </div>
      )}

      <div className="edit-field">
        <div className="edit-field-lbl">正文{contentRequired ? ' · 必填' : ''}</div>
        <textarea
          className="edit-textarea"
          value={content}
          onChange={e => setContent(e.target.value)}
          rows={contentRequired ? 8 : 6}
          placeholder={contentRequired ? '想记什么 …' : ''}
        />
      </div>

      {setEventTime && (
        <div className="edit-field">
          <div className="edit-field-lbl">事件时间 · 可选</div>
          <EventTimeField value={eventTime} onChange={setEventTime}/>
        </div>
      )}

      <div className="edit-field">
        <div className="edit-field-lbl">重要度 · importance</div>
        <div className="edit-imp">
          <div className="edit-imp-track">
            {Array.from({ length: 10 }).map((_, i) => (
              <i key={i} className={i < imp ? 'on' : ''} onClick={() => setImp(i + 1)}/>
            ))}
          </div>
          <span className="edit-imp-num">{imp}</span>
        </div>
      </div>

      <div className="edit-field">
        <div className="edit-field-lbl">动态属性</div>
        <div className="edit-toggle-row">
          <button className={'edit-toggle feel ' + (feel ? 'on' : '')} onClick={toggleFeel}>
            <span className="ic">♡</span><span>feel</span>
          </button>
          {showPin && (
            <button className={'edit-toggle pin ' + (pin ? 'on' : '')} onClick={() => setPin(!pin)}>
              <span className="ic">⚲</span><span>钉决</span>
            </button>
          )}
          {onRedehydrate && (
            <button
              className="edit-toggle action redehydrate"
              onClick={onRedehydrate}
              disabled={redehydrating}
              title="LLM 重新生成标题/摘要/tags(原内容不变)"
            >
              <span className="ic">↻</span><span>{redehydrating ? '处理中…' : '重新脱水'}</span>
            </button>
          )}
        </div>
      </div>

      <div className="edit-field">
        <div className="edit-field-lbl">标签</div>
        <div className="edit-tags-input">
          {tags.filter(t => !String(t).startsWith('__')).map((t, i) => (
            <span key={i} className="edit-tag-chip">
              {t}<span className="x" onClick={() => removeTag(t)}>×</span>
            </span>
          ))}
          <input
            className="edit-tag-input"
            value={tagInput}
            onChange={e => setTagInput(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); addTag(); } }}
            onBlur={() => addTag()}
            placeholder="+ 加标签(回车 / 失焦自动加)"
          />
        </div>
      </div>
    </>
  );
}

function EditSheet({ bucketId, onClose, onSaved, onDeleted }) {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [name, setName] = useState('');
  const [summary, setSummary] = useState('');
  const [content, setContent] = useState('');
  const [imp, setImp] = useState(5);
  const [pin, setPin] = useState(false);
  const [tags, setTags] = useState([]);
  const [tagInput, setTagInput] = useState('');
  const [eventTime, setEventTime] = useState('');
  const [saving, setSaving] = useState(false);
  const [redehydrating, setRedehydrating] = useState(false);

  useEffect(() => {
    let cancel = false;
    api('/api/bucket/' + encodeURIComponent(bucketId))
      .then(d => {
        if (cancel) return;
        const m = d.metadata || {};
        setName(m.name || '');
        setSummary(m.summary || '');
        setContent(d.content || '');
        setImp(m.importance || 5);
        setPin(!!m.protected);
        setTags(m.tags || []);
        setEventTime(toLocalDateTimeStr(m.event_time || m.created || ''));
        setLoading(false);
      })
      .catch(e => { if (!cancel) { setError(e.message); setLoading(false); } });
    return () => { cancel = true; };
  }, [bucketId]);

  const save = async () => {
    setSaving(true);
    setError(null);
    try {
      const r = await fetch('/api/bucket/' + encodeURIComponent(bucketId) + '/update', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: name.trim() || bucketId,
          summary: summary,
          content: content,
          importance: imp,
          tags: tags,
          protected: pin,
          event_time: fromLocalDateTimeStr(eventTime),
        }),
      });
      if (!r.ok) {
        const err = await r.json().catch(() => ({}));
        throw new Error(err.error || `HTTP ${r.status}`);
      }
      const data = await r.json();
      if (onSaved) onSaved(data.metadata || {});
      onClose();
    } catch (e) {
      setError(e.message || String(e));
      setSaving(false);
    }
  };

  const redehydrate = async () => {
    if (redehydrating || saving) return;
    if (!window.confirm('对当前记忆重新脱水?\nLLM 会重写标题/摘要/tags 等字段; 本次表单未保存的修改将被这次产出覆盖。')) return;
    setRedehydrating(true);
    setError(null);
    try {
      const r = await fetch('/api/bucket/' + encodeURIComponent(bucketId) + '/redehydrate', { method: 'POST' });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(d.error || ('HTTP ' + r.status));
      const m = d.metadata || {};
      // 用新元数据回填表单, content 不变
      setName(m.name || '');
      setSummary(m.summary || '');
      setImp(m.importance || imp);
      setPin(!!m.protected);
      setTags(m.tags || []);
      // 同步给父级状态(审阅区已立刻反映新标题/摘要/tags)
      if (onSaved) onSaved(m);
    } catch (e) {
      setError(e.message || String(e));
    } finally {
      setRedehydrating(false);
    }
  };

  const del = async () => {
    if (!window.confirm('删除「' + (name || bucketId) + '」?\n移到回收站,可在设置 → 回收站恢复。')) return;
    setSaving(true);
    setError(null);
    try {
      const r = await fetch('/api/bucket/' + encodeURIComponent(bucketId) + '/delete', { method: 'POST' });
      if (!r.ok) {
        const err = await r.json().catch(() => ({}));
        throw new Error(err.error || `HTTP ${r.status}`);
      }
      onClose();
      if (onDeleted) onDeleted(bucketId);
      else window.history.back();
    } catch (e) {
      setError(e.message || String(e));
      setSaving(false);
    }
  };

  return (
    <div className="edit-sheet" onClick={onClose}>
      <div className="edit-sheet-panel" onClick={e => e.stopPropagation()}>
        <div className="edit-sheet-grip"/>
        <div className="edit-sheet-hd">
          <button className="cancel" onClick={onClose} disabled={saving}>取消</button>
          <span className="ttl">{loading ? '载入中…' : '编辑记忆'}</span>
          <button className="save" onClick={save} disabled={loading || saving}>
            {saving ? '保存中' : '保存'}
          </button>
        </div>

        {error && <div className="edit-error">⚠ {error}</div>}

        {loading ? (
          <div className="app-loading" style={{ height: 200 }}>载入中…</div>
        ) : (
          <>
            <FormFields
              name={name} setName={setName}
              summary={summary} setSummary={setSummary}
              content={content} setContent={setContent}
              imp={imp} setImp={setImp}
              pin={pin} setPin={setPin}
              tags={tags} setTags={setTags}
              tagInput={tagInput} setTagInput={setTagInput}
              eventTime={eventTime} setEventTime={setEventTime}
              onRedehydrate={redehydrate}
              redehydrating={redehydrating}
            />
            <button className="edit-delete-btn" onClick={del} disabled={loading || saving}>
              ✕ 删除这条记忆
            </button>
          </>
        )}
      </div>
    </div>
  );
}

// ─────────────────────────────────────────
// NewScreen · 写新条目(全屏表单)
// ─────────────────────────────────────────

function NewScreen() {
  const [name, setName] = useState('');
  const [summary, setSummary] = useState('');
  const [content, setContent] = useState('');
  const [imp, setImp] = useState(5);
  const [pin, setPin] = useState(false);
  const [tags, setTags] = useState([]);
  const [tagInput, setTagInput] = useState('');
  const [eventTime, setEventTime] = useState(() => toLocalDateTimeStr(new Date().toISOString()));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);

  const save = async () => {
    if (!content.trim()) {
      setError('正文不能空');
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const r = await fetch('/api/bucket/create', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: name.trim() || null,
          content: content,
          importance: imp,
          tags: tags,
          protected: pin,
          event_time: fromLocalDateTimeStr(eventTime) || undefined,
        }),
      });
      if (!r.ok) {
        const err = await r.json().catch(() => ({}));
        throw new Error(err.error || `HTTP ${r.status}`);
      }
      const data = await r.json();
      // summary 不能直接通过 create 设(create() 不接 summary 字段),
      // 如果用户写了 summary,补一次 update
      if (summary.trim()) {
        try {
          await fetch('/api/bucket/' + encodeURIComponent(data.id) + '/update', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ summary: summary.trim() }),
          });
        } catch (_) { /* 忽略,用户可以以后再编辑 */ }
      }
      // 用 replace 而不是 navigate,这样后退键直接回上层(如首页),不会回到 /new
      window.location.replace('#/mem/' + encodeURIComponent(data.id));
    } catch (e) {
      setError(e.message || String(e));
      setSaving(false);
    }
  };

  return (
    <div className="new-screen">
      <div className="new-top">
        <button className="cancel" onClick={() => window.history.back()} disabled={saving}>取消</button>
        <span className="ttl">写新记忆</span>
        <button className="save" onClick={save} disabled={saving || !content.trim()}>
          {saving ? '保存中' : '保存'}
        </button>
      </div>

      <div className="new-body">
        {error && <div className="edit-error">⚠ {error}</div>}
        <FormFields
          name={name} setName={setName}
          summary={summary} setSummary={setSummary}
          content={content} setContent={setContent}
          imp={imp} setImp={setImp}
          pin={pin} setPin={setPin}
          tags={tags} setTags={setTags}
          tagInput={tagInput} setTagInput={setTagInput}
          eventTime={eventTime} setEventTime={setEventTime}
          contentRequired={true}
        />
      </div>
    </div>
  );
}

// ─────────────────────────────────────────
// 屏 4 · 日历(v1 双模式 — 用户 2026-04-29 明确按 v1 来)
// ─────────────────────────────────────────

const MO_EN_FULL = ['January','February','March','April','May','June','July','August','September','October','November','December'];

function levelOf(n) {
  if (!n) return '';
  if (n <= 4) return 'l1';
  if (n <= 8) return 'l2';
  if (n <= 13) return 'l3';
  return 'l4';
}

function isImportTodo(b) {
  // AI 写入 + 没有 __import_refined / __import_flagged tag = 待审
  if (b.created_by !== 'ai') return false;
  const tags = b.tags || [];
  if (tags.indexOf('__import_refined') >= 0) return false;
  if (tags.indexOf('__import_flagged') >= 0) return false;
  return true;
}

function buildMonth(year, month, dayMap, todayKey) {
  const firstDow = new Date(year, month - 1, 1).getDay();
  const lastDay = new Date(year, month, 0).getDate();
  const cells = [];
  for (let i = 0; i < firstDow; i++) cells.push({ ph: true });
  let total = 0, hiCnt = 0, todoCnt = 0, peakDay = 0;
  for (let d = 1; d <= lastDay; d++) {
    const k = `${year}-${month}-${d}`;
    const items = dayMap.get(k) || [];
    let hasHi = false, hasTodo = false;
    for (const b of items) {
      if (b.highlight) hasHi = true;
      if (isImportTodo(b)) hasTodo = true;
    }
    if (items.length > peakDay) peakDay = items.length;
    total += items.length;
    if (hasHi) hiCnt += 1;
    if (hasTodo) todoCnt += 1;
    cells.push({ d, n: items.length, hi: hasHi, todo: hasTodo, today: k === todayKey });
  }
  return { year, month, cells, total, hiCnt, todoCnt, peakDay };
}

function CalCell({ c, mode, onClick }) {
  if (c.ph) return <div className="cal-cell placeholder"/>;
  let cls = 'cal-cell';
  if (c.n > 0) cls += ' has-data';
  if (mode === 'show') {
    cls += ' ' + levelOf(c.n);
    if (c.today) cls += ' today';
  } else {
    if (c.hi) cls += ' hi';
    else if (c.todo) cls += ' unread';
    else if (c.n > 0) {
      cls += ' read';
      if (c.n > 8) cls += ' dense';
      if (c.n > 13) cls += ' dense2';
    }
    if (c.today) cls += ' today';
  }
  return (
    <div className={cls} onClick={c.n > 0 && onClick ? () => onClick(c) : undefined}>
      <span className="d">{c.d}</span>
      {c.n > 0 && <span className="n">{c.n}</span>}
    </div>
  );
}

function CalMonth({ year, month, cells, total, hiCnt, todoCnt, peakDay, mode, onCellClick }) {
  return (
    <div className="cal-month">
      <div className="cal-month-hd">
        <span className="cal-month-name">{MO_EN_FULL[month - 1]}</span>
        <span className="cal-month-year">{year}</span>
        <span className="cal-month-stats">
          {mode === 'show'
            ? `${total} 条 · 峰 ${peakDay}`
            : `${total} 条 · ${hiCnt} hi · ${todoCnt} 待`}
        </span>
      </div>
      <div className="cal-weekrow">
        <span>S</span><span>M</span><span>T</span><span>W</span><span>T</span><span>F</span><span>S</span>
      </div>
      <div className="cal-grid">
        {cells.map((c, i) => (
          <CalCell
            key={i}
            c={c}
            mode={mode}
            onClick={c.n > 0 ? () => onCellClick(year, month, c.d) : undefined}
          />
        ))}
      </div>
    </div>
  );
}

function CalScreen() {
  const [buckets, setBuckets] = useState(null);
  const [error, setError] = useState(null);
  const [mode, setMode] = useState('show');

  useEffect(() => {
    let cancel = false;
    api('/api/buckets')
      .then(d => { if (!cancel) setBuckets(Array.isArray(d) ? d : []); })
      .catch(e => { if (!cancel) setError(e.message); });
    return () => { cancel = true; };
  }, []);

  const data = useMemo(() => {
    if (!buckets) return null;
    const now = new Date();
    const todayKey = `${now.getFullYear()}-${now.getMonth()+1}-${now.getDate()}`;

    const dayMap = new Map();
    for (const b of buckets) {
      const dt = bucketDate(b);
      if (!dt) continue;
      const k = `${dt.getFullYear()}-${dt.getMonth()+1}-${dt.getDate()}`;
      if (!dayMap.has(k)) dayMap.set(k, []);
      dayMap.get(k).push(b);
    }

    // 当月 + 前一个月 + 再前一个月 共 3 个月,够手机滚动看
    const months = [];
    for (let i = 0; i < 3; i++) {
      let y = now.getFullYear();
      let m = now.getMonth() + 1 - i;
      while (m < 1) { m += 12; y -= 1; }
      months.push(buildMonth(y, m, dayMap, todayKey));
    }

    let totalCnt = 0, peakAll = 0, pendingDays = 0, hiTotal = 0;
    for (const [, items] of dayMap) {
      const cnt = items.length;
      totalCnt += cnt;
      if (cnt > peakAll) peakAll = cnt;
      let dayHasTodo = false, dayHasHi = false;
      for (const b of items) {
        if (b.highlight) dayHasHi = true;
        if (isImportTodo(b)) dayHasTodo = true;
      }
      if (dayHasTodo) pendingDays += 1;
      if (dayHasHi) hiTotal += 1;
    }
    const dayAvg = dayMap.size > 0 ? (totalCnt / dayMap.size).toFixed(1) : '0';

    return {
      months,
      stats: {
        days: dayMap.size,
        total: totalCnt,
        peak: peakAll,
        avg: dayAvg,
        pendingDays,
        hi: hiTotal,
      },
    };
  }, [buckets]);

  if (error) return (
    <div className="cal">
      <div className="app-error">后端错: {error}</div>
      <TabBar active="cal"/>
    </div>
  );
  if (!buckets || !data) return (
    <div className="cal">
      <div className="app-loading">载入中…</div>
      <TabBar active="cal"/>
    </div>
  );

  const yearLabel = String(new Date().getFullYear());

  return (
    <div className={'cal mode-' + mode}>
      <div className="cal-head">
        <div className="app-eyebrow">
          <span className="app-eyebrow-dot"/>
          <span>{mode === 'show' ? '日历 · index' : '日历 · review map'}</span>
        </div>
        <div className="cal-title-row">
          <h1 className="cal-title">
            {yearLabel} · {mode === 'show' ? '记忆密度' : '审阅地图'}
          </h1>
          <div className="cal-mode">
            <button
              className={'cal-mode-btn' + (mode === 'show' ? ' on' : '')}
              onClick={() => setMode('show')}
            >展示</button>
            <button
              className={'cal-mode-btn' + (mode === 'review' ? ' on' : '')}
              onClick={() => setMode('review')}
            >审阅</button>
          </div>
        </div>
        <div className="cal-stats">
          <span><b>{data.stats.days}</b> 天</span>
          <span><b>{data.stats.total}</b> 条</span>
          {mode === 'review' ? (
            <span><b>{data.stats.pendingDays}</b> 待审天 · <b>{data.stats.hi}</b> highlight</span>
          ) : (
            <span><b>{data.stats.peak}</b> 单日峰值 · <b>{data.stats.avg}</b> 日均</span>
          )}
        </div>
      </div>

      <div className="cal-legend">
        {mode === 'show' ? (
          <>
            <div className="cal-legend-item"><span className="cal-swatch empty"/>无</div>
            <div className="cal-legend-item"><span className="cal-swatch d1"/>1-4</div>
            <div className="cal-legend-item"><span className="cal-swatch d2"/>5-8</div>
            <div className="cal-legend-item"><span className="cal-swatch d3"/>9-13</div>
            <div className="cal-legend-item"><span className="cal-swatch d4"/>14+</div>
          </>
        ) : (
          <>
            <div className="cal-legend-item"><span className="cal-swatch read"/>已审</div>
            <div className="cal-legend-item"><span className="cal-swatch unread"/>有遗漏</div>
            <div className="cal-legend-item"><span className="cal-swatch hi"/>highlight</div>
            <div className="cal-legend-item"><span className="cal-swatch empty"/>无记忆</div>
          </>
        )}
      </div>

      {mode === 'review' && data.stats.pendingDays > 0 && (
        <div className="cal-pending" onClick={() => navigate('/review')}>
          <div className="cal-pending-num">{data.stats.pendingDays}</div>
          <div className="cal-pending-body">
            <div className="cal-pending-title">{data.stats.pendingDays} 天有遗漏</div>
            <div className="cal-pending-sub">点开"审阅"tab 处理</div>
          </div>
          <div className="cal-pending-arrow">→</div>
        </div>
      )}

      {data.months.map(mo => (
        <CalMonth
          key={mo.year + '-' + mo.month}
          year={mo.year}
          month={mo.month}
          cells={mo.cells}
          total={mo.total}
          hiCnt={mo.hiCnt}
          todoCnt={mo.todoCnt}
          peakDay={mo.peakDay}
          mode={mode}
          onCellClick={(y, m, d) => {
            const k = `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
            navigate('/day/' + k);
          }}
        />
      ))}

      <TabBar active="cal"/>
    </div>
  );
}

// ─────────────────────────────────────────
// 屏 5 · 审阅台(只读 Phase 1 - 状态切换 / 编辑下次实装)
// ─────────────────────────────────────────

function statusOf(b) {
  const tags = b.tags || [];
  if (tags.indexOf('__import_refined') >= 0) return 'done';
  if (tags.indexOf('__import_flagged') >= 0) return 'doubt';
  return 'todo';
}

function ReviewScreen() {
  const [buckets, setBuckets] = useState(null);
  const [error, setError] = useState(null);
  const [tab, setTab] = useState('todo');
  const [scope, setScope] = useState('all'); // 默认全部,因为今天可能没记忆
  const [drawer, setDrawer] = useState(false);
  const [curId, setCurId] = useState(null);
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState(false);
  // 全文缓存(/api/buckets 只回 200 字预览,审阅长文要拉单条全文)
  const [fullById, setFullById] = useState({});

  useEffect(() => {
    let cancel = false;
    api('/api/buckets')
      .then(d => {
        if (cancel) return;
        const list = Array.isArray(d) ? d : [];
        // 只审阅 AI 写入的(用户自己写的不需要走审阅流);按时间倒序
        const aiOnly = list.filter(b => b.created_by === 'ai');
        aiOnly.sort((a, b) => {
          const ta = new Date(a.event_time || a.created || 0).getTime();
          const tb = new Date(b.event_time || b.created || 0).getTime();
          return tb - ta;
        });
        setBuckets(aiOnly);
        if (aiOnly.length > 0) {
          const firstTodo = aiOnly.find(b => statusOf(b) === 'todo') || aiOnly[0];
          setCurId(firstTodo.id);
        }
      })
      .catch(e => { if (!cancel) setError(e.message); });
    return () => { cancel = true; };
  }, []);

  const filteredAll = useMemo(() => {
    if (!buckets) return [];
    if (scope === 'today') {
      const now = new Date();
      const todayKey = `${now.getFullYear()}-${now.getMonth()+1}-${now.getDate()}`;
      return buckets.filter(b => {
        const dt = bucketDate(b);
        if (!dt) return false;
        return `${dt.getFullYear()}-${dt.getMonth()+1}-${dt.getDate()}` === todayKey;
      });
    }
    return buckets;
  }, [buckets, scope]);

  const queue = useMemo(() => {
    if (tab === 'all') return filteredAll;
    return filteredAll.filter(b => statusOf(b) === tab);
  }, [filteredAll, tab]);

  const counts = useMemo(() => ({
    all: filteredAll.length,
    todo: filteredAll.filter(b => statusOf(b) === 'todo').length,
    doubt: filteredAll.filter(b => statusOf(b) === 'doubt').length,
    done: filteredAll.filter(b => statusOf(b) === 'done').length,
  }), [filteredAll]);

  const cur = useMemo(() => {
    if (!buckets || !curId) return null;
    return buckets.find(b => b.id === curId) || null;
  }, [buckets, curId]);

  // 拉当前条目的全文(/api/buckets 只回 200 字预览),按 id 缓存避免重复请求
  useEffect(() => {
    if (!curId || fullById[curId] !== undefined) return;
    let cancel = false;
    api('/api/bucket/' + encodeURIComponent(curId))
      .then(d => { if (!cancel) setFullById(prev => ({ ...prev, [curId]: (d && d.content) || '' })); })
      .catch(() => { if (!cancel) setFullById(prev => ({ ...prev, [curId]: null })); });
    return () => { cancel = true; };
  }, [curId, fullById]);

  // 切 tab/scope 时,如果 cur 不在新 queue 里,自动切到新 queue 第一项
  // 故意只依赖 tab/scope,不让标记/删除等 buckets 变更打扰
  useEffect(() => {
    if (!buckets) return;
    if (queue.length === 0) {
      setCurId(null);
    } else if (!curId || !queue.find(b => b.id === curId)) {
      setCurId(queue[0].id);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab, scope]);

  const curIdx = queue.findIndex(b => b.id === curId);

  if (error) return (
    <div className="review">
      <div className="app-error">后端错: {error}</div>
      <TabBar active="review"/>
    </div>
  );
  if (!buckets) return (
    <div className="review">
      <div className="app-loading">载入中…</div>
      <TabBar active="review"/>
    </div>
  );

  const curDt = cur ? bucketDate(cur) : null;

  // 操作完成后,在「旧 queue」基础上挑下一个 cur
  // 规则:queue[(oldIdx + 1) % queue.length],wrap;若 queue 只有这一个就置空
  const pickNext = () => {
    if (queue.length <= 1) return null;
    const oldIdx = queue.findIndex(b => b.id === curId);
    if (oldIdx < 0) return queue[0];
    return queue[(oldIdx + 1) % queue.length];
  };

  const markStatus = async (action) => {
    if (!cur || busy) return;
    setBusy(true);
    // 已是目标状态再点 = 取消(回到待办)
    const currentStatus = statusOf(cur);
    const targetStatus = action === 'refined' ? 'done' : 'doubt';
    const isUntoggle = currentStatus === targetStatus;

    const newTags = (cur.tags || []).filter(t => t !== '__import_refined' && t !== '__import_flagged');
    if (!isUntoggle) {
      if (action === 'refined') newTags.push('__import_refined');
      if (action === 'flagged') newTags.push('__import_flagged');
    }
    const next = pickNext();
    try {
      const r = await fetch('/api/bucket/' + encodeURIComponent(cur.id) + '/update', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tags: newTags }),
      });
      if (!r.ok) {
        const err = await r.json().catch(() => ({}));
        throw new Error(err.error || `HTTP ${r.status}`);
      }
      setBuckets(prev => prev.map(b => b.id === cur.id ? { ...b, tags: newTags } : b));
      // 标记时切下一个,取消时留在原条目让用户看到状态变化
      if (!isUntoggle && next) setCurId(next.id);
    } catch (e) {
      alert('失败: ' + e.message);
    } finally {
      setBusy(false);
    }
  };

  const deleteCur = async () => {
    if (!cur || busy) return;
    if (!window.confirm('删除「' + (cur.name || cur.id) + '」?\n移到回收站,可在设置 → 回收站恢复。')) return;
    setBusy(true);
    const oldId = cur.id;
    const next = pickNext();
    try {
      const r = await fetch('/api/bucket/' + encodeURIComponent(oldId) + '/delete', { method: 'POST' });
      if (!r.ok) throw new Error('HTTP ' + r.status);
      setBuckets(prev => prev.filter(b => b.id !== oldId));
      setCurId(next ? next.id : null);
    } catch (e) {
      alert('失败: ' + e.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="review">
      <div className="review-top">
        <div className="review-eyebrow-row">
          <span className="app-eyebrow">
            <span className="app-eyebrow-dot"/>
            <span>审阅 · review</span>
          </span>
          <div className="review-scope">
            <button className={'review-scope-btn' + (scope === 'today' ? ' on' : '')} onClick={() => setScope('today')}>今天</button>
            <button className={'review-scope-btn' + (scope === 'all' ? ' on' : '')} onClick={() => setScope('all')}>全部</button>
          </div>
        </div>
        <div className="review-tabs">
          <button className={'review-tab todo' + (tab === 'todo' ? ' on' : '')} onClick={() => setTab('todo')}>
            <span className="pip"/><span>待办</span><span className="n">{counts.todo}</span>
          </button>
          <button className={'review-tab doubt' + (tab === 'doubt' ? ' on' : '')} onClick={() => setTab('doubt')}>
            <span className="pip"/><span>存疑</span><span className="n">{counts.doubt}</span>
          </button>
          <button className={'review-tab done' + (tab === 'done' ? ' on' : '')} onClick={() => setTab('done')}>
            <span className="pip"/><span>已精修</span><span className="n">{counts.done}</span>
          </button>
          <button className={'review-tab' + (tab === 'all' ? ' on' : '')} onClick={() => setTab('all')}>
            <span>全部</span><span className="n">{counts.all}</span>
          </button>
        </div>
      </div>

      <div className="review-body">
        {cur ? (
          <div className="rv-main">
            <div className="rv-main-meta">
              {curDt && <span className="rv-main-meta-time">{fmtDay(curDt).num} {fmtDay(curDt).mo} · {fmtTime(curDt)}</span>}
              <span>·</span>
              <span>{statusOf(cur) === 'done' ? '已精修' : statusOf(cur) === 'doubt' ? '存疑' : '待办'}</span>
              <span className="rv-main-meta-pos"><b>{curIdx >= 0 ? curIdx + 1 : '—'}</b>/{queue.length}</span>
            </div>
            <div className="rv-main-tags">
              {cur.highlight && <span className="rv-main-tag hi">★ highlight</span>}
              {(cur.tags || []).filter(t => !String(t).startsWith('__')).map((t, i) => (
                <span key={i} className={'rv-main-tag' + (/feel/i.test(String(t)) ? ' feel' : '')}>{t}</span>
              ))}
            </div>
            <h2 className="rv-main-title">{cur.name || cur.id}</h2>
            <div className="rv-main-imp-row">
              <span>重要度</span>
              <span className="rv-main-imp-bar">
                {Array.from({ length: 10 }).map((_, i) => (
                  <i key={i} style={{
                    height: ((i + 1) * 0.65 + 3.5) + 'px',
                    background: i < (cur.importance || 5) ? 'var(--accent)' : 'var(--bg-2)',
                  }}/>
                ))}
              </span>
              <b style={{ fontFamily: 'var(--serif)', fontStyle: 'italic', color: 'var(--accent)', fontWeight: 600, fontSize: '13px' }}>
                {cur.importance || 5} / 10
              </b>
            </div>
            <div className="rv-main-text-wrap">
              <div className="rv-main-text">
                {cur.summary && <p className="lead">{cur.summary}</p>}
                {(() => {
                  // 优先全文(单条 fetch),没拉到时回退到 200 字 preview
                  const body = fullById[cur.id] != null ? fullById[cur.id] : (cur.content_preview || '');
                  const paras = body.split(/\n\s*\n/).filter(Boolean);
                  return paras.map((p, i) => <p key={i}>{p}</p>);
                })()}
                {!cur.summary && !cur.content_preview && fullById[cur.id] == null && (
                  <p style={{ color: 'var(--ink-4)' }}>(加载中…)</p>
                )}
                {!cur.summary && !cur.content_preview && fullById[cur.id] === '' && (
                  <p style={{ color: 'var(--ink-4)' }}>(无内容)</p>
                )}
              </div>
            </div>

            {/* 状态按钮条:嵌入主卡底部,跟下面 tabbar 视觉分层 */}
            <div className="rv-actions-bar">
              <button
                className={'rv-action-btn read' + (statusOf(cur) === 'done' ? ' on' : '')}
                onClick={() => markStatus('refined')}
                disabled={busy}
                title={statusOf(cur) === 'done' ? '再点一次取消已阅' : '标记已阅'}
              >
                <span className="ic">✓</span><span>已阅</span>
              </button>
              <button
                className={'rv-action-btn doubt' + (statusOf(cur) === 'doubt' ? ' on' : '')}
                onClick={() => markStatus('flagged')}
                disabled={busy}
                title={statusOf(cur) === 'doubt' ? '再点一次取消存疑' : '标记存疑'}
              >
                <span className="ic">?</span><span>存疑</span>
              </button>
              <button
                className="rv-action-btn del"
                onClick={deleteCur}
                disabled={busy}
              >
                <span className="ic">✕</span><span>删除</span>
              </button>
              <button
                className="rv-action-btn edit"
                onClick={() => setEditing(true)}
                disabled={busy}
              >
                <span className="ic">✎</span><span>编辑</span>
              </button>
            </div>
          </div>
        ) : (
          <div className="app-loading" style={{ height: 'calc(100% - 90px - env(safe-area-inset-bottom))' }}>
            {queue.length === 0 ? '当前 tab 队列空' : '没选中条目'}
          </div>
        )}

        <div className="rv-queue-handle" onClick={() => setDrawer(true)}>
          <div className="grip"><i/><i/><i/></div>
          <div className="pos">
            {curIdx >= 0 ? (curIdx + 1) : '—'}<span style={{ opacity: 0.5 }}>/</span>{queue.length}
          </div>
        </div>

        {drawer && <div className="rv-queue-backdrop" onClick={() => setDrawer(false)} aria-hidden="true"/>}
        <div className={'rv-queue-drawer' + (drawer ? '' : ' closed')}>
          <div className="rv-queue-drawer-hd">
            <div className="rv-queue-drawer-hd-row">
              <span className="ttl">队列 · {queue.length}</span>
              <button className="x" onClick={() => setDrawer(false)}>×</button>
            </div>
          </div>
          <div className="rv-queue-list">
            {queue.length === 0 && (
              <div style={{ color: 'var(--ink-4)', textAlign: 'center', padding: '40px 0', fontFamily: 'var(--mono)', fontSize: 11, letterSpacing: '0.1em' }}>
                队列空
              </div>
            )}
            {queue.map(b => {
              const st = statusOf(b);
              const dt = bucketDate(b);
              return (
                <div
                  key={b.id}
                  className={'rv-queue-item' + (b.id === curId ? ' cur' : '')}
                  onClick={() => { setCurId(b.id); setDrawer(false); }}
                >
                  <span className={'rv-queue-item-st ' + st}/>
                  <div className="rv-queue-item-mid">
                    <div className="rv-queue-item-meta">
                      {dt ? `${fmtDay(dt).num} ${fmtDay(dt).mo} · ${fmtTime(dt)}` : '—'}
                      {b.highlight && <span style={{ color: 'var(--accent)', marginLeft: 6 }}>★</span>}
                    </div>
                    <div className="rv-queue-item-title">{b.name || b.id}</div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {editing && cur && (
          <EditSheet
            bucketId={cur.id}
            onClose={() => setEditing(false)}
            onSaved={(newMeta) => {
              setBuckets(prev => prev.map(b =>
                b.id === cur.id ? { ...b, ...newMeta } : b
              ));
            }}
            onDeleted={(deletedId) => {
              const next = pickNext();
              setBuckets(prev => prev.filter(b => b.id !== deletedId));
              setCurId(next ? next.id : null);
            }}
          />
        )}
      </div>

      <TabBar active="review"/>
    </div>
  );
}

// ─────────────────────────────────────────
// 屏 6 · 设置(主页 + 子页 trash + import stub)
// ─────────────────────────────────────────

function SettingScreen() {
  const [trashCount, setTrashCount] = useState(null);
  const [dark, setDark] = useState(() =>
    document.documentElement.getAttribute('data-theme') === 'dark'
  );

  useEffect(() => {
    api('/api/trash')
      .then(d => setTrashCount((d && d.count) || 0))
      .catch(() => setTrashCount(0));
  }, []);

  const toggleDark = () => {
    const next = !dark;
    setDark(next);
    if (next) {
      document.documentElement.setAttribute('data-theme', 'dark');
      localStorage.setItem('mobile-theme', 'dark');
    } else {
      document.documentElement.removeAttribute('data-theme');
      localStorage.setItem('mobile-theme', 'light');
    }
  };

  return (
    <div className="setting">
      <div className="setting-top">
        <div className="app-eyebrow">
          <span className="app-eyebrow-dot"/>
          <span>设置 · setting</span>
        </div>
        <h1 className="setting-title">设置</h1>
      </div>
      <div className="setting-body">

        <div className="setting-section-hd">外观 / API</div>
        <div className="setting-list">
          <div className="setting-row" onClick={toggleDark}>
            <div className="setting-row-ic">{dark ? '☾' : '☉'}</div>
            <div className="setting-row-mid">
              <div className="setting-row-title">暗夜模式</div>
              <div className="setting-row-sub">{dark ? '已开启 · 米白纸张换深底' : '关闭 · 米白纸张'}</div>
            </div>
            <span className={'setting-row-toggle' + (dark ? ' on' : '')}>
              <span className="knob"/>
            </span>
          </div>
          <div className="setting-row" onClick={() => navigate('/setting/api')}>
            <div className="setting-row-ic">≡</div>
            <div className="setting-row-mid">
              <div className="setting-row-title">API 配置</div>
              <div className="setting-row-sub">切换 LLM profile / 模型</div>
            </div>
            <span className="setting-row-arrow">›</span>
          </div>
        </div>

        <div className="setting-section-hd">数据</div>
        <div className="setting-list">
          <div className="setting-row" onClick={() => navigate('/setting/import')}>
            <div className="setting-row-ic">↥</div>
            <div className="setting-row-mid">
              <div className="setting-row-title">导入</div>
              <div className="setting-row-sub">粘贴文本 / 上传文件</div>
            </div>
            <span className="setting-row-arrow">›</span>
          </div>
          <div className="setting-row" onClick={() => navigate('/setting/trash')}>
            <div className="setting-row-ic">⌫</div>
            <div className="setting-row-mid">
              <div className="setting-row-title">回收站</div>
              <div className="setting-row-sub">软删除恢复 / 永久删除</div>
            </div>
            {trashCount !== null && trashCount > 0 && (
              <span className="setting-row-badge">{trashCount}</span>
            )}
            <span className="setting-row-arrow">›</span>
          </div>
        </div>
      </div>
      <TabBar active="setting"/>
    </div>
  );
}

// ─────────────────────────────────────────
// API 配置子页(/setting/api)
// ─────────────────────────────────────────

function ApiSettingScreen() {
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [busyId, setBusyId] = useState(null);

  const load = () => {
    api('/api/config/api')
      .then(setData)
      .catch(e => setError(e.message));
  };

  useEffect(() => { load(); }, []);

  const switchTo = async (pid) => {
    setBusyId(pid);
    try {
      const r = await fetch('/api/config/api/active', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: pid }),
      });
      if (!r.ok) {
        const err = await r.json().catch(() => ({}));
        throw new Error(err.error || `HTTP ${r.status}`);
      }
      load();
    } catch (e) {
      alert('切换失败: ' + e.message);
    } finally {
      setBusyId(null);
    }
  };

  return (
    <div className="trash-body">
      <div className="sub-top">
        <div className="sub-back-row">
          <button className="app-back" onClick={() => navigate('/setting')}>‹ 设置</button>
          <span className="app-eyebrow" style={{ marginLeft: 'auto' }}>
            <span>API · profile</span>
          </span>
        </div>
        <h1 className="sub-title">API 配置</h1>
        <div className="sub-meta">
          {data && data.current_effective && (
            <>当前生效:<b>{data.current_effective.model || '—'}</b></>
          )}
        </div>
      </div>
      <div className="trash-list">
        {error && <div className="app-error">后端错: {error}</div>}
        {!data && !error && <div className="app-loading">载入中…</div>}
        {data && (data.profiles || []).length === 0 && (
          <div style={{ color: 'var(--ink-4)', textAlign: 'center', padding: '40px 16px', fontFamily: 'var(--mono)', fontSize: 11, letterSpacing: '0.1em' }}>
            还没有 API profile · 去桌面端添加
          </div>
        )}
        {data && (data.profiles || []).map(p => {
          const isActive = p.id === data.active;
          return (
            <div key={p.id} className={'api-row' + (isActive ? ' active' : '')}>
              <div className="api-row-mid">
                <div className="api-row-name">{p.name}</div>
                <div className="api-row-meta">
                  <span><b>{p.model}</b></span>
                  {p.has_key && <span>· {p.api_key_mask}</span>}
                  <span style={{ opacity: 0.6 }}>· {p.base_url}</span>
                </div>
              </div>
              {isActive ? (
                <span className="api-row-active-badge">在用</span>
              ) : (
                <button
                  className="api-row-switch"
                  onClick={() => switchTo(p.id)}
                  disabled={busyId === p.id}
                >{busyId === p.id ? '切换中' : '切到'}</button>
              )}
            </div>
          );
        })}
        <div style={{ marginTop: 16, fontFamily: 'var(--mono)', fontSize: 9.5, color: 'var(--ink-4)', letterSpacing: '0.08em', textAlign: 'center', padding: '0 16px', lineHeight: 1.6 }}>
          新增 / 编辑 / 删除 profile 请在桌面端配置页操作
        </div>
      </div>
      <TabBar active="setting"/>
    </div>
  );
}

function TrashScreen() {
  const [items, setItems] = useState(null);
  const [error, setError] = useState(null);
  const [busyId, setBusyId] = useState(null);

  useEffect(() => {
    api('/api/trash')
      .then(d => setItems((d && d.trash) || []))
      .catch(e => setError(e.message));
  }, []);

  const restore = async (id) => {
    setBusyId(id);
    try {
      const r = await fetch('/api/bucket/' + encodeURIComponent(id) + '/restore', { method: 'POST' });
      if (!r.ok) throw new Error('HTTP ' + r.status);
      setItems(prev => prev.filter(it => it.id !== id));
    } catch (e) {
      alert('恢复失败: ' + e.message);
    } finally {
      setBusyId(null);
    }
  };

  const purge = async (id, name) => {
    if (!window.confirm('永久删除「' + (name || id) + '」?\n这条记忆不会再回来。')) return;
    setBusyId(id);
    try {
      const r = await fetch('/api/bucket/' + encodeURIComponent(id) + '/purge', { method: 'POST' });
      if (!r.ok) throw new Error('HTTP ' + r.status);
      setItems(prev => prev.filter(it => it.id !== id));
    } catch (e) {
      alert('永删失败: ' + e.message);
    } finally {
      setBusyId(null);
    }
  };

  return (
    <div className="trash-body">
      <div className="sub-top">
        <div className="sub-back-row">
          <button className="app-back" onClick={() => navigate('/setting')}>‹ 设置</button>
          <span className="app-eyebrow" style={{ marginLeft: 'auto' }}>
            <span>软删除可恢复</span>
          </span>
        </div>
        <h1 className="sub-title">回收站</h1>
        <div className="sub-meta"><b>{items ? items.length : '…'}</b> 条</div>
      </div>
      <div className="trash-list">
        {error && <div className="app-error">后端错: {error}</div>}
        {!items && !error && <div className="app-loading">载入中…</div>}
        {items && items.length === 0 && (
          <div style={{ color: 'var(--ink-4)', textAlign: 'center', padding: '40px 16px', fontFamily: 'var(--mono)', fontSize: 11, letterSpacing: '0.1em' }}>
            回收站空
          </div>
        )}
        {items && items.map(it => (
          <div key={it.id} className="trash-item">
            <div className="trash-item-hd">
              <span className="trash-item-title">{it.name || it.id}</span>
              <span className="trash-item-when">
                {it.trashed_at ? new Date(it.trashed_at).toLocaleDateString() : '—'}
              </span>
            </div>
            <div className="trash-item-snip">
              {it.summary || it.content_preview || '(无摘要)'}
            </div>
            <div className="trash-item-acts">
              <button
                className="trash-act-btn restore"
                onClick={() => restore(it.id)}
                disabled={busyId === it.id}
              >↺ 恢复</button>
              <button
                className="trash-act-btn purge"
                onClick={() => purge(it.id, it.name)}
                disabled={busyId === it.id}
              >✕ 永久删除</button>
            </div>
          </div>
        ))}
      </div>
      <TabBar active="setting"/>
    </div>
  );
}

function ImportScreen() {
  const [mode, setMode] = useState('text'); // 'text' or 'file'
  const [text, setText] = useState('');
  const [file, setFile] = useState(null);
  const [results, setResults] = useState(null);
  const [submitting, setSubmitting] = useState(false);
  const [status, setStatus] = useState(null);
  const [refreshKey, setRefreshKey] = useState(0);
  const fileInputRef = useRef(null);

  useEffect(() => {
    let cancel = false;
    api('/api/import/results?limit=20')
      .then(d => { if (!cancel) setResults((d && d.buckets) || []); })
      .catch(() => { if (!cancel) setResults([]); });
    api('/api/import/status')
      .then(d => { if (!cancel) setStatus(d || null); })
      .catch(() => {});
    return () => { cancel = true; };
  }, [refreshKey]);

  // 处理中时每 3s 轮询(后端字段是 status === 'running',不是 is_running)
  const isRunning = status && status.status === 'running';
  useEffect(() => {
    if (!isRunning) return;
    const t = setInterval(() => {
      api('/api/import/status')
        .then(d => {
          setStatus(d || null);
          if (d && d.status !== 'running') setRefreshKey(k => k + 1);
        })
        .catch(() => {});
    }, 3000);
    return () => clearInterval(t);
  }, [isRunning]);

  const submit = async () => {
    if (submitting || isRunning) return;
    setSubmitting(true);
    try {
      let r;
      if (mode === 'file') {
        if (!file) return;
        const fd = new FormData();
        fd.append('file', file);
        r = await fetch(`/api/import/upload?preserve_raw=1`, {
          method: 'POST',
          body: fd,
        });
      } else {
        const trimmed = text.trim();
        if (!trimmed) return;
        const fname = `mobile-${Date.now()}.txt`;
        r = await fetch(
          `/api/import/upload?filename=${encodeURIComponent(fname)}&preserve_raw=1`,
          {
            method: 'POST',
            headers: { 'Content-Type': 'text/plain' },
            body: trimmed,
          }
        );
      }
      if (!r.ok) {
        const err = await r.json().catch(() => ({}));
        throw new Error(err.error || `HTTP ${r.status}`);
      }
      setText('');
      setFile(null);
      // 1s 后刷新 — 让后端先把 status 切到 running
      setTimeout(() => setRefreshKey(k => k + 1), 1000);
    } catch (e) {
      alert('提交失败: ' + e.message);
    } finally {
      setSubmitting(false);
    }
  };

  const batches = useMemo(() => {
    if (!results) return [];
    const map = new Map();
    for (const b of results) {
      const dt = bucketDate(b);
      if (!dt) continue;
      const k = dayKeyOf(dt);
      if (!map.has(k)) map.set(k, { dt, items: [] });
      map.get(k).items.push(b);
    }
    return Array.from(map.values()).sort((a, b) => b.dt - a.dt).slice(0, 10);
  }, [results]);

  // 状态可视化
  const statusKind = !status ? 'idle'
    : status.status === 'running' ? 'running'
    : status.status === 'completed' ? 'done'
    : status.status === 'error' ? 'error'
    : 'idle';
  const statusLabel = !status ? '—'
    : status.status === 'running' ? '处理中'
    : status.status === 'completed' ? '已完成'
    : status.status === 'error' ? '错误'
    : status.status === 'paused' ? '已暂停'
    : '待机';
  const total = (status && status.total_chunks) || 0;
  const processed = (status && status.processed) || 0;
  const pct = total > 0 ? Math.min(100, (processed / total) * 100) : 0;
  const showProgressCard = !!status && status.status && status.status !== 'idle';
  const recentExtracted = (status && Array.isArray(status.recent_extracted)) ? status.recent_extracted.slice(-5).reverse() : [];
  const submitDisabled = submitting || isRunning ||
    (mode === 'text' ? !text.trim() : !file);

  return (
    <div className="import-body">
      <div className="sub-top">
        <div className="sub-back-row">
          <button className="app-back" onClick={() => navigate('/setting')}>‹ 设置</button>
          <button
            className="app-back"
            style={{ marginLeft: 'auto', fontSize: 11, fontFamily: 'var(--mono)', letterSpacing: '0.06em' }}
            onClick={() => setRefreshKey(k => k + 1)}
          >↻ 刷新</button>
        </div>
        <h1 className="sub-title">导入</h1>
        <div className="sub-meta">粘贴文本 / 上传文件 → LLM 拆分 + 摘要 + 入库</div>
      </div>

      {showProgressCard && (
        <div className={'import-progress-card ' + statusKind}>
          <div className={'import-progress-status ' + statusKind}>
            <span className="pip"/>
            <b>{statusLabel}</b>
            {status.source_file && <span style={{ color: 'var(--ink-4)' }}>· {status.source_file}</span>}
          </div>
          {total > 0 && (
            <>
              <div className="import-progress-bar">
                <div className="import-progress-bar-fill" style={{ width: pct + '%' }}/>
              </div>
              <div className="import-progress-stats">
                <span>进度 <b>{processed}</b> / {total}</span>
                {typeof status.memories_created === 'number' && status.memories_created > 0 && (
                  <span>新建 <b>{status.memories_created}</b></span>
                )}
                {typeof status.memories_merged === 'number' && status.memories_merged > 0 && (
                  <span>合并 <b>{status.memories_merged}</b></span>
                )}
                {typeof status.total_cost_usd === 'number' && status.total_cost_usd > 0 && (
                  <span>开销 <b>${status.total_cost_usd.toFixed(3)}</b></span>
                )}
              </div>
            </>
          )}
          {recentExtracted.length > 0 && (
            <div className="import-progress-recent">
              <div className="import-progress-recent-hd">最近提取</div>
              {recentExtracted.map((it, i) => (
                <div key={i} className="import-progress-recent-item">
                  {it.name || it.summary || '(无标题)'}
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      <div className="import-mode-tabs">
        <button
          className={'import-mode-tab' + (mode === 'text' ? ' on' : '')}
          onClick={() => setMode('text')}
          disabled={submitting || isRunning}
        >粘贴文本</button>
        <button
          className={'import-mode-tab' + (mode === 'file' ? ' on' : '')}
          onClick={() => setMode('file')}
          disabled={submitting || isRunning}
        >上传文件</button>
      </div>

      <div className="import-form">
        {mode === 'text' ? (
          <textarea
            className="import-textarea"
            placeholder="粘贴想入库的文本(聊天记录 / 笔记 / 日记 …)"
            value={text}
            onChange={e => setText(e.target.value)}
            disabled={submitting || isRunning}
          />
        ) : (
          <>
            <div
              className={'import-file-zone' + (file ? ' has-file' : '')}
              onClick={() => {
                if (submitting || isRunning) return;
                if (fileInputRef.current) fileInputRef.current.click();
              }}
            >
              <span className="ic">{file ? '✓' : '↥'}</span>
              {file ? (
                <>
                  <span className="fname">{file.name}</span>
                  <span>{(file.size / 1024).toFixed(1)} KB · 点这里换文件</span>
                </>
              ) : (
                <span>点这里选文件 · txt / json / md</span>
              )}
            </div>
            <input
              ref={fileInputRef}
              type="file"
              accept=".txt,.json,.md,.markdown,text/*,application/json"
              onChange={e => setFile(e.target.files && e.target.files[0])}
              disabled={submitting || isRunning}
              style={{ display: 'none' }}
            />
          </>
        )}
        <div className="import-submit-row">
          <button
            className="import-submit"
            onClick={submit}
            disabled={submitDisabled}
          >
            {submitting ? '提交中 …' : isRunning ? '后台正在处理' : '→ 开始导入'}
          </button>
        </div>
      </div>

      <div className="import-batches">
        <div className="import-batch-hd">最近导入 / 写入</div>
        {!results && <div className="app-loading" style={{ height: 'auto', padding: '20px 0' }}>载入中…</div>}
        {results && batches.length === 0 && (
          <div style={{ color: 'var(--ink-4)', textAlign: 'center', padding: '20px 0', fontFamily: 'var(--mono)', fontSize: 11, letterSpacing: '0.1em' }}>
            没有最近批次
          </div>
        )}
        {batches.map(b => (
          <div key={dayKeyOf(b.dt)} className="import-batch-item">
            <span className="import-batch-when">
              {fmtDay(b.dt).mo} {fmtDay(b.dt).num}
            </span>
            <span className="import-batch-cnt"><b>{b.items.length}</b> 条</span>
          </div>
        ))}
      </div>
      <TabBar active="setting"/>
    </div>
  );
}

// ─────────────────────────────────────────
// 占位屏(给 /new 等还没实装的路由用)
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
  // 暗夜模式:挂载时按 localStorage 应用 data-theme
  useEffect(() => {
    const saved = localStorage.getItem('mobile-theme');
    if (saved === 'dark') document.documentElement.setAttribute('data-theme', 'dark');
  }, []);

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
      return <ReviewScreen/>;
    case 'cal':
      return <CalScreen/>;
    case 'setting':
      if (rest[0] === 'trash') return <TrashScreen/>;
      if (rest[0] === 'import') return <ImportScreen/>;
      if (rest[0] === 'api') return <ApiSettingScreen/>;
      return <SettingScreen/>;
    case 'new':
      return <NewScreen/>;
    default:
      return <PlaceholderScreen tab="home" ic="?" title="未知路由" sub={'#/' + route.join('/')}/>;
  }
}

ReactDOM.createRoot(document.getElementById('root')).render(<App/>);
