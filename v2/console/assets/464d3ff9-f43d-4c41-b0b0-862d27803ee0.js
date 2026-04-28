// import-workbench.jsx —— 导入工作台 (真实数据接入版)
// 数据流:
//   - 队列:GET /api/import/results → API → mock shape
//   - 选中条目 body/相似:GET /api/bucket/:id (lazy) + GET /api/bucket/:id/similar
//   - 编辑/状态/删除:POST /api/bucket/:id/{update,delete}
//   - 状态(已精修/存疑)用隐藏 tag (__import_refined / __import_flagged) 表达
//   - 上传文件 / 粘贴原文:走 ombre-bridge 的 helper

const { useState: iwS, useEffect: iwE, useMemo: iwM, useRef: iwR, useCallback: iwC } = React;

// 隐藏 tag 前缀 — 不展示给用户
const STATUS_TAG_REFINED = '__import_refined';
const STATUS_TAG_FLAGGED = '__import_flagged';
function statusOf(item) {
  const tags = item.tags || [];
  if (tags.includes(STATUS_TAG_REFINED)) return 'refined';
  if (tags.includes(STATUS_TAG_FLAGGED)) return 'flagged';
  return 'pending';
}
function visibleTags(tags) {
  return (tags || []).filter(t => !String(t).startsWith('__'));
}

// API bucket → 工作台 item shape
function bucketToItem(b) {
  // b 形如 /api/import/results 的元素 + 可选 content/raw_source
  return {
    id: b.id,
    batch: 'recent',  // 单批次视图(workbench 当前默认),后续可拓展真实 batch_id
    status: statusOf(b),
    title: b.name || b.id,
    summary: b.summary || (b.content || '').slice(0, 160),
    body: b.body || b.content || '',
    rawSource: b.raw_source || '',
    tags: b.tags || [],
    importance: b.importance || 5,
    protected: !!(b.protected || b.pinned),
    feel: b.type === 'feel',
    timeHint: (b.event_time || b.created || '').slice(0, 16).replace('T', ' '),
    type: b.type || 'dynamic',
    aiReasons: {},   // 后端没存推理理由,留空 — UI 自动隐藏推理卡片
    similar: [],      // 全库相似,首次激活时按需 fetch
  };
}

// 同批 (frontend) 相似计算:tag 共现 + importance/feel 加权
function sameBatchSimilar(target, queue, topN) {
  if (!target) return [];
  const targetTags = new Set(visibleTags(target.tags));
  const out = [];
  for (const q of queue) {
    if (q.id === target.id) continue;
    const qtags = visibleTags(q.tags);
    const shared = qtags.filter(t => targetTags.has(t));
    if (shared.length === 0) continue;
    let score = shared.length / Math.max(targetTags.size + qtags.length, 1) * 2;
    if (target.feel && q.feel) score += 0.2;
    if ((target.importance || 5) >= 7 && (q.importance || 5) >= 7) score += 0.1;
    out.push({ id: q.id, title: q.title, score: Math.min(1, score), date: q.timeHint?.slice(0, 10) || '', hint: '同批 · 共享 ' + shared.join('/') });
  }
  out.sort((a, b) => b.score - a.score);
  return out.slice(0, topN || 3);
}

