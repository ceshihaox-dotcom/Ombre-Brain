// extras-v2.jsx —— TodayBar / WriteDrawer / FAB / MiniTimeline / DarkToggle / Siblings / Related

const { useState: uS, useEffect: uE, useMemo: uM, useRef: uR } = React;

// ── 暗色切换 ──────────────────────────────────────────
function DarkToggle({ dark, onChange }) {
  return (
    <button
      className={`ob-dark-btn ${dark ? 'on' : ''}`}
      onClick={() => onChange(!dark)}
      title={dark ? '切到日间' : '切到暗夜'}
    >
      <span className="ob-dark-icon">{dark ? '☾' : '☀'}</span>
    </button>
  );
}

// ── 今天状态条 ────────────────────────────────────────
function TodayBar({ todayItems, lastWriteDate, todayDate, onWrite, onJumpToday }) {
  let state, label, sub;
  if (todayItems.length > 0) {
    state = 'on';
    const hi = todayItems.filter(i => i.importance >= 8 || i.highlight).length;
    label = `今天写了 ${todayItems.length} 条`;
    sub = hi > 0 ? `其中 ${hi} 条重要 · 继续记录` : '继续记录这一天';
  } else if (lastWriteDate) {
    const d = dayDiff(todayDate, lastWriteDate);
    if (d <= 1) {
      state = 'idle';
      label = '今天还没记录';
      sub = '在你忘记之前 · 写一条';
    } else {
      state = 'cold';
      label = `已经 ${d} 天没写`;
      sub = '记忆会褪色 · 现在补一条';
    }
  } else {
    state = 'idle';
    label = '今天还没记录';
    sub = '从这里开始你的第一条';
  }

  const f = formatDateV2(todayDate);
  return (
    <div className={`ob-today ob-today-${state}`}>
      <div className="ob-today-l">
        <div className="ob-today-pulse">
          <span className="ob-today-dot" />
          <span className="ob-today-ring" />
        </div>
        <div className="ob-today-text">
          <div className="ob-today-eyebrow">{f.y}-{f.m}-{f.day} · {f.wk}</div>
          <div className="ob-today-label">{label}</div>
        </div>
      </div>
      <div className="ob-today-r">
        <div className="ob-today-sub">{sub}</div>
        <div className="ob-today-actions">
          {todayItems.length > 0 && (
            <button className="ob-today-btn ghost" onClick={onJumpToday}>查看今天 ↓</button>
          )}
          <button className="ob-today-btn primary" onClick={onWrite}>+ 写一条</button>
        </div>
      </div>
    </div>
  );
}

// ── 右侧 Mini Timeline ──────────────────────────────
function MiniTimeline({ items, onJump }) {
  const [hover, setHover] = uS(null);
  const sorted = uM(() => [...items].sort((a, b) => (b.date + b.time).localeCompare(a.date + a.time)), [items]);

  return (
    <div className="ob-mini" aria-label="迷你时间线">
      <div className="ob-mini-rail">
        {sorted.map((it, i) => {
          const isHi = it.importance >= 8 || it.highlight;
          const tone = it.feel ? 'feel' : (isHi ? 'hi' : 'norm');
          return (
            <div
              key={it.id}
              className={`ob-mini-node ob-mini-${tone}`}
              style={{ top: `${(i / Math.max(1, sorted.length - 1)) * 100}%` }}
              onMouseEnter={() => setHover(it)}
              onMouseLeave={() => setHover(null)}
              onClick={() => onJump(it)}
              title={`${it.date} ${it.time} · ${it.title}`}
            />
          );
        })}
      </div>
      {hover && (
        <div className="ob-mini-tip">
          <div className="ob-mini-tip-d">{hover.date}</div>
          <div className="ob-mini-tip-t">{hover.title}</div>
        </div>
      )}
      <div className="ob-mini-label">
        <span>近</span>
        <span className="ob-mini-bar" />
        <span>远</span>
      </div>
    </div>
  );
}

// ── 浮动 FAB ─────────────────────────────────────────
function Fab({ onClick }) {
  return (
    <button className="ob-fab" onClick={onClick} title="写一条 (⌘+N)">
      <span className="ob-fab-plus">+</span>
      <span className="ob-fab-hint">⌘N</span>
    </button>
  );
}

