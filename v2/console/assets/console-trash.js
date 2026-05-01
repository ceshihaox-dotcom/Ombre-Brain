// console-trash.jsx —— 回收站页面:列出软删除的桶,支持恢复/永久删除

const { useState: ctS, useEffect: ctE } = React;

function TrashPage({ onCountChange }) {
  const [items, setItems] = ctS([]);
  const [loading, setLoading] = ctS(true);
  const [err, setErr] = ctS(null);
  const [busy, setBusy] = ctS({});  // id → 'restoring' | 'purging'

  const fetchTrash = async () => {
    try {
      setErr(null);
      const r = await fetch('/api/trash');
      if (!r.ok) throw new Error('HTTP ' + r.status);
      const d = await r.json();
      setItems(d.trash || []);
      setLoading(false);
      if (onCountChange) onCountChange((d.trash || []).length);
    } catch (e) {
      setErr(e.message || String(e));
      setLoading(false);
    }
  };

  ctE(() => { fetchTrash(); }, []);

  const restore = async (id, name) => {
    setBusy(b => ({ ...b, [id]: 'restoring' }));
    try {
      const r = await fetch(`/api/bucket/${encodeURIComponent(id)}/restore`, { method: 'POST' });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error || ('HTTP ' + r.status));
      // 乐观抹除
      setItems(prev => {
        const next = prev.filter(x => x.id !== id);
        if (onCountChange) onCountChange(next.length);
        return next;
      });
    } catch (e) {
      alert(`恢复「${name}」失败: ${e.message}`);
    } finally {
      setBusy(b => { const c = { ...b }; delete c[id]; return c; });
    }
  };

  const purge = async (id, name) => {
    // 二次确认:输入"删除"两字
    const typed = window.prompt(`永久删除「${name}」?\n\n这次无法恢复。请输入"删除"两字确认:`);
    if (typed !== '删除') {
      if (typed !== null) alert('未输入"删除",已取消');
      return;
    }
    setBusy(b => ({ ...b, [id]: 'purging' }));
    try {
      const r = await fetch(`/api/bucket/${encodeURIComponent(id)}/purge`, { method: 'POST' });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error || ('HTTP ' + r.status));
      setItems(prev => {
        const next = prev.filter(x => x.id !== id);
        if (onCountChange) onCountChange(next.length);
        return next;
      });
    } catch (e) {
      alert(`永久删除「${name}」失败: ${e.message}`);
    } finally {
      setBusy(b => { const c = { ...b }; delete c[id]; return c; });
    }
  };

  const restoreAll = async () => {
    if (!items.length) return;
    if (!window.confirm(`恢复全部 ${items.length} 条?`)) return;
    for (const it of items) {
      try {
        await fetch(`/api/bucket/${encodeURIComponent(it.id)}/restore`, { method: 'POST' });
      } catch (e) { /* ignore */ }
    }
    await fetchTrash();
  };

  const purgeAll = async () => {
    if (!items.length) return;
    const typed = window.prompt(`永久清空回收站(${items.length} 条)?\n\n所有桶将物理删除,无法恢复。请输入"全部删除"四字确认:`);
    if (typed !== '全部删除') {
      if (typed !== null) alert('未输入"全部删除",已取消');
      return;
    }
    for (const it of items) {
      try {
        await fetch(`/api/bucket/${encodeURIComponent(it.id)}/purge`, { method: 'POST' });
      } catch (e) { /* ignore */ }
    }
    await fetchTrash();
  };

  const formatTrashedAt = (s) => {
    if (!s) return '';
    if (window.__obIsoToLocal) {
      const lt = window.__obIsoToLocal(s);
      return `${lt.date} ${lt.time}`;
    }
    return String(s).slice(0, 16).replace('T', ' ');
  };

  return (
    <main className="oc-main">
      <ConsolePageHd
        title="回收站"
        sub={<>软删除的记忆暂存于此 · <b>{items.length}</b> 条 · 可恢复或永久删除</>}
        rightSlot={
          items.length > 0 && (
            <div style={{ display: 'flex', gap: 6 }}>
              <button className="oc-btn oc-btn-ghost" onClick={restoreAll} style={{ fontSize: 11 }}>↻ 全部恢复</button>
              <button className="oc-btn oc-btn-ghost" onClick={purgeAll} style={{ fontSize: 11, color: '#8B4A4A' }}>✕ 永久清空</button>
            </div>
          )
        }
      />

      {loading && <div style={{ padding: 40, textAlign: 'center', color: 'var(--ink-3)' }}>加载中…</div>}
      {err && (
        <div style={{ padding: 14, color: '#8B4A4A', fontSize: 13 }}>
          加载失败: {err} · <a onClick={fetchTrash} style={{ cursor: 'pointer', textDecoration: 'underline' }}>重试</a>
        </div>
      )}
      {!loading && !err && items.length === 0 && (
        <ConsoleCard label="空" sub="回收站是空的">
          <div style={{ padding: '24px 0', textAlign: 'center', color: 'var(--ink-4)', fontStyle: 'italic', fontSize: 13, fontFamily: 'var(--serif)' }}>
            没有被删除的记忆 · 所有删除操作会先进这里
          </div>
        </ConsoleCard>
      )}

      {!loading && !err && items.length > 0 && (
        <ConsoleCard>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {items.map(it => {
              const b = busy[it.id];
              const trashedDisplay = formatTrashedAt(it.trashed_at);
              const summaryText = it.summary || it.content_preview || '(无摘要)';
              return (
                <div
                  key={it.id}
                  style={{
                    padding: '12px 14px',
                    background: 'var(--paper)',
                    border: '0.5px solid var(--line-2)',
                    borderRadius: 8,
                    display: 'grid',
                    gridTemplateColumns: '1fr auto',
                    gap: 12,
                    alignItems: 'center',
                  }}
                >
                  <div style={{ minWidth: 0 }}>
                    <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, flexWrap: 'wrap' }}>
                      <div style={{ fontFamily: 'var(--serif)', fontSize: 14, fontStyle: 'italic', color: 'var(--ink)', fontWeight: 500 }}>
                        {it.name || it.id}
                      </div>
                      {it.noise && (
                        <span style={{
                          fontSize: 9.5, padding: '1px 7px', borderRadius: 999,
                          border: '0.5px solid var(--ink-4)', color: 'var(--ink-4)',
                          fontFamily: 'var(--mono)', letterSpacing: '0.05em',
                          textTransform: 'uppercase',
                        }} title="标记为噪声后被自动归档">⌀ 噪声</span>
                      )}
                      {typeof it.score === 'number' && (
                        <span style={{
                          fontFamily: 'var(--serif)', fontStyle: 'italic',
                          fontSize: 12, color: 'var(--ink-4)',
                          marginLeft: 'auto',
                        }} title="decay 权重(归档时的最终值)">
                          {it.score.toFixed(2)}
                        </span>
                      )}
                    </div>
                    <div style={{ fontSize: 11.5, color: 'var(--ink-3)', marginTop: 4, lineHeight: 1.6, overflow: 'hidden', textOverflow: 'ellipsis', display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical' }}>
                      {summaryText}
                    </div>
                    <div style={{ fontFamily: 'var(--mono)', fontSize: 10.5, color: 'var(--ink-4)', marginTop: 5, letterSpacing: '0.02em' }}>
                      {trashedDisplay && <>删除于 {trashedDisplay} · </>}
                      原 type: {it.original_type || 'dynamic'}
                      {(it.tags || []).filter(t => !String(t).startsWith('__')).length > 0 && (
                        <> · {(it.tags || []).filter(t => !String(t).startsWith('__')).slice(0, 4).join(' · ')}</>
                      )}
                    </div>
                  </div>
                  <div style={{ display: 'flex', gap: 4, flexShrink: 0 }}>
                    <button
                      className="oc-btn oc-btn-ghost"
                      onClick={() => restore(it.id, it.name)}
                      disabled={!!b}
                      style={{ fontSize: 11, padding: '4px 11px', color: 'var(--accent)', borderColor: 'var(--accent)' }}
                      title="恢复到原 type 目录"
                    >{b === 'restoring' ? '⌛' : '↻ 恢复'}</button>
                    <button
                      className="oc-btn oc-btn-ghost"
                      onClick={() => purge(it.id, it.name)}
                      disabled={!!b}
                      style={{ fontSize: 11, padding: '4px 11px', color: '#8B4A4A' }}
                      title="物理删除,不可恢复(需输入'删除'确认)"
                    >{b === 'purging' ? '⌛' : '✕ 永久删除'}</button>
                  </div>
                </div>
              );
            })}
          </div>
        </ConsoleCard>
      )}
    </main>
  );
}

window.TrashPage = TrashPage;
