// cells.jsx —— 记忆格列表 v2 · 优化版

const { useState: cuS, useMemo: cuM, useEffect: cuE, useRef: cuR } = React;

// ── helpers ──
function relTime(date, time, todayDate) {
  const d1 = new Date(todayDate + 'T23:30');
  const d2 = new Date(date + 'T' + (time || '00:00'));
  const diffH = Math.round((d1 - d2) / 36e5);
  if (diffH < 1) return '刚刚';
  if (diffH < 24) return `${diffH}h前`;
  const diffD = Math.floor(diffH / 24);
  if (diffD < 30) return `${diffD}天`;
  const diffMo = Math.floor(diffD / 30);
  if (diffMo < 12) return `${diffMo}月`;
  return `${Math.floor(diffMo / 12)}年`;
}
function isUntitled(title) {
  return /^[a-f0-9]{6,}$/i.test(title);
}
function tier(item) {
  if (item.protected || item.pinned) return 'pin';
  if (item.importance >= 8 || item.highlight) return 'fresh';
  if (item.feel) return 'feel';
  if (item.importance < 2) return 'cold';
  return 'normal';
}

// importance dot
function ImpDot({ value }) {
  const size = 4 + (value / 10) * 8;  // 4 → 12 px
  const isHi = value >= 8;
  const isCold = value < 2;
  const color = isHi ? 'var(--accent)' : isCold ? 'var(--ink-4)' : 'var(--ink-3)';
  const glow = isHi ? '0 0 6px rgba(110,79,154,0.55)' : 'none';
  return (
    <div className="ob-cell-imp">
      <div
        className="ob-cell-imp-dot"
        style={{
          width: size + 'px', height: size + 'px',
          background: color, boxShadow: glow
        }}
      />
      <div className="ob-cell-imp-num">{value.toFixed(1)}</div>
    </div>
  );
}

function MarkIcon({ item, big }) {
  const cls = big ? 'ob-card-cell-mark' : 'ob-cell-mark';
  if (item.protected || item.pinned) return <span className={`${cls} pin`} title="钉决/保护">★</span>;
  if (item.importance >= 8 || item.highlight) return <span className={`${cls} fresh`} title="重要">✦</span>;
  if (item.feel) return <span className={`${cls} feel`} title="feel">❀</span>;
  return <span className={cls} title="日常">·</span>;
}

// ── 单条行（列表视图） ──
function CellRow({
  item, todayDate,
  selected, isKeyboard, isFlash,
  onOpen, onToggleSelect, onStartTitleEdit, isTitleEditing,
  onSaveTitle, onCancelTitle, anySelected,
}) {
  const t = tier(item);
  const untitled = isUntitled(item.title);
  const tags = item.tags || [];
  const titleInputRef = cuR(null);

  cuE(() => {
    if (isTitleEditing && titleInputRef.current) {
      titleInputRef.current.focus();
      titleInputRef.current.select();
    }
  }, [isTitleEditing]);

  const cls = [
    'ob-cell',
    `is-${t}`,
    selected && 'is-selected',
    isKeyboard && 'is-keyboard',
    isFlash && 'is-flash',
    item.internalized && 'is-internalized',
  ].filter(Boolean).join(' ');

  return (
    <div
      className={cls}
      onClick={(e) => {
        if (e.target.closest('.ob-cell-pick')) return;
        if (anySelected) { onToggleSelect(item.id); return; }
        onOpen(item);
      }}
    >
      <div className="ob-cell-pick" onClick={(e) => { e.stopPropagation(); onToggleSelect(item.id); }}>
        <div className="ob-cell-pick-cb">{selected ? '✓' : ''}</div>
      </div>

      <div><MarkIcon item={item} /></div>

      <div className="ob-cell-main">
        {isTitleEditing ? (
          <input
            ref={titleInputRef}
            className="ob-cell-title-edit"
            defaultValue={untitled ? '' : item.title}
            placeholder="给这一格命名…"
            onClick={(e) => e.stopPropagation()}
            onKeyDown={(e) => {
              if (e.key === 'Enter') { onSaveTitle(item.id, e.target.value); }
              if (e.key === 'Escape') { onCancelTitle(); }
            }}
            onBlur={(e) => onSaveTitle(item.id, e.target.value)}
          />
        ) : (
          <div
            className={`ob-cell-title ${untitled ? 'untitled' : ''}`}
            onDoubleClick={(e) => { e.stopPropagation(); onStartTitleEdit(item.id); }}
            title="双击重命名"
          >
            {untitled ? `《未命名 · 写于 ${relTime(item.date, item.time, todayDate)}》` : item.title}
          </div>
        )}
        <div className="ob-cell-meta">
          {tags.length > 0 ? (
            tags.slice(0, 3).map((tg, i) => (
              <React.Fragment key={tg}>
                {i > 0 && <span className="ob-cell-meta-dot">·</span>}
                <span className="ob-cell-meta-tag">{tg}</span>
              </React.Fragment>
            ))
          ) : null}
          {tags.length > 3 && <span className="ob-cell-meta-dot">+{tags.length - 3}</span>}
          {tags.length > 0 && <span className="ob-cell-meta-dot">·</span>}
          <span>{relTime(item.date, item.time, todayDate)}</span>
        </div>
      </div>

      <div className="ob-cell-sum">
        {(item.body || item.preview || '').slice(0, 80) || '（暂无内容）'}
      </div>

      <ImpDot value={item.importance} />
    </div>
  );
}

