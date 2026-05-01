// constellation-panels.jsx —— 左浮筛选/图例 + 右抽屉详情 + 底栏工具

const { useState: cpS, useMemo: cpM } = React;

// ── 左浮面板 ──
function LeftPanel({
  items, links, layout,
  mode, setMode,
  enabledTypes, toggleType,
  tagFilters, toggleTag,
  impMin, setImpMin,
  searchQuery,
  onFocusIsland,
}) {
  // 类型分布
  const typeCounts = cpM(() => {
    const c = { dynamic: 0, permanent: 0, feel: 0, archived: 0 };
    items.forEach(it => c[inferType(it)]++);
    return c;
  }, [items]);

  // 全部 tag
  const allTags = cpM(() => {
    const s = new Set();
    items.forEach(it => (it.tags || []).forEach(t => s.add(t)));
    return [...s];
  }, [items]);

  // 孤岛：没有任何边的节点
  const islands = cpM(() => {
    const conn = new Set();
    links.forEach(l => { conn.add(l.source); conn.add(l.target); });
    return items.filter(it => !conn.has(it.id));
  }, [items, links]);

  return (
    <aside className="cs-left">
      <div className="cs-section">
        <div className="cs-section-hd"><span>视图模式</span></div>
        <div className="cs-modes">
          {[
            ['constellation', '星图'],
            ['cluster', '聚类'],
            ['time', '时间'],
            ['type', '类型']
          ].map(([k, name]) => (
            <button key={k} className={`cs-mode ${mode === k ? 'on' : ''}`} onClick={() => setMode(k)}>{name}</button>
          ))}
        </div>
      </div>

      <div className="cs-section">
        <div className="cs-section-hd"><span>图例 · 星体类型</span><b>{items.length} 颗</b></div>
        <div className="cs-legend">
          {[
            ['dynamic',   'dynamic',   '日常动态'],
            ['permanent', 'permanent', '永久 / 钉决'],
            ['feel',      'feel',      '情感 · feel'],
            ['archived',  'archived',  '归档低活']
          ].map(([k, en, name]) => (
            <div
              key={k}
              className={`cs-legend-row ${enabledTypes.has(k) ? '' : 'off'}`}
              onClick={() => toggleType(k)}
            >
              <span className={`cs-legend-dot ${k}`}/>
              <span className="cs-legend-name">{name}<em>{en}</em></span>
              <span className="cs-legend-count">{typeCounts[k] || 0}</span>
            </div>
          ))}
        </div>
      </div>

      <div className="cs-section">
        <div className="cs-section-hd"><span>importance 阈值</span><b>≥ {impMin}</b></div>
        <div className="cs-imp-slider">
          <input type="range" min="1" max="10" value={impMin} onChange={(e) => setImpMin(parseInt(e.target.value, 10))}/>
          <b>{impMin}</b>
        </div>
      </div>

      {allTags.length > 0 && (
        <div className="cs-section">
          <div className="cs-section-hd"><span>标签 · 点选筛选</span><b>{tagFilters.size}/{allTags.length}</b></div>
          <div className="cs-tag-filters">
            {allTags.map(t => (
              <button
                key={t}
                className={`cs-tag-chip ${tagFilters.has(t) ? 'on' : ''}`}
                onClick={() => toggleTag(t)}
              >{t}</button>
            ))}
          </div>
        </div>
      )}

      {islands.length > 0 && (
        <div className="cs-section">
          <div className="cs-island">
            <b>{islands.length} 颗孤星</b> 还没有任何关联。
            {' '}<a onClick={() => onFocusIsland(islands)}>查看 →</a>
          </div>
        </div>
      )}
    </aside>
  );
}
window.LeftPanel = LeftPanel;