function ImportWorkbench() {
  const [queue, setQueue] = iwS([]);
  const [loading, setLoading] = iwS(true);
  const [loadError, setLoadError] = iwS(null);
  const [activeId, setActiveId] = iwS(null);
  const [filter, setFilter] = iwS('pending');
  const [editing, setEditing] = iwS(null);
  const [rawOpen, setRawOpen] = iwS(false);
  const [tagInput, setTagInput] = iwS(false);
  const [tagDraft, setTagDraft] = iwS('');
  const [toast, setToast] = iwS(null);
  const [over, setOver] = iwS(false);
  const fileRef = iwR(null);

  // 上传相关
  const [uploading, setUploading] = iwS(false);
  const [importStatus, setImportStatus] = iwS(null);  // 后端 import_engine 状态
  const [pasteOpen, setPasteOpen] = iwS(false);
  const [pasteText, setPasteText] = iwS('');
  const [pasteName, setPasteName] = iwS('');

  // 全库相似 cache(key=bucket_id)
  const [similarCache, setSimilarCache] = iwS({});
  const [similarLoading, setSimilarLoading] = iwS(false);

  // 全库相似"查看"打开的完整 modal
  const [previewItem, setPreviewItem] = iwS(null);

  // 重新脱水中的 bucket id(避免重复点)
  const [redehydrating, setRedehydrating] = iwS(null);

  // hover 详情卡:hover 相似项时弹出
  const [hoverItem, setHoverItem] = iwS(null);
  const [hoverPos, setHoverPos] = iwS({ x: 0, y: 0 });
  const [hoverDetail, setHoverDetail] = iwS({});  // id → {body, tags, ...}
  const hoverTimerRef = iwR(null);

  // ---------- 拉真实数据 ----------
  const fetchQueue = iwC(async () => {
    try {
      setLoadError(null);
      const rows = await window.__obImportResults(100);
      setQueue(rows.map(bucketToItem));
      setLoading(false);
    } catch (e) {
      console.error('[import-workbench] load failed', e);
      setLoadError(e.message || String(e));
      setLoading(false);
    }
  }, []);

  iwE(() => { fetchQueue(); }, [fetchQueue]);

  // 派生:过滤
  const filtered = iwM(() => {
    if (filter === 'all') return queue;
    return queue.filter(q => q.status === filter);
  }, [queue, filter]);

  // 进度
  const refinedCount = queue.filter(q => q.status === 'refined').length;
  const totalCount = queue.length;

  // 派生 batch(单批次,从 queue 统计反推)
  const batch = iwM(() => ({
    id: 'recent',
    name: '最近导入',
    source: 'Mixed',
    importedAt: queue[0]?.timeHint || '',
    total: totalCount,
    refined: refinedCount,
    raw: '—',
    note: '工作台显示最近 100 条记忆库桶,精修后状态会同步保存。',
  }), [queue, totalCount, refinedCount]);

  // 默认选中第一个 pending
  iwE(() => {
    if (!activeId || !queue.find(q => q.id === activeId)) {
      const first = queue.find(q => q.status === 'pending') || queue[0];
      if (first) setActiveId(first.id);
    }
  }, [queue]);

  const active = queue.find(q => q.id === activeId);

  // 选中后 lazy-load body + 同批相似 + 全库相似
  iwE(() => {
    if (!active) return;
    // body: 只在没加载过且 body 是 preview 时拉
    if (!active._bodyLoaded) {
      window.__obFetchBucketDetail(active.id).then(d => {
        setQueue(qs => qs.map(q => q.id === active.id ? {
          ...q,
          body: d.content || '',
          rawSource: (d.metadata && d.metadata.raw_source) || q.rawSource,
          _bodyLoaded: true,
        } : q));
      }).catch(e => console.warn('detail load fail', e));
    }
    // 全库相似(异步,不阻塞 UI)
    if (!similarCache[active.id]) {
      setSimilarLoading(true);
      window.__obFetchSimilar(active.id, 5).then(sim => {
        setSimilarCache(c => ({ ...c, [active.id]: sim }));
        setSimilarLoading(false);
      }).catch(e => {
        console.warn('similar fetch fail', e);
        setSimilarCache(c => ({ ...c, [active.id]: [] }));
        setSimilarLoading(false);
      });
    }
  }, [activeId]);

  // ---------- 编辑(乐观更新 + 后端同步) ----------
  const updateActive = async (patch) => {
    if (!activeId) return;
    setQueue(qs => qs.map(q => q.id === activeId ? { ...q, ...patch } : q));
    try {
      await window.__obUpdateBucket(activeId, patch);
    } catch (e) {
      alert('保存失败:' + e.message + '\n刷新中...');
      await fetchQueue();
    }
  };

  // ---------- 重新脱水(单条 LLM 重做 name/summary/tags/domain/情感) ----------
  const redehydrateActive = async () => {
    if (!active || redehydrating) return;
    if (!window.confirm(`重新脱水会让 LLM 重新生成「${active.title || '这条'}」的标题、一句话摘要、标签和情感参数。\n正文不变,重要度也保留。继续?`)) return;
    setRedehydrating(active.id);
    setToast({ msg: '正在重新脱水…(等几秒)' });
    try {
      const r = await fetch('/api/bucket/' + encodeURIComponent(active.id) + '/redehydrate', { method: 'POST' });
      const data = await r.json();
      if (!r.ok) {
        // 422 通常是 LLM 输出解析失败 —— 把原文打到 console 方便排查
        if (data.raw_output) {
          console.warn('[redehydrate] LLM 原始输出:', data.raw_output);
        }
        const snippet = data.raw_output ? '\n\nLLM 原文片段(已打到 console):\n' + String(data.raw_output).slice(0, 200) : '';
        throw new Error((data.error || ('HTTP ' + r.status)) + snippet);
      }
      // 把新元数据合到本地 queue,隐藏状态 tag 保留
      setQueue(qs => qs.map(q => q.id === active.id ? {
        ...q,
        title: data.new_meta.name || q.title,
        summary: data.new_meta.summary || q.summary,
        tags: data.new_meta.tags && data.new_meta.tags.length
          ? data.new_meta.tags.concat((q.tags || []).filter(t => String(t).startsWith('__')))
          : q.tags,
      } : q));
      const applied = (data.applied || []).join('/');
      setToast({ msg: `重新脱水完成 · 已更新: ${applied || '无字段'}` });
      setTimeout(() => setToast(null), 3200);
    } catch (e) {
      console.error('[redehydrate] failed', e);
      alert('重新脱水失败:\n' + e.message);  // 用 alert 而不是 toast,因为可能很长
      setToast(null);
    } finally {
      setRedehydrating(null);
    }
  };

  // ---------- 全库相似"查看"→ 打开完整 modal ----------
  // 把后端 detail 重塑成 ItemModal 期望的 mock shape
  const reshapeBucketDetail = (id, detail, fallback) => {
    const meta = (detail && detail.metadata) || {};
    const evt = meta.event_time || meta.created || '';
    const date = evt && evt.length >= 10 ? evt.slice(0, 10) : (fallback?.date || '2026-01-01');
    const time = evt && evt.length >= 16 ? evt.slice(11, 16) : (fallback?.time || '00:00');
    const tags = (meta.tags || []).slice();
    return {
      id,
      date,
      time,
      title: meta.name || fallback?.name || id,
      summary: meta.summary || (detail && detail.content || '').slice(0, 200) || fallback?.summary || '',
      body: (detail && detail.content) || '',
      importance: meta.importance != null ? meta.importance : 5,
      tags,
      protected: !!(meta.protected || meta.pinned),
      feel: meta.type === 'feel',
      highlight: !!(meta.highlight || meta.pinned),
      internalized: !!(meta.internalized || meta.digested),
      artifacts: [],
    };
  };

  const openSimPreview = async (sim) => {
    setPreviewItem({ id: sim.id, title: sim.name || sim.id, summary: sim.summary || '', body: '⌛ 加载完整内容…', importance: 5, tags: [], date: sim.date || '', time: '00:00', _loading: true });
    try {
      const detail = await window.__obFetchBucketDetail(sim.id);
      const shaped = reshapeBucketDetail(sim.id, detail, sim);
      // 防竞态:用户已经切到下一条或关掉了 modal 就别覆盖
      setPreviewItem(prev => (prev && prev.id === sim.id) ? shaped : prev);
    } catch (e) {
      console.warn('preview detail fail', e);
      setPreviewItem(prev => (prev && prev.id === sim.id) ? { ...prev, body: '(加载失败)', _loading: false } : prev);
    }
  };

  // modal 内部保存/删除回调 — 透传到后端 + 同步 similarCache + 队列
  const handlePreviewUpdate = async (id, patch) => {
    if (patch.__delete) {
      // 真实删除 + 关闭 modal + 把这条从所有 similarCache / 队列里抹掉
      setSimilarCache(c => {
        const next = {};
        for (const k of Object.keys(c)) next[k] = (c[k] || []).filter(s => s.id !== id);
        return next;
      });
      setQueue(qs => qs.filter(q => q.id !== id));
      setPreviewItem(null);
      try {
        const r = await fetch('/api/bucket/' + encodeURIComponent(id) + '/delete', { method: 'POST' });
        if (!r.ok) throw new Error(await r.text());
      } catch (e) {
        alert('删除失败:' + e.message + '\n刷新中...');
        await fetchQueue();
      }
      return;
    }
    // 普通更新:乐观刷 modal + similarCache 里的同 id 项(name/summary)
    setPreviewItem(prev => prev && prev.id === id ? { ...prev, ...patch } : prev);
    setSimilarCache(c => {
      const next = {};
      for (const k of Object.keys(c)) {
        next[k] = (c[k] || []).map(s => s.id === id ? {
          ...s,
          name: patch.title != null ? patch.title : s.name,
          summary: patch.summary != null ? patch.summary : s.summary,
        } : s);
      }
      return next;
    });
    // 如果这条同时在工作台队列里(是当前批次刚导入的),也顺手刷
    setQueue(qs => qs.map(q => q.id === id ? { ...q, ...patch } : q));
    try {
      await window.__obUpdateBucket(id, patch);
    } catch (e) {
      alert('保存失败:' + e.message);
    }
  };

  // 完成精修(toggle:再点取消回 pending)
  const markRefined = async () => {
    if (!active) return;
    const prev = { ...active };
    const wasRefined = active.status === 'refined';
    let newTags;
    if (wasRefined) {
      // 取消精修 → 回 pending
      newTags = (active.tags || []).filter(t => t !== STATUS_TAG_REFINED && t !== STATUS_TAG_FLAGGED);
    } else {
      // 标记精修(顺手清掉存疑)
      newTags = [...(active.tags || []).filter(t => t !== STATUS_TAG_FLAGGED && t !== STATUS_TAG_REFINED), STATUS_TAG_REFINED];
    }
    const newStatus = statusOf({ tags: newTags });
    setQueue(qs => qs.map(q => q.id === activeId ? { ...q, tags: newTags, status: newStatus } : q));
    try {
      await window.__obUpdateBucket(activeId, { tags: newTags });
    } catch (e) {
      alert('保存失败:' + e.message);
      await fetchQueue();
      return;
    }
    if (!wasRefined) {
      // 跳到下一条 pending
      const idx = queue.findIndex(q => q.id === activeId);
      const next = queue.slice(idx + 1).find(q => q.status === 'pending')
        || queue.find(q => q.status === 'pending' && q.id !== activeId);
      if (next) setActiveId(next.id);
    }
    setEditing(null);
    setRawOpen(false);
    setToast({
      msg: wasRefined ? `已撤销精修标记 "${prev.title}"` : `已精修 "${prev.title}"`,
      undo: async () => {
        const restored = (prev.tags || []).slice();
        setQueue(qs => qs.map(q => q.id === prev.id ? { ...q, tags: restored, status: statusOf({ tags: restored }) } : q));
        setActiveId(prev.id);
        setToast(null);
        try { await window.__obUpdateBucket(prev.id, { tags: restored }); }
        catch (e) { alert('撤销失败:' + e.message); }
      },
    });
    setTimeout(() => setToast(t => (t && t.msg.includes(prev.title)) ? null : t), 4500);
  };

  // 标记存疑(toggle:再点取消回 pending)
  const flagItem = async () => {
    if (!active) return;
    const wasFlagged = active.status === 'flagged';
    let newTags;
    if (wasFlagged) {
      newTags = (active.tags || []).filter(t => t !== STATUS_TAG_FLAGGED && t !== STATUS_TAG_REFINED);
    } else {
      newTags = [...(active.tags || []).filter(t => t !== STATUS_TAG_REFINED && t !== STATUS_TAG_FLAGGED), STATUS_TAG_FLAGGED];
    }
    const newStatus = statusOf({ tags: newTags });
    setQueue(qs => qs.map(q => q.id === activeId ? { ...q, tags: newTags, status: newStatus } : q));
    try {
      await window.__obUpdateBucket(activeId, { tags: newTags });
    } catch (e) {
      alert('保存失败:' + e.message);
      await fetchQueue();
      return;
    }
    if (!wasFlagged) {
      const idx = queue.findIndex(q => q.id === activeId);
      const next = queue.slice(idx + 1).find(q => q.status === 'pending');
      if (next) setActiveId(next.id);
    }
  };

  // 不入库 — 物理删除
  const deleteItem = async () => {
    if (!active) return;
    if (!confirm(`删除 "${active.title}"?此操作不可撤销,会从记忆库永久移除。`)) return;
    try {
      await window.__obDeleteBucket(activeId);
    } catch (e) {
      alert('删除失败:' + e.message);
      return;
    }
    const idx = queue.findIndex(q => q.id === activeId);
    setQueue(qs => qs.filter(q => q.id !== activeId));
    const remaining = queue.filter(q => q.id !== activeId);
    const next = remaining[idx] || remaining[idx - 1];
    if (next) setActiveId(next.id);
    else setActiveId(null);
  };

  // tag 操作 — 只对可见 tag 操作,不能删隐藏的状态 tag
  const removeTag = (t) => {
    if (String(t).startsWith('__')) return;
    updateActive({ tags: (active.tags || []).filter(x => x !== t) });
  };
  const addTag = () => {
    const v = tagDraft.trim();
    if (v && !v.startsWith('__') && !(active.tags || []).includes(v)) {
      updateActive({ tags: [...(active.tags || []), v] });
    }
    setTagDraft('');
    setTagInput(false);
  };

  // ---------- 上传 ----------
  const handleFiles = async (files) => {
    if (!files || !files.length) return;
    setUploading(true);
    let succeeded = 0;
    for (const f of files) {
      try {
        await window.__obImportFile(f);
        succeeded++;
      } catch (e) {
        alert(`上传 ${f.name} 失败:` + e.message);
      }
    }
    setUploading(false);
    if (succeeded > 0) {
      setToast({ msg: `已开始解析 ${succeeded} 个文件,等几秒会自动刷新` });
      // 后台解析需要时间,延迟拉两次
      setTimeout(fetchQueue, 4000);
      setTimeout(fetchQueue, 12000);
      setTimeout(() => setToast(null), 6000);
    }
  };

  const submitPaste = async () => {
    if (!pasteText.trim()) { alert('请粘贴对话内容'); return; }
    setUploading(true);
    try {
      await window.__obImportPasteText(pasteText, pasteName.trim() || undefined);
      setToast({ msg: '已开始解析粘贴的内容,等几秒会自动刷新' });
      setTimeout(fetchQueue, 4000);
      setTimeout(fetchQueue, 12000);
      setTimeout(() => setToast(null), 6000);
      setPasteText('');
      setPasteName('');
      setPasteOpen(false);
    } catch (e) {
      alert('上传失败:' + e.message);
    }
    setUploading(false);
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
    handleFiles(files);
  };
  const onPickFile = (e) => {
    handleFiles(Array.from(e.target.files || []));
    e.target.value = '';
  };

  // 同批相似(派生,不缓存)
  const sbSimilar = iwM(() => sameBatchSimilar(active, queue, 3), [active, queue]);
  const fullSimilar = active ? (similarCache[active.id] || []) : [];

  // hover 相似项:延迟 200ms 弹出详情卡
  const onSimEnter = (e, simItem, sourceQueue) => {
    if (hoverTimerRef.current) clearTimeout(hoverTimerRef.current);
    const rect = e.currentTarget.getBoundingClientRect();
    hoverTimerRef.current = setTimeout(() => {
      // 同批:从 queue 找完整 item;全库:用 simItem.id 查 hoverDetail/lazy fetch
      const src = sourceQueue ? queue.find(q => q.id === simItem.id) : null;
      if (src) {
        setHoverItem({ ...src, _src: 'batch' });
      } else {
        // 全库相似:先用 simItem 现有信息,异步补 body
        setHoverItem({
          id: simItem.id,
          title: simItem.name,
          summary: simItem.summary || '',
          body: hoverDetail[simItem.id]?.content || '',
          tags: hoverDetail[simItem.id]?.tags || [],
          importance: hoverDetail[simItem.id]?.importance,
          score: simItem.score,
          date: simItem.date,
          type: simItem.type,
          _src: 'global',
          _bodyLoaded: !!hoverDetail[simItem.id],
        });
        if (!hoverDetail[simItem.id]) {
          window.__obFetchBucketDetail(simItem.id).then(d => {
            setHoverDetail(c => ({ ...c, [simItem.id]: { content: d.content, tags: d.metadata?.tags, importance: d.metadata?.importance, type: d.metadata?.type } }));
            // 如果当前还在 hover 这个 item,实时更新
            setHoverItem(prev => (prev && prev.id === simItem.id) ? {
              ...prev, body: d.content || '', tags: d.metadata?.tags || prev.tags,
              importance: d.metadata?.importance ?? prev.importance, _bodyLoaded: true,
            } : prev);
          }).catch(e => console.warn('hover detail fail', e));
        }
      }
      setHoverPos({ x: rect.left, y: rect.top });
    }, 200);
  };
  const onSimLeave = () => {
    if (hoverTimerRef.current) { clearTimeout(hoverTimerRef.current); hoverTimerRef.current = null; }
    setHoverItem(null);
  };

  return (
    <>
      {/* 顶部拖拽 + 粘贴入口 */}
      <div
        className={`imp-drop${over ? ' over' : ''}${uploading ? ' uploading' : ''}`}
        onDragOver={(e) => { e.preventDefault(); setOver(true); }}
        onDragLeave={() => setOver(false)}
        onDrop={onDrop}
        onClick={() => fileRef.current?.click()}
        style={{ cursor: uploading ? 'wait' : 'pointer' }}
      >
        <div className="imp-drop-mark">⌖</div>
        <div className="imp-drop-text">
          <div className="imp-drop-title">
            {uploading ? '正在上传 — AI 解析中…' : '拖拽文件到此处或点击 —— 自动解析'}
          </div>
          <div className="imp-drop-hint">
            CLAUDE JSON · CHATGPT ZIP · DEEPSEEK · MARKDOWN · TXT
            <span style={{ marginLeft: 12 }} onClick={(e) => { e.stopPropagation(); setPasteOpen(o => !o); }}>
              <a style={{ cursor: 'pointer', color: 'var(--accent)' }}>or 粘贴原文 →</a>
            </span>
          </div>
        </div>
        <input ref={fileRef} type="file" multiple style={{ display: 'none' }} onChange={onPickFile} />
      </div>

      {/* 粘贴原文 — 折叠面板 */}
      {pasteOpen && (
        <div style={{
          margin: '0 28px 14px', padding: '14px 18px',
          background: 'var(--paper)', border: '1px solid var(--line)', borderRadius: 10,
          display: 'flex', flexDirection: 'column', gap: 8,
        }} onClick={(e) => e.stopPropagation()}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <span style={{ fontSize: 12, color: 'var(--ink-3)' }}>粘贴原文(任意对话片段 / Markdown / 笔记)</span>
            <input
              value={pasteName}
              onChange={(e) => setPasteName(e.target.value)}
              placeholder="文件名(可选)"
              style={{
                marginLeft: 'auto', flex: '0 1 220px', fontSize: 12,
                padding: '4px 10px', border: '1px solid var(--line)', borderRadius: 6, background: 'var(--paper)', color: 'var(--ink)',
              }}
            />
            <button onClick={() => setPasteOpen(false)} style={{ background: 'transparent', border: 'none', cursor: 'pointer', color: 'var(--ink-3)' }}>✕</button>
          </div>
          <textarea
            value={pasteText}
            onChange={(e) => setPasteText(e.target.value)}
            placeholder="例如:&#10;— 你: ...&#10;— Claude: ...&#10;&#10;直接粘进来,后端会脱水成多条记忆桶。"
            rows={8}
            style={{
              width: '100%', resize: 'vertical', minHeight: 120,
              padding: 10, border: '1px solid var(--line)', borderRadius: 8,
              fontFamily: 'var(--mono)', fontSize: 12, lineHeight: 1.6,
              background: 'var(--paper)', color: 'var(--ink)',
            }}
          />
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
            <button onClick={() => { setPasteText(''); setPasteName(''); }} style={{ padding: '6px 14px', fontSize: 12, background: 'var(--paper-2)', border: '1px solid var(--line)', borderRadius: 6, cursor: 'pointer', color: 'var(--ink-2)' }}>清空</button>
            <button onClick={submitPaste} disabled={uploading || !pasteText.trim()} style={{ padding: '6px 14px', fontSize: 12, background: 'var(--accent)', border: '1px solid var(--accent)', borderRadius: 6, cursor: uploading ? 'wait' : 'pointer', color: '#fff' }}>
              {uploading ? '上传中…' : '开始解析'}
            </button>
          </div>
        </div>
      )}

      {/* loading / 错误 banner */}
      {loading && (
        <div style={{ margin: '0 28px 14px', padding: '12px 18px', background: 'rgba(110,79,154,0.08)', border: '1px solid rgba(110,79,154,0.2)', borderRadius: 10, color: 'var(--accent)', fontSize: 13 }}>
          正在加载工作台数据 …
        </div>
      )}
      {loadError && (
        <div style={{ margin: '0 28px 14px', padding: '12px 18px', background: 'rgba(139,74,74,0.08)', border: '1px solid rgba(139,74,74,0.3)', borderRadius: 10, color: '#8B4A4A', fontSize: 13 }}>
          加载失败:{loadError} · <a onClick={fetchQueue} style={{ cursor: 'pointer', textDecoration: 'underline' }}>重试</a>
        </div>
      )}

      {/* 批次条 */}
      <div className="imp-batchbar">
        <div className="imp-batch-info">
          <div className="imp-batch-name">
            {batch.name}
            <span className="imp-batch-source">{batch.source}</span>
          </div>
          <div className="imp-batch-meta">
            <span>共 <b>{totalCount}</b> 条</span>
            <span>·</span>
            <span>已精修 <b>{refinedCount}</b></span>
            <span>·</span>
            <span>待办 <b>{queue.filter(q => q.status === 'pending').length}</b></span>
            <span>·</span>
            <span>存疑 <b>{queue.filter(q => q.status === 'flagged').length}</b></span>
          </div>
          <div className="imp-batch-note">{batch.note}</div>
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
          <button className="imp-batch-pill on" onClick={fetchQueue} title="刷新工作台">
            ↻ 刷新
          </button>
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
                    {q.timeHint && <span>· {q.timeHint.slice(5, 10)}</span>}
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
                <span className="imp-paper-id">{active.id.slice(0, 12).toUpperCase()}</span>
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
                    onChange={(e) => setQueue(qs => qs.map(q => q.id === activeId ? { ...q, title: e.target.value } : q))}
                    onBlur={() => { updateActive({ title: active.title }); setEditing(null); }}
                    onKeyDown={(e) => { if (e.key === 'Enter') { updateActive({ title: active.title }); setEditing(null); } }}
                  />
                ) : active.title}
              </h1>

              <div className="imp-paper-when">
                {active.timeHint} · 已脱水 {active.body?.length || 0} 字
              </div>

              {/* AI 建议横幅(后端没存,有就显示,没就不渲染 — 留位以待将来) */}
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
                    onChange={(e) => setQueue(qs => qs.map(q => q.id === activeId ? { ...q, summary: e.target.value } : q))}
                    onBlur={() => { updateActive({ summary: active.summary }); setEditing(null); }}
                  />
                ) : (active.summary || <span style={{ color: 'var(--ink-4)' }}>(无摘要,正文首段会作为摘要)</span>)}
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
                    onChange={(e) => setQueue(qs => qs.map(q => q.id === activeId ? { ...q, body: e.target.value } : q))}
                    onBlur={() => { updateActive({ body: active.body }); setEditing(null); }}
                    style={{ minHeight: 140 }}
                  />
                ) : (active.body || <span style={{ color: 'var(--ink-4)' }}>{active._bodyLoaded ? '(正文为空)' : '⌛ 加载中…'}</span>)}
              </div>

              {/* 原文抽屉(只在后端 preserve_raw 留了原文时显示) */}
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
                {visibleTags(active.tags).map(t => {
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
                  <div className="imp-attr-key">事件时间</div>
                  <div style={{ flex: 1, display: 'flex', gap: 6 }}>
                    <input
                      type="date"
                      value={(active.timeHint || '').slice(0, 10)}
                      onChange={(e) => {
                        const dateOnly = e.target.value;  // YYYY-MM-DD
                        const oldTime = (active.timeHint || '').slice(11, 16) || '';
                        const eventTime = dateOnly ? (dateOnly + 'T' + (oldTime || '00:00') + ':00') : '';
                        setQueue(qs => qs.map(q => q.id === activeId ? { ...q, timeHint: dateOnly + (oldTime ? ' ' + oldTime : '') } : q));
                        window.__obUpdateBucket(activeId, { event_time: eventTime || null }).catch(err => alert('保存失败:' + err.message));
                      }}
                      style={{
                        flex: 2, padding: '6px 10px',
                        border: '1px solid var(--line)', borderRadius: 6,
                        background: 'var(--paper)', color: 'var(--ink)',
                        fontFamily: 'inherit', fontSize: 12,
                      }}
                    />
                    <input
                      type="time"
                      value={(active.timeHint || '').slice(11, 16)}
                      onChange={(e) => {
                        const timeOnly = e.target.value;  // HH:MM
                        const dateOnly = (active.timeHint || '').slice(0, 10);
                        if (!dateOnly) return;  // 没日期就先别改时间
                        const eventTime = dateOnly + 'T' + (timeOnly || '00:00') + ':00';
                        setQueue(qs => qs.map(q => q.id === activeId ? { ...q, timeHint: dateOnly + (timeOnly ? ' ' + timeOnly : '') } : q));
                        window.__obUpdateBucket(activeId, { event_time: eventTime }).catch(err => alert('保存失败:' + err.message));
                      }}
                      style={{
                        flex: 1, padding: '6px 10px',
                        border: '1px solid var(--line)', borderRadius: 6,
                        background: 'var(--paper)', color: 'var(--ink)',
                        fontFamily: 'inherit', fontSize: 12,
                      }}
                    />
                  </div>
                </div>
                <div className="imp-attr-row">
                  <div className="imp-attr-key">状态</div>
                  <span className={`imp-status-chip imp-status-${active.status}`}>
                    {active.status === 'refined' && '✓ 已精修'}
                    {active.status === 'pending' && '⌛ 待精修'}
                    {active.status === 'flagged' && '⚑ 存疑'}
                  </span>
                </div>
              </div>

              {/* 底部动作 — 精修/存疑 是 toggle,再点取消 */}
              <div className="imp-paper-actions">
                <button className="imp-act imp-act-primary" onClick={markRefined}>
                  {active.status === 'refined' ? '↺ 取消精修' : '✓ 完成精修'}
                </button>
                <button className="imp-act imp-act-skip" onClick={flagItem}>
                  {active.status === 'flagged' ? '↺ 取消存疑' : '⚑ 标记存疑'}
                </button>
                <button
                  className="imp-act"
                  onClick={redehydrateActive}
                  disabled={redehydrating === active.id}
                  title="LLM 重新生成标题/摘要/标签/情感(正文和重要度保留)"
                >
                  {redehydrating === active.id ? '⌛ 提炼中…' : '↻ 重新脱水'}
                </button>
                <button className="imp-act" onClick={() => alert('拆分暂未实装(需要新 API 拆桶逻辑),下次更新加上')}>
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
              <div className="imp-empty-title">{loading ? '加载中…' : (queue.length === 0 ? '工作台空空如也' : '没有匹配的条目')}</div>
              <div className="imp-empty-sub">{queue.length === 0 ? '上传文件或粘贴对话开始第一次导入。' : '切换筛选或刷新看看。'}</div>
            </div>
          )}
        </main>

        {/* 右 AI 边注 */}
        <aside className="imp-aside">
          {active && (
            <>
              {/* 同批相似(前端基于 tag 共现算) */}
              {sbSimilar.length > 0 && (
                <div className="imp-aside-card">
                  <div className="imp-aside-title">同批相似 · {sbSimilar.length}</div>
                  <div className="imp-aside-body" style={{ marginTop: 4 }}>
                    {sbSimilar.map((s) => (
                      <div
                        key={s.id}
                        className="imp-sim-item"
                        onClick={() => setActiveId(s.id)}
                        onMouseEnter={(e) => onSimEnter(e, s, true)}
                        onMouseLeave={onSimLeave}
                        style={{ cursor: 'pointer' }}
                      >
                        <div className="imp-sim-hd">
                          <div className="imp-sim-title">{s.title}</div>
                          <div className="imp-sim-score">{Math.round(s.score * 100)}%</div>
                        </div>
                        <div className="imp-sim-hint">{s.hint}</div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* 全库相似(后端 embedding) */}
              <div className="imp-aside-card">
                <div className="imp-aside-title">
                  全库相似 {similarLoading && <span style={{ opacity: 0.5, fontSize: 11 }}>· 加载中</span>}
                  {!similarLoading && fullSimilar.length > 0 && <span style={{ opacity: 0.7 }}> · {fullSimilar.length}</span>}
                </div>
                <div className="imp-aside-body" style={{ marginTop: 4 }}>
                  {fullSimilar.length === 0 && !similarLoading && (
                    <div style={{ fontSize: 11, color: 'var(--ink-4)', fontStyle: 'italic' }}>
                      暂无显著相似(可能是 embedding 还没生成,或全库都不相似)
                    </div>
                  )}
                  {fullSimilar.map((s) => (
                    <div
                      key={s.id}
                      className="imp-sim-item"
                      onMouseEnter={(e) => onSimEnter(e, s, false)}
                      onMouseLeave={onSimLeave}
                    >
                      <div className="imp-sim-hd">
                        <div className="imp-sim-title">{s.name}</div>
                        <div className="imp-sim-score">{Math.round(s.score * 100)}%</div>
                      </div>
                      <div className="imp-sim-hint">{s.summary?.slice(0, 60)}…{s.date && ' · ' + s.date}</div>
                      <div className="imp-sim-actions">
                        <button className="imp-sim-act" onClick={() => alert('合并暂未实装,下次更新加上')}>合并</button>
                        <button className="imp-sim-act" onClick={() => openSimPreview(s)}>查看</button>
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              {/* 摘要由来 / 标签理由 / 重要度推算 — 后端没存,留位 */}
              {active.aiReasons?.summary && (
                <div className="imp-aside-card">
                  <div className="imp-aside-title">摘要由来</div>
                  <div className="imp-aside-body">{active.aiReasons.summary}</div>
                </div>
              )}
              {active.aiReasons?.tags?.length > 0 && (
                <div className="imp-aside-card">
                  <div className="imp-aside-title">标签理由</div>
                  <div className="imp-aside-body">
                    <ul>{active.aiReasons.tags.map((t, i) => <li key={i}>{t}</li>)}</ul>
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

              <div className="imp-aside-card" style={{ background: 'var(--bg-2)' }}>
                <div className="imp-aside-title" style={{ color: 'var(--ink-3)' }}>提示</div>
                <div className="imp-aside-body" style={{ fontSize: 12, color: 'var(--ink-3)' }}>
                  点击任意字段进入编辑,<code>Esc</code> 退出。所有改动会自动保存到记忆库 — 时间线 / 记忆格 / 星图都会同步。
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
          {toast.undo && <button onClick={toast.undo}>撤销</button>}
        </div>
      )}

      {/* 相似项 hover 详情卡(浮在左侧朝信纸方向,方便对比) */}
      {hoverItem && (
        <div
          className="imp-hover-card"
          style={{
            // 出现在源条目左边一点,垂直对齐源条目顶部
            // 320px 宽 + 8px 间距 + transform 微调让其不超出视口
            left: Math.max(12, hoverPos.x - 332),
            top: Math.min(hoverPos.y, window.innerHeight - 380),
          }}
        >
          <div className="imp-hover-hd">
            <div className="imp-hover-title">{hoverItem.title}</div>
            {hoverItem.score != null && (
              <div className="imp-hover-score">{Math.round(hoverItem.score * 100)}%</div>
            )}
          </div>
          {hoverItem.summary && (
            <div className="imp-hover-summary">{hoverItem.summary}</div>
          )}
          {hoverItem._src === 'global' && !hoverItem._bodyLoaded ? (
            <div className="imp-hover-body" style={{ fontStyle: 'italic', opacity: 0.6 }}>⌛ 加载完整内容…</div>
          ) : hoverItem.body ? (
            <div className="imp-hover-body">{hoverItem.body}</div>
          ) : null}
          <div className="imp-hover-meta">
            {hoverItem.feel && <span style={{ color: 'var(--rose-deep)' }}>❀ feel</span>}
            {hoverItem.protected && <span style={{ color: 'var(--accent)' }}>⛨ 保护</span>}
            {hoverItem.importance != null && <span>imp <b>{hoverItem.importance}</b>/10</span>}
            {hoverItem.type && hoverItem.type !== 'dynamic' && <span>· {hoverItem.type}</span>}
            {(hoverItem.date || hoverItem.timeHint) && <span>· {hoverItem.date || hoverItem.timeHint}</span>}
          </div>
          {visibleTags(hoverItem.tags).length > 0 && (
            <div className="imp-hover-tags">
              {visibleTags(hoverItem.tags).slice(0, 8).map(t => (
                <span key={t} className="imp-hover-tag">#{t}</span>
              ))}
            </div>
          )}
        </div>
      )}

      {/* 全库相似 → 查看:复用 ItemModal,跟时间线/记忆格里同款 */}
      {previewItem && window.ConsoleItemModal && React.createElement(window.ConsoleItemModal, {
        item: previewItem,
        allItems: [previewItem],
        onClose: () => setPreviewItem(null),
        onUpdate: handlePreviewUpdate,
      })}
    </>
  );
}

window.ImportWorkbench = ImportWorkbench;