// ── 卡片视图 ──
function CardCell({ item, todayDate, selected, isFlash, onOpen, onToggleSelect, anySelected }) {
  const t = tier(item);
  const untitled = isUntitled(item.title);
  const tags = item.tags || [];

  const cls = [
    'ob-card-cell',
    `is-${t}`,
    selected && 'is-selected',
    isFlash && 'is-flash',
    item.internalized && 'is-internalized',
  ].filter(Boolean).join(' ');

  const impPct = (item.importance / 10) * 100;
  const isHi = item.importance >= 8;

  return (
    <article
      className={cls}
      onClick={() => { if (anySelected) onToggleSelect(item.id); else onOpen(item); }}
    >
      {!(item.protected || item.pinned || item.feel) && (
        <div className="ob-card-cell-impband" style={{ height: impPct + '%' }} />
      )}
      <div className="ob-card-cell-hd">
        <MarkIcon item={item} big />
        <span className="ob-card-cell-tags">
          {tags.length > 0 ? tags.slice(0, 2).join(' · ') : '未分类'}
        </span>
        <span className="ob-card-cell-time">{relTime(item.date, item.time, todayDate)}</span>
      </div>
      <div className={`ob-card-cell-title ${untitled ? 'untitled' : ''}`}>
        {untitled ? `《未命名 · 写于 ${relTime(item.date, item.time, todayDate)}》` : item.title}
      </div>
      <div className="ob-card-cell-sum">{(item.body || item.preview || '').slice(0, 200)}</div>
      <div className="ob-card-cell-foot">
        <span>{item.date}</span>
        <span className={`ob-card-cell-imp ${isHi ? 'hi' : ''}`}>{item.importance.toFixed(1)}</span>
      </div>
    </article>
  );
}