// ── 写入抽屉（v2 · 信纸感重设计）─────────────────────
function WriteDrawer({ open, onClose, onSave, defaultDate, defaultTime, defaultTags }) {
  const [title, setTitle] = uS('');
  const [summary, setSummary] = uS('');
  const [body, setBody] = uS('');
  const [time, setTime] = uS(defaultTime);
  const [date, setDate] = uS(defaultDate);
  const [importance, setImportance] = uS(5);
  const [feel, setFeel] = uS(false);
  const [protectFlag, setProtect] = uS(false);
  const [tags, setTags] = uS([]);
  const titleRef = uR(null);

  uE(() => {
    if (open) {
      setTitle(''); setSummary(''); setBody(''); setImportance(5);
      setFeel(false); setProtect(false); setTags(defaultTags || []);
      setDate(defaultDate); setTime(defaultTime);
      setTimeout(() => titleRef.current && titleRef.current.focus(), 80);
    }
  }, [open, defaultDate, defaultTime, defaultTags]);

  uE(() => {
    if (!open) return;
    const onKey = (e) => {
      if (e.key === 'Escape') onClose();
      if ((e.metaKey || e.ctrlKey) && e.key === 'Enter' && title.trim()) {
        e.preventDefault();
        onSave({ title, summary, body, date, time, importance, feel, protected: protectFlag, tags });
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, title, summary, body, date, time, importance, feel, protectFlag, tags, onSave, onClose]);

  if (!open) return null;

  const toggleTag = (t) => {
    setTags(prev => prev.includes(t) ? prev.filter(x => x !== t) : [...prev, t]);
  };

  const allTags = ['亲手写', 'AI 写入', '已内化', '保护', '重要', 'feel(柔软)'];
  const valid = title.trim().length > 0;
  const charCount = title.length + summary.length + body.length;

  // importance 标签
  const impTone = importance >= 9 ? '里程碑' : importance >= 7 ? '重要' : importance >= 5 ? '日常' : importance >= 3 ? '碎片' : '微光';

  return (
    <div className="ob-write-wrap" onClick={onClose}>
      <div className="ob-write" onClick={(e) => e.stopPropagation()}>
        {/* 装订线 */}
        <div className="ob-write-binding" />
        <button className="ob-write-close" onClick={onClose} title="Esc">✕</button>

        <div className="ob-write-paper">
          {/* 头标：日期 + 时间 一体化 */}
          <div className="ob-write-stamp">
            <input type="date" value={date} onChange={(e) => setDate(e.target.value)} className="ob-write-stamp-d" />
            <span className="ob-write-stamp-sep">·</span>
            <input type="time" value={time} onChange={(e) => setTime(e.target.value)} className="ob-write-stamp-t" />
            <button className="ob-write-now" onClick={() => { setDate(defaultDate); setTime(defaultTime); }} title="使用现在">↺</button>
          </div>

          {/* 主标题（极简下划线） */}
          <input
            ref={titleRef}
            className="ob-write-title"
            placeholder="标题——这一刻是什么？"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
          />

          {/* 摘要 */}
          <textarea
            className="ob-write-sum"
            placeholder="一句话摘要 · 以后只看这句的样子"
            value={summary}
            onChange={(e) => setSummary(e.target.value)}
            rows="2"
          />

          {/* 折叠正文 */}
          <details className="ob-write-body-wrap">
            <summary>＋ 展开正文（可选）</summary>
            <textarea
              className="ob-write-body"
              placeholder="…慢慢写。留白也可以。"
              value={body}
              onChange={(e) => setBody(e.target.value)}
              rows="5"
            />
          </details>

          {/* 横向元数据条 */}
          <div className="ob-write-meta-row">
            {/* importance 大滑块 */}
            <div className="ob-write-imp-wrap">
              <div className="ob-write-imp-hd">
                <span>importance</span>
                <span className="ob-write-imp-num"><b>{importance}</b><em>· {impTone}</em></span>
              </div>
              <div className="ob-write-imp-track">
                {Array.from({ length: 10 }).map((_, i) => (
                  <button
                    key={i}
                    type="button"
                    className={`ob-write-imp-cell ${i < importance ? 'on' : ''} ${i < importance && i >= 7 ? 'hi' : ''}`}
                    onClick={() => setImportance(i + 1)}
                    title={`${i + 1}`}
                  />
                ))}
              </div>
            </div>

            {/* flags */}
            <div className="ob-write-flags">
              <button
                type="button"
                className={`ob-write-flag ${feel ? 'on feel' : ''}`}
                onClick={() => setFeel(!feel)}
              >
                <span className="ob-write-flag-i">❀</span>
                <span>feel</span>
              </button>
              <button
                type="button"
                className={`ob-write-flag ${protectFlag ? 'on protect' : ''}`}
                onClick={() => setProtect(!protectFlag)}
              >
                <span className="ob-write-flag-i">⛨</span>
                <span>保护</span>
              </button>
            </div>
          </div>

          {/* 标签 */}
          <div className="ob-write-tags-wrap">
            <span className="ob-write-tags-lbl">标签</span>
            <div className="ob-write-tags">
              {allTags.map(t => (
                <button
                  key={t}
                  type="button"
                  className={`ob-write-tag ${tags.includes(t) ? 'on' : ''}`}
                  onClick={() => toggleTag(t)}
                >{t}</button>
              ))}
            </div>
          </div>
        </div>

        {/* 浮动底栏 */}
        <footer className="ob-write-foot">
          <div className="ob-write-foot-meta">
            <span>{charCount} 字</span>
            <span className="dot">·</span>
            <span>⌘↵ 保存</span>
            <span className="dot">·</span>
            <span>Esc 取消</span>
          </div>
          <button
            className="ob-write-save"
            disabled={!valid}
            onClick={() => valid && onSave({ title, summary, body, date, time, importance, feel, protected: protectFlag, tags })}
          >
            <span>接住这一刻</span>
            <span className="ob-write-save-arrow">↵</span>
          </button>
        </footer>
      </div>
    </div>
  );
}

// 同日其他条目
function SiblingsRow({ items, current, onOpen }) {
  const others = items.filter(i => i.id !== current.id);
  if (others.length === 0) return null;
  return (
    <>
      <div className="ob-modal-section">同日其他记忆 · {others.length}</div>
      <div className="ob-siblings">
        {others.map(it => {
          const isHi = it.importance >= 8 || it.highlight;
          return (
            <button key={it.id} className="ob-sibling" onClick={() => onOpen(it)}>
              <div className="ob-sibling-time">{it.time}</div>
              <div className={`ob-sibling-title ${isHi ? 'hi' : ''} ${it.feel ? 'feel' : ''}`}>{it.title}</div>
              <div className="ob-sibling-sum">{it.summary}</div>
            </button>
          );
        })}
      </div>
    </>
  );
}

// 关联记忆
function RelatedRow({ all, current, onOpen }) {
  const score = (a) => {
    if (a.id === current.id || a.date === current.date) return -1;
    let s = 0;
    const tags = new Set(current.tags || []);
    for (const t of (a.tags || [])) if (tags.has(t)) s += 1;
    if (a.feel && current.feel) s += 0.5;
    if (a.importance >= 8 && current.importance >= 8) s += 0.5;
    return s;
  };
  const ranked = [...all].map(a => [a, score(a)]).filter(([, s]) => s > 0).sort((a, b) => b[1] - a[1]).slice(0, 3).map(([a]) => a);
  if (ranked.length === 0) return null;
  return (
    <>
      <div className="ob-modal-section">可能关联 · 基于标签</div>
      <div className="ob-siblings">
        {ranked.map(it => (
          <button key={it.id} className="ob-sibling related" onClick={() => onOpen(it)}>
            <div className="ob-sibling-time">{it.date} · {it.time}</div>
            <div className={`ob-sibling-title ${it.importance >= 8 ? 'hi' : ''} ${it.feel ? 'feel' : ''}`}>{it.title}</div>
            <div className="ob-sibling-sum">{it.summary}</div>
          </button>
        ))}
      </div>
    </>
  );
}

window.DarkToggle = DarkToggle;
window.TodayBar = TodayBar;
window.MiniTimeline = MiniTimeline;
window.Fab = Fab;
window.WriteDrawer = WriteDrawer;
window.SiblingsRow = SiblingsRow;
window.RelatedRow = RelatedRow;
