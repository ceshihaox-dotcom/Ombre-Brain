// console-modal.jsx —— 单条记忆详情 modal(从 cells/c39eadbf 复制),
// 配套 Tag + formatDate 自带,供导入工作台"全库相似 → 查看"复用。

const { useState: cmS, useEffect: cmE } = React;

const CM_TAG_META = {
  '亲手写':    { icon: '✍︎', tone: 'sage' },
  'AI 写入':   { icon: '✦', tone: 'sage' },
  '已内化':    { icon: '◐', tone: 'sage' },
  '保护':      { icon: '⛨', tone: 'amber' },
  '重要':      { icon: '★', tone: 'amber' },
  'feel(柔软)': { icon: '❀', tone: 'rose' }
};

function CmTag({ name }) {
  const m = CM_TAG_META[name] || { icon: '·', tone: 'sage' };
  return (
    <span className={`ob-tag ob-tag-${m.tone}`}>
      <span className="ob-tag-i">{m.icon}</span>
      <span>{name}</span>
    </span>
  );
}

function cmFormatDate(d) {
  if (!d || typeof d !== 'string' || d.length < 10) return { y: '----', m: '--', day: '--', wk: '' };
  const [y, m, day] = d.split('-');
  const dt = new Date(+y, +m - 1, +day);
  const wk = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'][dt.getDay()];
  return { y, m, day, wk, dt };
}