// ── 右抽屉详情 ──
function RightDrawer({ item, items, links, onClose, onSelect, onUpdate, onFocus, focusedId }) {
  if (!item) return null;
  const type = inferType(item);
  const vis = TYPE_VIS[type];
  const cells = Array.from({ length: 10 }, (_, i) => i < item.importance);

  // 关联
  const related = cpM(() => {
    if (!item) return [];
    const out = [];
    links.forEach(l => {
      if (l.source === item.id) out.push({ id: l.target, w: l.weight, shared: l.shared });
      if (l.target === item.id) out.push({ id: l.source, w: l.weight, shared: l.shared });
    });
    return out.sort((a, b) => b.w - a.w).slice(0, 5)
      .map(r => ({ ...r, item: items.find(i => i.id === r.id) }))
      .filter(r => r.item);
  }, [item, links, items]);

  return (
    <aside className={`cs-right ${item ? 'open' : ''}`}>
      <div className="cs-right-hd">
        <div className="cs-right-eyebrow">
          <span className="dot" style={{ background: vis.fill }}/>
          <span>{type}</span>
          <span style={{ opacity: 0.5 }}>·</span>
          <span>{item.id.toUpperCase()}</span>
          {item.highlight && <><span style={{ opacity: 0.5 }}>·</span><span style={{ color: 'var(--c-gold)' }}>★ 重要</span></>}
          {item.protected && <><span style={{ opacity: 0.5 }}>·</span><span>⛨ 保护</span></>}
          <button className="cs-right-close" onClick={onClose}>✕</button>
        </div>
        <h2 className="cs-right-title">{item.title}</h2>
        <div className="cs-right-sub">
          <span>{item.date}</span>
          <span className="sep">·</span>
          <span>{item.time}</span>
          <span className="sep">·</span>
          <span>imp {item.importance}</span>
        </div>
      </div>

      <div className="cs-right-body">
        {item.summary && (
          <div>
            <div className="cs-right-section">摘要</div>
            <p className="cs-right-summary" style={{ marginTop: 14 }}>{item.summary}</p>
          </div>
        )}

        {item.body && (
          <div>
            <div className="cs-right-section">正文</div>
            <div className="cs-right-content" style={{ marginTop: 14 }}>{item.body}</div>
          </div>
        )}

        <div>
          <div className="cs-right-section">元数据</div>
          <div className="cs-right-meta-grid" style={{ marginTop: 14 }}>
            <div className="cs-right-meta-cell">
              <span className="lbl">importance</span>
              <span className="val">
                <div className="cs-right-imp-track">
                  {cells.map((on, i) => (
                    <span key={i} className={`cs-right-imp-cell ${on ? 'on' : ''} ${on && i >= 7 ? 'hi' : ''}`}/>
                  ))}
                </div>
              </span>
            </div>
            {typeof item.score === 'number' && (
              <div className="cs-right-meta-cell">
                <span className="lbl">权重 score</span>
                <span className="val" style={{ fontFamily: 'var(--mono)' }}>
                  {item.score.toFixed(2)}
                </span>
              </div>
            )}
            <div className="cs-right-meta-cell">
              <span className="lbl">类型</span>
              <span className="val" style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <span style={{ width: 8, height: 8, borderRadius: '50%', background: vis.fill, display: 'inline-block' }}/>
                {type}
              </span>
            </div>
            <div className="cs-right-meta-cell">
              <span className="lbl">创建</span>
              <span className="val">{item.date} {item.time}</span>
            </div>
            <div className="cs-right-meta-cell">
              <span className="lbl">状态</span>
              <span className="val">
                {item.feel ? '❀ feel ' : ''}
                {item.protected ? '⛨ 永久 ' : ''}
                {item.highlight ? '★ 重要 ' : ''}
                {!item.feel && !item.protected && !item.highlight ? '常规' : ''}
              </span>
            </div>
          </div>
        </div>

        {item.tags && item.tags.length > 0 && (
          <div>
            <div className="cs-right-section">标签</div>
            <div className="cs-right-tags" style={{ marginTop: 12 }}>
              {item.tags.map(t => <span key={t} className="cs-right-tag">{t}</span>)}
            </div>
          </div>
        )}

        {related.length > 0 && (
          <div>
            <div className="cs-right-section">关联记忆 · {related.length}</div>
            <div className="cs-right-related-list" style={{ marginTop: 12 }}>
              {related.map(r => (
                <div key={r.id} className="cs-right-related" onClick={() => onSelect(r.id)}>
                  <div className="cs-right-related-eyebrow">
                    <span className="cs-right-related-dot" style={{ background: TYPE_VIS[inferType(r.item)].fill }}/>
                    <span>{inferType(r.item)}</span>
                    <span style={{ opacity: 0.5 }}>·</span>
                    <span>共享 {(r.shared || []).join(' / ') || '同日'}</span>
                    <span style={{ marginLeft: 'auto', fontFamily: 'var(--mono)' }}>w {r.w.toFixed(1)}</span>
                  </div>
                  <div className="cs-right-related-title">{r.item.title}</div>
                  {r.item.summary && <div className="cs-right-related-sum">{r.item.summary}</div>}
                </div>
              ))}
            </div>
          </div>
        )}

        <div>
          <div className="cs-right-section">操作</div>
          <div className="cs-right-actions" style={{ marginTop: 12 }}>
            <button className={`cs-right-action ${focusedId === item.id ? 'on' : ''}`} onClick={() => onFocus(focusedId === item.id ? null : item.id)}>
              <span className="i">◎</span><span>{focusedId === item.id ? '退出聚焦' : '聚焦'}</span>
            </button>
            <button className="cs-right-action" onClick={() => onUpdate(item.id, { protected: !item.protected })}>
              <span className="i">⛨</span><span>{item.protected ? '取消保护' : '保护'}</span>
            </button>
            <button className="cs-right-action" onClick={() => onUpdate(item.id, { archived: !item.archived })}>
              <span className="i">▤</span><span>{item.archived ? '取消归档' : '归档'}</span>
            </button>
            <button className="cs-right-action danger" onClick={() => { if (confirm('确认删除？')) onUpdate(item.id, { __delete: true }); }}>
              <span className="i">✕</span><span>删除</span>
            </button>
          </div>
        </div>
      </div>
    </aside>
  );
}
window.RightDrawer = RightDrawer;

