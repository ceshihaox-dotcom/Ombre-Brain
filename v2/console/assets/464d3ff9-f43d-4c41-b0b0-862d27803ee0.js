// import-workbench.jsx —— 导入工作台

const { useState: iwS, useEffect: iwE, useMemo: iwM, useRef: iwR } = React;

function ImportWorkbench() {
  const [batchId, setBatchId] = iwS('b3');
  const [queue, setQueue] = iwS(window.IMPORT_QUEUE);
  const [activeId, setActiveId] = iwS(null);
  const [filter, setFilter] = iwS('pending');  // pending / refined / flagged / all
  const [editing, setEditing] = iwS(null);  // field name being edited
  const [rawOpen, setRawOpen] = iwS(false);
  const [tagInput, setTagInput] = iwS(false);
  const [tagDraft, setTagDraft] = iwS('');
  const [toast, setToast] = iwS(null);
  const [over, setOver] = iwS(false);
  const fileRef = iwR(null);

  const batch = window.IMPORT_BATCHES.find(b => b.id === batchId);
  const batchQueue = queue.filter(q => q.batch === batchId);

  // 派生：过滤
  const filtered = iwM(() => {
    if (filter === 'all') return batchQueue;
    return batchQueue.filter(q => q.status === filter);
  }, [batchQueue, filter]);

  // 进度
  const refinedCount = batchQueue.filter(q => q.status === 'refined').length;
  const totalCount = batchQueue.length;

  // 默认选中第一个 pending
  iwE(() => {
    if (!activeId || !batchQueue.find(q => q.id === activeId)) {
      const first = batchQueue.find(q => q.status === 'pending') || batchQueue[0];
      if (first) setActiveId(first.id);
    }
  }, [batchId, batchQueue]);

  const active = queue.find(q => q.id === activeId);

  const updateActive = (patch) => {
    setQueue(qs => qs.map(q => q.id === activeId ? { ...q, ...patch } : q));
  };

  // 完成精修
  const markRefined = () => {
    if (!active) return;
    const prev = { ...active };
    setQueue(qs => qs.map(q => q.id === activeId ? { ...q, status: 'refined' } : q));
    // 跳到下一条 pending
    const idx = batchQueue.findIndex(q => q.id === activeId);
    const next = batchQueue.slice(idx + 1).find(q => q.status === 'pending')
      || batchQueue.find(q => q.status === 'pending' && q.id !== activeId);
    if (next) setActiveId(next.id);
    setEditing(null);
    setRawOpen(false);
    setToast({
      msg: `已精修 "${prev.title}"`,
      undo: () => {
        setQueue(qs => qs.map(q => q.id === prev.id ? prev : q));
        setActiveId(prev.id);
        setToast(null);
      },
    });
    setTimeout(() => setToast(t => (t && t.msg.includes(prev.title)) ? null : t), 4500);
  };

  // 跳过 / 标记疑问
  const flagItem = () => {
    if (!active) return;
    updateActive({ status: 'flagged' });
    const idx = batchQueue.findIndex(q => q.id === activeId);
    const next = batchQueue.slice(idx + 1).find(q => q.status === 'pending');
    if (next) setActiveId(next.id);
  };

  // 删除
  const deleteItem = () => {
    if (!active || !confirm(`删除 "${active.title}"？此操作不会进入记忆库。`)) return;
    setQueue(qs => qs.filter(q => q.id !== activeId));
    const idx = batchQueue.findIndex(q => q.id === activeId);
    const next = batchQueue[idx + 1] || batchQueue[idx - 1];
    if (next) setActiveId(next.id);
  };

  // tag 操作
  const removeTag = (t) => updateActive({ tags: (active.tags || []).filter(x => x !== t) });
  const addTag = () => {
    const v = tagDraft.trim();
    if (v && !(active.tags || []).includes(v)) {
      updateActive({ tags: [...(active.tags || []), v] });
    }
    setTagDraft('');
    setTagInput(false);
  };

  // ESC 退出编辑
  iwE(() => {
    const onKey = (e) => {
      if (e.key === 'Escape') {
        setEditing(null);
        setTagInput(false);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  // 拖拽
  const onDrop = (e) => {
    e.preventDefault();
    setOver(false);
    const files = Array.from(e.dataTransfer.files || []);
    if (files.length) alert(`收到 ${files.length} 个文件（mock）：会作为新批次解析\n${files.map(f => f.name).join('\n')}`);
  };

  return (
    <>
      {/* 顶部拖拽条 */}
      <div
        className={`imp-drop${over ? ' over' : ''}`}
        onDragOver={(e) => { e.preventDefault(); setOver(true); }}
        onDragLeave={() => setOver(false)}
        onDrop={onDrop}
        onClick={() => fileRef.current?.click()}
      >
        <div className="imp-drop-mark">⌖</div>
        <div className="imp-drop-text">
          <div className="imp-drop-title">拖拽文件到此处或点击 —— 自动解析为新批次</div>
          <div className="imp-drop-hint">CLAUDE JSON · CHATGPT ZIP · DEEPSEEK · MARKDOWN · TXT</div>
        </div>
        <input ref={fileRef} type="file" multiple style={{ display: 'none' }} />
      </div>

      {/* 批次条 */}
      <div className="imp-batchbar">
        <div className="imp-batch-info">
          <div className="imp-batch-name">
            {batch?.name}
            <span className="imp-batch-source">{batch?.source}</span>
          </div>
          <div className="imp-batch-meta">
            <span>导入于 <b>{batch?.importedAt}</b></span>
            <span>·</span>
            <span>原始 <b>{batch?.raw}</b></span>
            <span>·</span>
            <span>脱水后 <b>{totalCount}</b> 条</span>
          </div>
          <div className="imp-batch-note">{batch?.note}</div>
        </div>

        <div className="imp-progress">
          <div className="imp-progress-label">
            <b>{refinedCount} / {totalCount}</b>
            已精修
          </div>
          <div className="imp-progress-ring">
            <svg width="56" height="56">
              <circle cx="28" cy="28" r="24" className="bg" />
              <circle
                cx="28" cy="28" r="24"
                className="fg"
                strokeDasharray={2 * Math.PI * 24}
                strokeDashoffset={2 * Math.PI * 24 * (1 - refinedCount / Math.max(1, totalCount))}
              />
            </svg>
            <div className="imp-progress-num">{Math.round(refinedCount / Math.max(1, totalCount) * 100)}%</div>
          </div>
        </div>

        <div className="imp-batch-switch">
          {window.IMPORT_BATCHES.map(b => (
            <button
              key={b.id}
              className={`imp-batch-pill${b.id === batchId ? ' on' : ''}`}
              onClick={() => setBatchId(b.id)}
              title={b.name}
            >
              {b.source}
              <span style={{ marginLeft: 4, opacity: 0.7 }}>{b.refined}/{b.total}</span>
            </button>
          ))}
        </div>
      </div>

      {/* 三栏 */}
      <div className="imp-shell">

        {/* 左队列 */}
        <aside className="imp-queue">
          <div className="imp-queue-hd">
            <div className="imp-queue-title">队列 · {filtered.length} / {totalCount}</div>
            <div className="imp-queue-filters">
              {[
                ['pending', '待办'],
                ['flagged', '存疑'],
                ['refined', '已精修'],
                ['all', '全部'],
              ].map(([k, label]) => (
                <button
                  key={k}
                  className={`imp-queue-fpill${filter === k ? ' on' : ''}`}
                  onClick={() => setFilter(k)}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>
          <div className="imp-queue-list">
            {filtered.length === 0 && (
              <div style={{ padding: 24, textAlign: 'center', color: 'var(--ink-4)', fontSize: 12, fontStyle: 'italic' }}>
                此分类暂无条目
              </div>
            )}
            {filtered.map(q => (
              <div
                key={q.id}
                className={`imp-q-item ${q.status} ${q.id === activeId ? 'active' : ''}`}
                onClick={() => { setActiveId(q.id); setEditing(null); setRawOpen(false); }}
              >
                <div className="imp-q-status" />
                <div className="imp-q-body">
                  <div className="imp-q-title">{q.title}</div>
                  <div className="imp-q-meta">
                    {q.feel && <span className="imp-q-feel">❀</span>}
                    {q.protected && <span style={{ color: 'var(--accent)' }}>⛨</span>}
                    <span>imp <b>{q.importance}</b></span>
                    <span>· {q.timeHint?.split(' · ')[0]?.slice(5)}</span>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </aside>

        {/* 中间信纸卡 */}
        <main>
          {active ? (
            <article className="imp-paper">
              <div className="imp-paper-meta">
                <span className="imp-paper-id">{active.id.toUpperCase()} · {batch?.source}</span>
                <span>{active.timeHint}</span>
              </div>

              {/* 标题 */}
              <h1
                className={`imp-paper-title${editing === 'title' ? ' editing' : ''}`}
                onClick={() => editing !== 'title' && setEditing('title')}
              >
                {editing === 'title' ? (
                  <input
                    autoFocus
                    value={active.title}
                    onChange={(e) => updateActive({ title: e.target.value })}
                    onBlur={() => setEditing(null)}
                    onKeyDown={(e) => { if (e.key === 'Enter') setEditing(null); }}
                  />
                ) : active.title}
              </h1>

              <div className="imp-paper-when">
                {active.timeHint} · 来自 <b>{batch?.source}</b> · 已脱水 {active.body?.length || 0} 字
              </div>

              {/* AI 建议横幅（拆分/合并） */}
              {active.suggestion && (
                <div className="imp-suggestion" style={{ marginBottom: 32 }}>
                  <div className="imp-suggestion-tag">
                    {active.suggestion === 'split' ? '↯ 建议拆分' : '⚯ 建议合并'}
                  </div>
                  <div className="imp-suggestion-body">{active.suggestionDetail}</div>
                  <div className="imp-suggestion-actions">
                    <button className="imp-sim-act">采纳</button>
                    <button className="imp-sim-act">忽略</button>
                    <button className="imp-sim-act">查看对比</button>
                  </div>
                </div>
              )}

              {/* 摘要 */}
              <div className="imp-field-label">摘要</div>
              <div
                className={`imp-paper-summary${editing === 'summary' ? ' editing' : ''}`}
                onClick={() => editing !== 'summary' && setEditing('summary')}
              >
                {editing === 'summary' ? (
                  <textarea
                    autoFocus
                    value={active.summary}
                    onChange={(e) => updateActive({ summary: e.target.value })}
                    onBlur={() => setEditing(null)}
                  />
                ) : (active.summary || <span style={{ color: 'var(--ink-4)' }}>点击添加摘要…</span>)}
              </div>

              {/* 正文 */}
              <div className="imp-field-label">正文</div>
              <div
                className={`imp-paper-summary${editing === 'body' ? ' editing' : ''}`}
                onClick={() => editing !== 'body' && setEditing('body')}
                style={{ fontSize: 14, fontFamily: 'var(--sans)', lineHeight: 1.8, marginBottom: 24 }}
              >
                {editing === 'body' ? (
                  <textarea
                    autoFocus
                    value={active.body}
                    onChange={(e) => updateActive({ body: e.target.value })}
                    onBlur={() => setEditing(null)}
                    style={{ minHeight: 140 }}
                  />
                ) : (active.body || <span style={{ color: 'var(--ink-4)' }}>点击添加正文…</span>)}
              </div>

              {/* 原文抽屉 */}
              {active.rawSource && (
                <div className={`imp-raw${rawOpen ? ' open' : ''}`}>
                  <div className="imp-raw-trigger" onClick={() => setRawOpen(o => !o)}>
                    <span><span className="imp-raw-arrow">▸</span> &nbsp; 查看原文 <b>·</b> 来源对话片段</span>
                    <span style={{ opacity: 0.6 }}>{active.rawSource.split('\n').length} 行</span>
                  </div>
                  <div className="imp-raw-body">
                    <div className="imp-raw-content">{active.rawSource}</div>
                  </div>
                </div>
              )}

              {/* tags */}
              <div className="imp-field-label">标签</div>
              <div className="imp-paper-tags">
                {(active.tags || []).map(t => {
                  const isFeel = t.startsWith('feel');
                  const isProtect = t === '保护';
                  return (
                    <span
                      key={t}
                      className={`imp-tag-chip${isFeel ? ' feel' : ''}${isProtect ? ' protect' : ''}`}
                      onClick={() => removeTag(t)}
                    >
                      #{t}<span className="imp-tag-x">×</span>
                    </span>
                  );
                })}
                {tagInput ? (
                  <input
                    className="imp-tag-input"
                    autoFocus
                    value={tagDraft}
                    onChange={(e) => setTagDraft(e.target.value)}
                    onBlur={addTag}
                    onKeyDown={(e) => { if (e.key === 'Enter') addTag(); if (e.key === 'Escape') { setTagInput(false); setTagDraft(''); } }}
                    placeholder="新标签…"
                  />
                ) : (
                  <button className="imp-tag-add" onClick={() => setTagInput(true)}>+ 添加</button>
                )}
              </div>

              {/* 属性 */}
              <div className="imp-attrs">
                <div className="imp-attr-row">
                  <div className="imp-attr-key">重要度</div>
                  <div className="imp-imp-bar">
                    <div className="imp-imp-track"
                      onClick={(e) => {
                        const r = e.currentTarget.getBoundingClientRect();
                        const v = Math.round(((e.clientX - r.left) / r.width) * 10);
                        updateActive({ importance: Math.max(1, Math.min(10, v)) });
                      }}
                    >
                      <div className="imp-imp-fill" style={{ width: `${(active.importance || 0) * 10}%` }} />
                    </div>
                    <span className="imp-imp-num">{active.importance}</span>
                  </div>
                </div>
                <div className="imp-attr-row">
                  <div className="imp-attr-key">类型</div>
                  <div style={{ display: 'flex', gap: 6 }}>
                    {[['dynamic', '动态'], ['permanent', '钉决']].map(([k, label]) => (
                      <button
                        key={k}
                        className={`imp-batch-pill${(active.protected ? 'permanent' : 'dynamic') === k ? ' on' : ''}`}
                        onClick={() => updateActive({ protected: k === 'permanent' })}
                      >
                        {k === 'permanent' && '⛨ '}{label}
                      </button>
                    ))}
                  </div>
                </div>
                <div className="imp-attr-row">
                  <div className="imp-attr-key">情感</div>
                  <div className={`imp-toggle feel${active.feel ? ' on' : ''}`} onClick={() => updateActive({ feel: !active.feel })}>
                    <div className="imp-toggle-dot" />
                    <span style={{ fontSize: 12, color: active.feel ? '#b06998' : 'var(--ink-3)', fontFamily: 'var(--mono)' }}>
                      {active.feel ? '❀ feel' : '中性'}
                    </span>
                  </div>
                </div>
                <div className="imp-attr-row">
                  <div className="imp-attr-key">来源</div>
                  <div className="imp-attr-val">{batch?.source} · {batch?.name}</div>
                </div>
              </div>

              {/* 底部动作 */}
              <div className="imp-paper-actions">
                <button className="imp-act imp-act-primary" onClick={markRefined} disabled={active.status === 'refined'}>
                  {active.status === 'refined' ? '已精修' : '✓ 完成精修'}
                </button>
                <button className="imp-act imp-act-skip" onClick={flagItem}>
                  ⚑ 标记存疑
                </button>
                <button className="imp-act" onClick={() => alert('已重新调用 AI 脱水（mock）')}>
                  ↻ 重新脱水
                </button>
                <button className="imp-act" onClick={() => alert('拆分为两条（mock）')}>
                  ↯ 拆分
                </button>
                <button className="imp-act imp-act-danger" style={{ marginLeft: 'auto' }} onClick={deleteItem}>
                  ✕ 不入库
                </button>
              </div>
            </article>
          ) : (
            <div className="imp-paper imp-empty">
              <div className="imp-empty-icon">⌖</div>
              <div className="imp-empty-title">这个批次都精修完了</div>
              <div className="imp-empty-sub">切换批次或上传新对话继续。</div>
            </div>
          )}
        </main>

        {/* 右 AI 边注 */}
        <aside className="imp-aside">
          {active && (
            <>
              <div className="imp-aside-card">
                <div className="imp-aside-title">摘要由来</div>
                <div className="imp-aside-body">{active.aiReasons?.summary || '已精修，保留人工版本。'}</div>
              </div>

              {active.aiReasons?.tags?.length > 0 && (
                <div className="imp-aside-card">
                  <div className="imp-aside-title">标签理由</div>
                  <div className="imp-aside-body">
                    <ul>
                      {active.aiReasons.tags.map((t, i) => <li key={i}>{t}</li>)}
                    </ul>
                  </div>
                </div>
              )}

              {active.aiReasons?.importance && (
                <div className="imp-aside-card">
                  <div className="imp-aside-title">重要度推算</div>
                  <div className="imp-aside-body" style={{ fontFamily: 'var(--mono)', fontSize: 11.5 }}>
                    {active.aiReasons.importance}
                  </div>
                </div>
              )}

              {active.similar?.length > 0 && (
                <div className="imp-aside-card">
                  <div className="imp-aside-title">疑似相似 · {active.similar.length}</div>
                  <div className="imp-aside-body" style={{ marginTop: 4 }}>
                    {active.similar.map((s) => (
                      <div key={s.id} className="imp-sim-item">
                        <div className="imp-sim-hd">
                          <div className="imp-sim-title">{s.title}</div>
                          <div className="imp-sim-score">{Math.round(s.score * 100)}%</div>
                        </div>
                        <div className="imp-sim-hint">{s.hint} · {s.date}</div>
                        <div className="imp-sim-actions">
                          <button className="imp-sim-act">合并</button>
                          <button className="imp-sim-act">查看</button>
                          <button className="imp-sim-act">忽略</button>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              <div className="imp-aside-card" style={{ background: 'var(--bg-2)' }}>
                <div className="imp-aside-title" style={{ color: 'var(--ink-3)' }}>提示</div>
                <div className="imp-aside-body" style={{ fontSize: 12, color: 'var(--ink-3)' }}>
                  点击任意字段进入编辑，<code>Esc</code> 退出。完成精修后该条会自动同步到记忆库（时间线 / 记忆格 / 星图同步出现）。
                </div>
              </div>
            </>
          )}
        </aside>
      </div>

      {/* 撤销 toast */}
      {toast && (
        <div className="imp-toast">
          <span>✓ {toast.msg}</span>
          <button onClick={toast.undo}>撤销</button>
        </div>
      )}
    </>
  );
}

window.ImportWorkbench = ImportWorkbench;