// ── 自定义下拉菜单 ──
function PopMenu({ label, value, options, onChange }) {
  const [open, setOpen] = cuS(false);
  const ref = cuR(null);
  cuE(() => {
    if (!open) return;
    const onDoc = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, [open]);
  const current = options.find(o => o.value === value) || options[0];
  return (
    <div className="ob-cells-pop" ref={ref}>
      <button className="ob-cells-pop-btn" onClick={() => setOpen(o => !o)}>
        {current.label}
        <span className="ob-cells-pop-btn-arrow">▾</span>
      </button>
      {open && (
        <div className="ob-cells-pop-menu">
          {options.map(o => (
            <div
              key={o.value}
              className={`ob-cells-pop-item ${o.value === value ? 'on' : ''}`}
              onClick={() => { onChange(o.value); setOpen(false); }}
            >
              <span className="ob-cells-pop-item-check">{o.value === value ? '✓' : ''}</span>
              <span>{o.label}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ── 主视图 ──
function CellsView({ items, todayDate, onOpenItem, onUpdateItem, onCreateItem }) {
  const [query, setQuery] = cuS('');
  const [statusFilter, setStatusFilter] = cuS('all');
  const [tagFilters, setTagFilters] = cuS([]);
  const [showAllTags, setShowAllTags] = cuS(false);
  const [view, setView] = cuS('list');
  const [sort, setSort] = cuS('imp-desc');
  const [group, setGroup] = cuS('status');
  const [collapsed, setCollapsed] = cuS({});
  const [selected, setSelected] = cuS(new Set());
  const [keyboardIdx, setKeyboardIdx] = cuS(-1);
  const [editingTitle, setEditingTitle] = cuS(null);
  const [previewItem, setPreviewItem] = cuS(null);
  const [flashId, setFlashId] = cuS(null);
  const [showKbdHint, setShowKbdHint] = cuS(false);

  // 显示快捷键提示
  cuE(() => {
    const t1 = setTimeout(() => setShowKbdHint(true), 800);
    const t2 = setTimeout(() => setShowKbdHint(false), 5000);
    return () => { clearTimeout(t1); clearTimeout(t2); };
  }, []);

  // 状态筛选
  const statusFilters = cuM(() => {
    const c = (fn) => items.filter(fn).length;
    return [
      { id: 'all', label: '全部', tone: '', count: items.length },
      { id: 'pin', label: '★ 钉决', tone: 'pin', count: c(i => i.protected || i.pinned) },
      { id: 'fresh', label: '✦ 重要', tone: '', count: c(i => i.importance >= 8 || i.highlight) },
      { id: 'feel', label: '❀ Feel', tone: 'feel', count: c(i => i.feel) },
      { id: 'internal', label: '已内化', tone: '', count: c(i => i.internalized) },
      { id: 'cold', label: '待消化', tone: '', count: c(i => i.importance < 2) },
      { id: 'mine', label: '我写的', tone: '', count: c(i => (i.tags || []).includes('亲手写')) },
    ];
  }, [items]);

  // tag 筛选
  const allTags = cuM(() => {
    const counts = {};
    items.forEach(i => (i.tags || []).forEach(t => { counts[t] = (counts[t] || 0) + 1; }));
    return Object.entries(counts)
      .sort((a, b) => b[1] - a[1])
      .map(([t, c]) => ({ tag: t, count: c }));
  }, [items]);

  const visibleTags = showAllTags ? allTags : allTags.slice(0, 8);

  // 过滤 + 排序
  const filtered = cuM(() => {
    let v = items;
    if (statusFilter !== 'all') {
      if (statusFilter === 'pin') v = v.filter(i => i.protected || i.pinned);
      else if (statusFilter === 'fresh') v = v.filter(i => i.importance >= 8 || i.highlight);
      else if (statusFilter === 'feel') v = v.filter(i => i.feel);
      else if (statusFilter === 'internal') v = v.filter(i => i.internalized);
      else if (statusFilter === 'cold') v = v.filter(i => i.importance < 2);
      else if (statusFilter === 'mine') v = v.filter(i => (i.tags || []).includes('亲手写'));
    }
    if (tagFilters.length > 0) {
      v = v.filter(i => tagFilters.every(t => (i.tags || []).includes(t)));
    }
    if (query) {
      const q = query.toLowerCase();
      v = v.filter(i =>
        (i.title + ' ' + i.summary + ' ' + (i.body || '') + ' ' + (i.tags || []).join(' ')).toLowerCase().includes(q)
      );
    }
    v = [...v];
    if (sort === 'imp-desc') v.sort((a, b) => b.importance - a.importance);
    else if (sort === 'imp-asc') v.sort((a, b) => a.importance - b.importance);
    else if (sort === 'time-desc') v.sort((a, b) => (b.date + b.time).localeCompare(a.date + a.time));
    else if (sort === 'time-asc') v.sort((a, b) => (a.date + a.time).localeCompare(b.date + b.time));
    return v;
  }, [items, statusFilter, tagFilters, query, sort]);

  // 分组
  const groups = cuM(() => {
    if (group === 'none' || view === 'grid') {
      return [{ id: 'all', label: '', icon: '', items: filtered }];
    }
    if (group === 'status') {
      const g = {
        pin: [], fresh: [], feel: [], normal: [], cold: [], internalized: [],
      };
      filtered.forEach(i => {
        if (i.internalized) g.internalized.push(i);
        else if (i.protected || i.pinned) g.pin.push(i);
        else if (i.importance >= 8 || i.highlight) g.fresh.push(i);
        else if (i.feel) g.feel.push(i);
        else if (i.importance < 2) g.cold.push(i);
        else g.normal.push(i);
      });
      const out = [
        { id: 'pin', label: '钉决', icon: '★', tone: 'pin', items: g.pin },
        { id: 'fresh', label: '重要 (≥8)', icon: '✦', tone: 'fresh', items: g.fresh },
        { id: 'feel', label: 'Feel', icon: '❀', tone: 'feel', items: g.feel },
        { id: 'normal', label: '日常', icon: '·', tone: '', items: g.normal },
        { id: 'cold', label: '待消化 (<2)', icon: '◌', tone: 'cold', items: g.cold },
        { id: 'internalized', label: '已内化', icon: '◐', tone: '', items: g.internalized },
      ].filter(x => x.items.length > 0);
      return out;
    }
    if (group === 'tag') {
      const buckets = {};
      filtered.forEach(i => {
        const tgs = i.tags && i.tags.length ? i.tags : ['未分类'];
        tgs.forEach(t => {
          if (!buckets[t]) buckets[t] = [];
          buckets[t].push(i);
        });
      });
      return Object.entries(buckets)
        .sort((a, b) => b[1].length - a[1].length)
        .map(([t, its]) => ({ id: 'tag-' + t, label: t, icon: '#', tone: '', items: its }));
    }
    return [{ id: 'all', label: '', icon: '', items: filtered }];
  }, [filtered, group, view]);

  // 扁平化用于键盘导航
  const flatItems = cuM(() => {
    const out = [];
    groups.forEach(g => {
      if (collapsed[g.id]) return;
      g.items.forEach(it => out.push(it));
    });
    return out;
  }, [groups, collapsed]);

  // 切换 tag
  const toggleTag = (t) => {
    setTagFilters(curr => curr.includes(t) ? curr.filter(x => x !== t) : [...curr, t]);
  };

  // 切换选择
  const toggleSelect = (id) => {
    setSelected(curr => {
      const next = new Set(curr);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };
  const clearSelected = () => setSelected(new Set());
  const selectAll = () => setSelected(new Set(flatItems.map(i => i.id)));

  // 标题编辑
  const handleSaveTitle = (id, val) => {
    const v = (val || '').trim();
    if (v) {
      onUpdateItem && onUpdateItem(id, { title: v });
    }
    setEditingTitle(null);
  };

  // 键盘导航
  cuE(() => {
    const onKey = (e) => {
      const tag = (e.target.tagName || '').toLowerCase();
      const isInput = tag === 'input' || tag === 'textarea';
      if (isInput) return;

      if (e.key === '/') {
        e.preventDefault();
        const inp = document.querySelector('.ob-cells-search input');
        if (inp) inp.focus();
        return;
      }
      if (e.key === 'Escape') {
        if (previewItem) { setPreviewItem(null); return; }
        if (editingTitle) { setEditingTitle(null); return; }
        if (selected.size > 0) { clearSelected(); return; }
        if (tagFilters.length > 0 || statusFilter !== 'all' || query) {
          setTagFilters([]); setStatusFilter('all'); setQuery('');
          return;
        }
      }
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setKeyboardIdx(i => Math.min(flatItems.length - 1, (i < 0 ? 0 : i + 1)));
        setPreviewItem(null);
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        setKeyboardIdx(i => Math.max(0, i - 1));
        setPreviewItem(null);
      } else if (e.key === 'Enter' && keyboardIdx >= 0) {
        e.preventDefault();
        onOpenItem(flatItems[keyboardIdx]);
      } else if (e.key === ' ' && keyboardIdx >= 0) {
        e.preventDefault();
        setPreviewItem(prev => prev?.id === flatItems[keyboardIdx].id ? null : flatItems[keyboardIdx]);
      } else if (e.key === 'x' && keyboardIdx >= 0) {
        e.preventDefault();
        toggleSelect(flatItems[keyboardIdx].id);
      } else if ((e.metaKey || e.ctrlKey) && e.key === 'a') {
        e.preventDefault();
        selectAll();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [flatItems, keyboardIdx, previewItem, editingTitle, selected, tagFilters, statusFilter, query]);

  // 滚动键盘焦点到视野
  cuE(() => {
    if (keyboardIdx < 0) return;
    const item = flatItems[keyboardIdx];
    if (!item) return;
    const el = document.querySelector(`[data-cell-id="${item.id}"]`);
    if (el && el.scrollIntoView) {
      const rect = el.getBoundingClientRect();
      if (rect.top < 100 || rect.bottom > window.innerHeight - 60) {
        el.scrollIntoView({ behavior: 'smooth', block: 'center' });
      }
    }
  }, [keyboardIdx, flatItems]);

  // 批量操作
  const bulkAction = (action) => {
    const ids = Array.from(selected);
    if (action === 'pin') ids.forEach(id => onUpdateItem(id, { protected: true, pinned: true }));
    else if (action === 'unpin') ids.forEach(id => onUpdateItem(id, { protected: false, pinned: false }));
    else if (action === 'internal') ids.forEach(id => onUpdateItem(id, { internalized: true }));
    else if (action === 'feel') ids.forEach(id => onUpdateItem(id, { feel: true }));
    else if (action === 'delete') {
      if (confirm(`真的要删除 ${ids.length} 条记忆吗？`)) {
        ids.forEach(id => onUpdateItem(id, { __delete: true }));
      }
    }
    clearSelected();
  };

  // 上下文 + 副标
  const subParts = [];
  subParts.push(`${items.length} 格`);
  const pinN = items.filter(i => i.protected || i.pinned).length;
  if (pinN) subParts.push(`${pinN} 钉决`);
  const feelN = items.filter(i => i.feel).length;
  if (feelN) subParts.push(`${feelN} feel`);
  const coldN = items.filter(i => i.importance < 2).length;
  if (coldN) subParts.push(`${coldN} 待消化`);

  // 新建格按钮文案（在分类筛选时预填）
  const activeCat = tagFilters.length === 1 ? tagFilters[0] : null;
  const newBtnLabel = activeCat ? `+ 新建「${activeCat}」格` : '+ 新建格';
  const handleNew = () => {
    onCreateItem && onCreateItem({ tags: tagFilters });
  };

  return (
    <main className="ob-cells-page">
      {/* 页头 */}
      <header className="ob-cells-hd">
        <div className="ob-cells-titlebox">
          <h1>记忆格</h1>
          <div className="ob-cells-sub">
            每一格都是一个被命名的瞬间 · {subParts.map((p, i) => (
              <React.Fragment key={i}>
                {i > 0 && <span style={{opacity: 0.5}}> · </span>}
                <b>{p}</b>
              </React.Fragment>
            ))}
          </div>
        </div>
        <div className="ob-cells-actions">
          <button className="ob-cells-add" onClick={handleNew}>{newBtnLabel}</button>
        </div>
      </header>

      {/* 工具条 */}
      <div className="ob-cells-bar">
        <div className="ob-cells-search">
          <span style={{ opacity: 0.5 }}>⌕</span>
          <input
            value={query} onChange={(e) => setQuery(e.target.value)}
            placeholder="搜记忆…  按 / 聚焦"
          />
          {query && <button className="ob-cells-search-clear" onClick={() => setQuery('')}>×</button>}
        </div>
        <div className="ob-cells-bar-sep" />
        <span className="ob-cells-bar-label">视图</span>
        <div className="ob-cells-view">
          <button className={`ob-cells-view-btn ${view === 'list' ? 'on' : ''}`} onClick={() => setView('list')}>≡ 列表</button>
          <button className={`ob-cells-view-btn ${view === 'grid' ? 'on' : ''}`} onClick={() => setView('grid')}>▦ 卡片</button>
        </div>
        <div className="ob-cells-bar-sep" />
        <span className="ob-cells-bar-label">分组</span>
        <PopMenu
          value={group}
          onChange={setGroup}
          options={[
            { value: 'status', label: '按状态' },
            { value: 'tag', label: '按分类' },
            { value: 'none', label: '不分组' },
          ]}
        />
        <div className="ob-cells-bar-sep" />
        <span className="ob-cells-bar-label">排序</span>
        <PopMenu
          value={sort}
          onChange={setSort}
          options={[
            { value: 'imp-desc', label: '重要度 ↓' },
            { value: 'imp-asc', label: '重要度 ↑' },
            { value: 'time-desc', label: '时间 · 新→旧' },
            { value: 'time-asc', label: '时间 · 旧→新' },
          ]}
        />
      </div>

      {/* 筛选区：状态行 + 分类行 */}
      <div className="ob-cells-filters">
        <div className="ob-cells-frow">
          <span className="ob-cells-frow-lab">状态</span>
          {statusFilters.map(f => (
            <button
              key={f.id}
              className={`ob-cells-chip ${statusFilter === f.id ? 'on' : ''} ${f.tone ? 'tone-' + f.tone : ''}`}
              onClick={() => setStatusFilter(f.id)}
            >
              <span>{f.label}</span>
              <span className="ob-cells-chip-count">{f.count}</span>
            </button>
          ))}
        </div>
        <div className="ob-cells-frow">
          <span className="ob-cells-frow-lab">分类</span>
          {visibleTags.map(({ tag: tg, count }) => (
            <button
              key={tg}
              className={`ob-cells-chip ${tagFilters.includes(tg) ? 'on' : ''}`}
              onClick={() => toggleTag(tg)}
            >
              <span>{tg}</span>
              <span className="ob-cells-chip-count">{count}</span>
            </button>
          ))}
          {allTags.length > 8 && (
            <button className="ob-cells-frow-more" onClick={() => setShowAllTags(v => !v)}>
              {showAllTags ? '收起' : `+${allTags.length - 8} 更多`}
            </button>
          )}
          {tagFilters.length > 0 && (
            <button className="ob-cells-frow-more" onClick={() => setTagFilters([])} style={{color: 'var(--accent)'}}>
              清空筛选
            </button>
          )}
        </div>
      </div>

      {/* 批量操作条 */}
      {selected.size > 0 && (
        <div className="ob-cells-bulk">
          <span className="ob-cells-bulk-count">已选 {selected.size} 条</span>
          <div className="ob-cells-bulk-sep" />
          <button className="ob-cells-bulk-btn" onClick={() => bulkAction('pin')}>★ 钉决</button>
          <button className="ob-cells-bulk-btn" onClick={() => bulkAction('unpin')}>◯ 取消钉决</button>
          <button className="ob-cells-bulk-btn" onClick={() => bulkAction('feel')}>❀ 标 feel</button>
          <button className="ob-cells-bulk-btn" onClick={() => bulkAction('internal')}>◐ 标内化</button>
          <button className="ob-cells-bulk-btn danger" onClick={() => bulkAction('delete')}>✕ 删除</button>
          <div className="ob-cells-bulk-spacer" />
          <button className="ob-cells-bulk-btn" onClick={selectAll}>全选当前</button>
          <button className="ob-cells-bulk-btn" onClick={clearSelected}>取消</button>
        </div>
      )}

      {/* 主体 */}
      {filtered.length === 0 ? (
        <div className="ob-cells-empty">空白页 · 没有符合条件的记忆</div>
      ) : view === 'list' ? (
        <div className="ob-cells-list">
          {groups.map(g => {
            const isCollapsed = !!collapsed[g.id];
            return (
              <React.Fragment key={g.id}>
                {g.label && (
                  <div
                    className={`ob-cells-group-hd ${isCollapsed ? 'collapsed' : ''}`}
                    onClick={() => setCollapsed(c => ({ ...c, [g.id]: !c[g.id] }))}
                  >
                    <span className="ob-cells-group-hd-arrow">▾</span>
                    <span className={`ob-cells-group-hd-icon ${g.tone || ''}`}>{g.icon}</span>
                    <span className="ob-cells-group-hd-name">{g.label}</span>
                    <span className="ob-cells-group-hd-count">{g.items.length} 条</span>
                    <span className="ob-cells-group-hd-rule" />
                  </div>
                )}
                {!isCollapsed && g.items.map(it => {
                  const idxInFlat = flatItems.findIndex(x => x.id === it.id);
                  return (
                    <div data-cell-id={it.id} key={it.id}>
                      <CellRow
                        item={it}
                        todayDate={todayDate}
                        selected={selected.has(it.id)}
                        isKeyboard={keyboardIdx === idxInFlat}
                        isFlash={flashId === it.id}
                        anySelected={selected.size > 0}
                        onOpen={onOpenItem}
                        onToggleSelect={toggleSelect}
                        onStartTitleEdit={(id) => setEditingTitle(id)}
                        isTitleEditing={editingTitle === it.id}
                        onSaveTitle={handleSaveTitle}
                        onCancelTitle={() => setEditingTitle(null)}
                      />
                    </div>
                  );
                })}
              </React.Fragment>
            );
          })}
        </div>
      ) : (
        <div className="ob-cells-grid">
          {filtered.map(it => (
            <CardCell
              key={it.id}
              item={it}
              todayDate={todayDate}
              selected={selected.has(it.id)}
              isFlash={flashId === it.id}
              anySelected={selected.size > 0}
              onOpen={onOpenItem}
              onToggleSelect={toggleSelect}
            />
          ))}
        </div>
      )}

      {/* 空格预览 */}
      {previewItem && (
        <div className="ob-preview" onClick={(e) => e.stopPropagation()}>
          <div className="ob-preview-hd">
            <b>预览</b>
            <span>·</span>
            <span>{previewItem.date} {previewItem.time}</span>
            <span style={{marginLeft: 'auto'}}>imp {previewItem.importance.toFixed(1)}</span>
          </div>
          <div className="ob-preview-title">
            {isUntitled(previewItem.title) ? '《未命名》' : previewItem.title}
          </div>
          <div className="ob-preview-sum">{previewItem.summary || previewItem.body || '（无内容）'}</div>
          {(previewItem.tags || []).length > 0 && (
            <div className="ob-preview-meta">
              {(previewItem.tags || []).map(t => <span key={t}>#{t}</span>)}
            </div>
          )}
          <div className="ob-preview-foot">
            <kbd>Enter</kbd> 打开完整 · <kbd>Esc</kbd> 关闭 · <kbd>↑↓</kbd> 切换
          </div>
        </div>
      )}

      {/* 键盘提示 */}
      {showKbdHint && selected.size === 0 && (
        <div className="ob-cells-kbd">
          <span><b>↑↓</b> 选行</span>
          <span><b>↵</b> 打开</span>
          <span><b>␣</b> 预览</span>
          <span><b>X</b> 多选</span>
          <span><b>⌘A</b> 全选</span>
          <span><b>/</b> 搜索</span>
          <span><b>⎋</b> 重置</span>
        </div>
      )}
    </main>
  );
}

window.CellsView = CellsView;
window.__cellsHelpers = { isUntitled, relTime };