// ── 底栏工具 ──
function BottomBar({ zoom, setZoom, onReset, focusedId, onClearFocus, mode, setMode, timeOpen, setTimeOpen }) {
  return (
    <div className="cs-bottom">
      <button className="cs-tool" onClick={() => setZoom(z => Math.max(0.3, z * 0.85))} title="缩小">
        <span className="i">−</span>
      </button>
      <span className="cs-zoom-val">{Math.round(zoom * 100)}%</span>
      <button className="cs-tool" onClick={() => setZoom(z => Math.min(3, z * 1.18))} title="放大">
        <span className="i">+</span>
      </button>
      <span className="cs-tool-sep"/>
      <button className="cs-tool" onClick={onReset} title="重置视图">
        <span className="i">⊙</span><span>重置</span>
      </button>
      {focusedId && (
        <button className="cs-tool on" onClick={onClearFocus} title="退出聚焦">
          <span className="i">◎</span><span>退出聚焦</span>
        </button>
      )}
      <span className="cs-tool-sep"/>
      <button className={`cs-tool ${timeOpen ? 'on' : ''}`} onClick={() => setTimeOpen(o => !o)} title="时间回放">
        <span className="i">↻</span><span>时间回放</span>
      </button>
    </div>
  );
}
window.BottomBar = BottomBar;

// ── 时间回放浮条 ──
function TimeBar({ items, value, onChange, rightOpen, onClose }) {
  const sorted = cpM(() => [...items].sort((a, b) => (a.date + a.time).localeCompare(b.date + b.time)), [items]);
  const N = sorted.length;
  const cur = sorted[Math.min(N - 1, Math.max(0, value))];
  const first = sorted[0], last = sorted[N - 1];
  return (
    <div className={`cs-time-bar ${rightOpen ? 'right-open' : ''}`}>
      <div className="cs-time-bar-hd">
        <span>时间回放</span>
        <span><b>{value + 1}</b> / {N} · {cur ? cur.date : ''}</span>
        <button className="cs-right-close" onClick={onClose} style={{ width: 18, height: 18, fontSize: 11 }}>✕</button>
      </div>
      <input
        type="range"
        min="0"
        max={Math.max(0, N - 1)}
        value={value}
        onChange={(e) => onChange(parseInt(e.target.value, 10))}
      />
      <div className="cs-time-bar-foot">
        <span>{first ? first.date : ''}</span>
        <span>{last ? last.date : ''}</span>
      </div>
    </div>
  );
}
window.TimeBar = TimeBar;