function ConsoleItemModal({ item, allItems, onClose, onNavigate, onUpdate }) {
  const [editing, setEditing] = cmS(false);
  const [draft, setDraft] = cmS(null);

  cmE(() => {
    setEditing(false);
    setDraft(null);
  }, [item?.id]);

  cmE(() => {
    if (!item) return;
    const onKey = (e) => {
      if (e.key === 'Escape') {
        if (editing) { setEditing(false); setDraft(null); return; }
        onClose();
      }
      if (!editing && e.key === 'ArrowLeft' && onNavigate) onNavigate(-1);
      if (!editing && e.key === 'ArrowRight' && onNavigate) onNavigate(1);
      if ((e.metaKey || e.ctrlKey) && e.key === 'e') {
        e.preventDefault();
        if (!editing) startEdit();
      }
      if ((e.metaKey || e.ctrlKey) && e.key === 'Enter' && editing) {
        e.preventDefault();
        saveEdit();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [item, onNavigate, onClose, editing, draft]);

  if (!item) return null;

  const startEdit = () => {
    setDraft({
      title: item.title,
      summary: item.summary || '',
      body: item.body || '',
      importance: item.importance,
      tags: [...(item.tags || [])],
      protected: !!item.protected,
      pinned: !!item.pinned,
      feel: !!item.feel,
      highlight: !!item.highlight,
      internalized: !!item.internalized,
    });
    setEditing(true);
  };

  const saveEdit = () => {
    if (!draft) return;
    if (onUpdate) onUpdate(item.id, draft);
    setEditing(false);
    setDraft(null);
  };

  const cancelEdit = () => {
    setEditing(false);
    setDraft(null);
  };

  const confirmDelete = () => {
    if (!onUpdate) return;
    if (!window.confirm(`确定删除「${item.title || '这条记忆'}」吗?\n该操作不可撤销。`)) return;
    onUpdate(item.id, { __delete: true });
    setEditing(false);
    setDraft(null);
    if (onClose) onClose();
  };

  const toggleField = (key) => {
    if (!onUpdate) return;
    onUpdate(item.id, { [key]: !item[key] });
  };

  const sorted = (allItems && allItems.length > 1) ? [...allItems].sort((a, b) =>
    ((b.date || '') + (b.time || '')).localeCompare((a.date || '') + (a.time || ''))
  ) : [item];
  const idx = sorted.findIndex(i => i.id === item.id);
  const hasPrev = idx > 0;
  const hasNext = idx < sorted.length - 1;

  const f = cmFormatDate(item.date || '');
  const view = editing ? draft : item;
  const isHi = view.importance >= 8 || view.highlight;
  const cells = Array.from({ length: 10 }, (_, i) => i < view.importance);

  const allTagOptions = ['亲手写', 'AI 写入', '已内化', '保护', '重要', 'feel(柔软)', '编程', '工作', '恋爱', '创作', 'AI', '出行', '内心', '日常', '成长'];
  const allDraftTags = Array.from(new Set([...(draft?.tags || []), ...allTagOptions]));

  return (
    <div className="ob-modal-wrap" onClick={editing ? null : onClose}>
      {!editing && onNavigate && allItems && allItems.length > 1 && (
        <button
          className="ob-modal-nav ob-modal-nav-prev"
          onClick={(e) => { e.stopPropagation(); onNavigate(-1); }}
          disabled={!hasPrev}
          title="更新的一条 ←"
        >‹</button>
      )}

      <div className={`ob-modal ${editing ? 'is-editing' : ''}`} onClick={(e) => e.stopPropagation()}>
        <div className="ob-modal-bg" />
        <button className="ob-modal-close" onClick={editing ? cancelEdit : onClose} title={editing ? '取消编辑' : '关闭 (Esc)'}>✕</button>

        <header className="ob-modal-hd">
          <div className="ob-modal-eyebrow">
            <span className="ob-modal-eyebrow-dot" />
            <span>{editing ? '编辑中' : '记忆'} · {(item.id || '').toUpperCase()}</span>
            {allItems && allItems.length > 1 && <>
              <span style={{ opacity: 0.5 }}>/</span>
              <span>{idx + 1} / {sorted.length}</span>
            </>}
            {!editing && isHi && <><span style={{ opacity: 0.5 }}>/</span><span style={{ color: 'var(--accent)' }}>★ 重要</span></>}
            {!editing && view.feel && <><span style={{ opacity: 0.5 }}>/</span><span style={{ color: 'var(--rose-deep)' }}>❀ feel</span></>}
            {!editing && view.protected && <><span style={{ opacity: 0.5 }}>/</span><span>⛨ 已保护</span></>}
            {!editing && view.internalized && <><span style={{ opacity: 0.5 }}>/</span><span>◐ 已内化</span></>}
          </div>

          {editing ? (
            <input
              className="ob-modal-edit-title"
              value={draft.title}
              onChange={(e) => setDraft(d => ({ ...d, title: e.target.value }))}
              placeholder="标题…"
              autoFocus
            />
          ) : (
            <h2 className="ob-modal-title">{view.title}</h2>
          )}

          <div className="ob-modal-sub">
            <span><b>{f.y}-{f.m}-{f.day}</b> · {f.wk}</span>
            <span className="ob-modal-sub-sep">·</span>
            <span style={{ fontFamily: 'var(--mono)' }}>{item.time || '--:--'}</span>
            <span className="ob-modal-sub-sep">·</span>
            {editing ? (
              <span className="ob-modal-imp-bar">
                <span>importance</span>
                <span className="ob-modal-imp-track ob-modal-imp-edit">
                  {cells.map((on, i) => (
                    <button
                      key={i}
                      type="button"
                      className={`ob-modal-imp-cell ${on ? 'ob-modal-imp-cell-on' : ''} ${on && i >= 7 ? 'ob-modal-imp-cell-hi' : ''}`}
                      onClick={() => setDraft(d => ({ ...d, importance: i + 1 }))}
                    />
                  ))}
                </span>
                <b style={{ color: 'var(--ink)', fontWeight: 600 }}>{draft.importance}</b>
              </span>
            ) : (
              <span className="ob-modal-imp-bar">
                <span>importance</span>
                <span className="ob-modal-imp-track">
                  {cells.map((on, i) => (
                    <span
                      key={i}
                      className={`ob-modal-imp-cell ${on ? 'ob-modal-imp-cell-on' : ''} ${on && i >= 7 ? 'ob-modal-imp-cell-hi' : ''}`}
                    />
                  ))}
                </span>
                <b style={{ color: 'var(--ink)', fontWeight: 600 }}>{view.importance}</b>
              </span>
            )}
          </div>
        </header>

        <div className="ob-modal-body">
          {editing ? (
            <textarea
              className="ob-modal-edit-summary"
              value={draft.summary}
              onChange={(e) => setDraft(d => ({ ...d, summary: e.target.value }))}
              placeholder="一句话摘要…"
              rows={2}
            />
          ) : (
            view.summary && <p className="ob-modal-summary">{view.summary}</p>
          )}

          {editing ? (
            <>
              <div className="ob-modal-section">正文</div>
              <textarea
                className="ob-modal-edit-body"
                value={draft.body}
                onChange={(e) => setDraft(d => ({ ...d, body: e.target.value }))}
                placeholder="…慢慢写。留白也可以。"
                rows={8}
              />
            </>
          ) : (view.body && (
            <>
              <div className="ob-modal-section">正文</div>
              <div className="ob-modal-content">{view.body}</div>
            </>
          ))}

          <div className="ob-modal-section">标签</div>
          {editing ? (
            <div className="ob-modal-edit-tags">
              {allDraftTags.map(tg => (
                <button
                  key={tg}
                  type="button"
                  className={`ob-modal-edit-tag ${draft.tags.includes(tg) ? 'on' : ''}`}
                  onClick={() => setDraft(d => ({
                    ...d,
                    tags: d.tags.includes(tg) ? d.tags.filter(x => x !== tg) : [...d.tags, tg]
                  }))}
                >{tg}</button>
              ))}
            </div>
          ) : (
            view.tags && view.tags.length > 0 ? (
              <div className="ob-modal-tags">
                {view.tags.map(t => <CmTag key={t} name={t} />)}
              </div>
            ) : <div className="ob-modal-content" style={{ opacity: 0.5, fontStyle: 'italic' }}>未标分类</div>
          )}

          {editing && (
            <>
              <div className="ob-modal-section">状态</div>
              <div className="ob-modal-edit-flags">
                <label className={`ob-modal-edit-flag ${draft.protected ? 'on' : ''}`}>
                  <input type="checkbox" checked={draft.protected} onChange={(e) => setDraft(d => ({ ...d, protected: e.target.checked, pinned: e.target.checked }))} />
                  <span>⛨ 保护 / 钉决</span>
                </label>
                <label className={`ob-modal-edit-flag ${draft.feel ? 'on' : ''}`}>
                  <input type="checkbox" checked={draft.feel} onChange={(e) => setDraft(d => ({ ...d, feel: e.target.checked }))} />
                  <span>❀ feel</span>
                </label>
                <label className={`ob-modal-edit-flag ${draft.highlight ? 'on' : ''}`}>
                  <input type="checkbox" checked={draft.highlight} onChange={(e) => setDraft(d => ({ ...d, highlight: e.target.checked }))} />
                  <span>★ 标记重要</span>
                </label>
                <label className={`ob-modal-edit-flag ${draft.internalized ? 'on' : ''}`}>
                  <input type="checkbox" checked={draft.internalized} onChange={(e) => setDraft(d => ({ ...d, internalized: e.target.checked }))} />
                  <span>◐ 已内化</span>
                </label>
              </div>
            </>
          )}
        </div>

        <footer className="ob-modal-foot">
          <div className="ob-modal-meta">
            {editing ? (
              <>
                <span className="ob-modal-meta-item">⌘+↵ 保存</span>
                <span style={{ color: 'var(--ink-4)' }}>·</span>
                <span className="ob-modal-meta-item">Esc 取消</span>
              </>
            ) : (
              <>
                <span className="ob-modal-meta-item">⌘+E 编辑</span>
                {onNavigate && allItems && allItems.length > 1 && <>
                  <span style={{ color: 'var(--ink-4)' }}>·</span>
                  <span className="ob-modal-meta-item">← / → 切换</span>
                </>}
                <span style={{ color: 'var(--ink-4)' }}>·</span>
                <span className="ob-modal-meta-item">Esc 关闭</span>
              </>
            )}
          </div>
          <div className="ob-modal-actions">
            {editing ? (
              <>
                {onUpdate && (
                  <>
                    <button className="ob-modal-btn ob-modal-btn-danger" onClick={confirmDelete} title="删除这条记忆">删除</button>
                    <span className="ob-modal-actions-sep" aria-hidden="true" />
                  </>
                )}
                <button className="ob-modal-btn" onClick={cancelEdit}>取消</button>
                <button className="ob-modal-btn ob-modal-btn-primary" onClick={saveEdit}>保存</button>
              </>
            ) : (
              <>
                <button
                  className={`ob-modal-btn ${view.protected ? 'on' : ''}`}
                  onClick={() => toggleField('protected')}
                >⛨ {view.protected ? '已保护' : '保护'}</button>
                <button
                  className={`ob-modal-btn ${view.highlight ? 'on' : ''}`}
                  onClick={() => toggleField('highlight')}
                >★ {view.highlight ? '已标重要' : '标记重要'}</button>
                <button className="ob-modal-btn ob-modal-btn-primary" onClick={startEdit}>编辑</button>
              </>
            )}
          </div>
        </footer>
      </div>

      {!editing && onNavigate && allItems && allItems.length > 1 && (
        <button
          className="ob-modal-nav ob-modal-nav-next"
          onClick={(e) => { e.stopPropagation(); onNavigate(1); }}
          disabled={!hasNext}
          title="更早的一条 →"
        >›</button>
      )}
    </div>
  );
}

window.ConsoleItemModal = ConsoleItemModal;
