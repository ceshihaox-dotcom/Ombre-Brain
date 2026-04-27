// app-v2.jsx —— v2 增强版顶层组合

const { useState: uSA, useEffect: uEA, useMemo: uMA, useRef: uRA } = React;

const TODAY = '2026-04-26';
const NOW = '23:30';

function TopBarV2({ dark, onDark, compact, data }) {
  const stats = data || [];
  return (
    <div className="ob-topbar">
      <div className="ob-brand">
        <span className="ob-brand-mark" />
        <span className="ob-brand-name">Ombre Brain</span>
        {!compact && (
          <div className="ob-brand-stats">
            <span><b>{stats.length}</b> 格</span>
            <span><b>{stats.filter(i=>i.protected).length}</b> 钉决</span>
            <span><b>{stats.filter(i=>i.feel).length}</b> feel</span>
            <span><b>{stats.filter(i=>i.importance>=8||i.highlight).length}</b> 重要</span>
          </div>
        )}
      </div>
      <div className="ob-topbar-actions">
        <div className="ob-search">
          <span style={{ opacity: 0.5 }}>⌕</span>
          <input placeholder="搜索记忆…  /" />
        </div>
        <DarkToggle dark={dark} onChange={onDark} />
      </div>
    </div>
  );
}

function NavBarV2({ active = 'timeline' }) {
  return (
    <nav className="ob-nav">
      <a href="/v2/cells/" className={active === 'cells' ? 'on' : ''}>记忆格 v2</a>
      <a href="/v2/" className={active === 'timeline' ? 'on' : ''}>时间线 v2</a>
      <a href="/v2/network/" className={active === 'network' ? 'on' : ''}>记忆星图</a>
      <a href="/v2/console/#breath">Breath 模拟</a>
      <a href="/v2/console/#config">配置</a>
      <a href="/v2/console/#import">导入</a>
      <a href="#">Breath 模拟</a>
      <a href="#">记忆网络</a>
      <a href="#">配置</a>
      <a href="#">导入</a>
    </nav>
  );
}

function AppV2() {
  const [t, setTweak] = useTweaks(TWEAK_DEFAULTS);
  const [data, setData] = uSA([]);
  const [loading, setLoading] = uSA(true);
  const [loadError, setLoadError] = uSA(null);
  const [query, setQuery] = uSA('');
  const [filters, setFilters] = uSA({ importantOnly: false, feelOnly: false, protectedOnly: false });
  const [openDay, setOpenDay] = uSA(null);
  const [openItem, setOpenItem] = uSA(null);
  const [writeOpen, setWriteOpen] = uSA(false);
  const [dark, setDark] = uSA(t.dark || false);
  const [shortcutsHint, setShortcutsHint] = uSA(false);

  // 应用暗色
  uEA(() => {
    document.documentElement.setAttribute('data-theme', dark ? 'dark' : 'light');
  }, [dark]);

  // 拉真实数据(由 ombre-bridge.js 提供 API helper)
  const refresh = async () => {
    try {
      setLoadError(null);
      const rows = await window.__obFetchBuckets();
      setData(rows);
      setLoading(false);
    } catch (e) {
      console.error('[ombre v2] load failed', e);
      setLoadError(e.message || String(e));
      setLoading(false);
    }
  };
  uEA(() => { refresh(); }, []);

  // 提示快捷键 3 秒
  uEA(() => {
    const tm = setTimeout(() => setShortcutsHint(true), 1200);
    const tm2 = setTimeout(() => setShortcutsHint(false), 5800);
    return () => { clearTimeout(tm); clearTimeout(tm2); };
  }, []);

  const sortedAll = uMA(() =>
    [...data].sort((a, b) => (b.date + b.time).localeCompare(a.date + a.time)),
    [data]
  );

  // 全局快捷键
  uEA(() => {
    const onKey = (e) => {
      const tag = (e.target.tagName || '').toLowerCase();
      const isInput = tag === 'input' || tag === 'textarea';

      if ((e.metaKey || e.ctrlKey) && e.key === 'n') {
        e.preventDefault();
        setOpenItem(null); setOpenDay(null);
        setWriteOpen(true);
        return;
      }
      if (writeOpen) return; // 写入时其他快捷键失效

      if (e.key === '/' && !isInput) {
        e.preventDefault();
        const inp = document.querySelector('.ob-toolbar-search input');
        if (inp) inp.focus();
        return;
      }
      if (isInput) return;

      if (e.key === 'i' || e.key === 'I') {
        setFilters(f => ({ ...f, importantOnly: !f.importantOnly }));
      } else if (e.key === 'f' || e.key === 'F') {
        setFilters(f => ({ ...f, feelOnly: !f.feelOnly }));
      } else if (e.key === 'd' || e.key === 'D') {
        setDark(v => !v);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [writeOpen]);

  const handleNavigate = (delta) => {
    if (!openItem) return;
    const idx = sortedAll.findIndex(i => i.id === openItem.id);
    const next = idx + delta;
    if (next >= 0 && next < sortedAll.length) {
      openItemWithBody(sortedAll[next]);
    }
  };

  const dayItems = openDay ? data.filter(it => it.date === openDay) : [];
  const todayItems = data.filter(it => it.date === TODAY);
  const lastWriteDate = sortedAll[0]?.date;

  const handleSave = async (entry) => {
    try {
      await window.__obCreateBucket(entry);
      setWriteOpen(false);
      await refresh();
      window.scrollTo({ top: 0, behavior: 'smooth' });
    } catch (e) {
      alert('写入失败: ' + e.message);
    }
  };

  // 打开单条 modal — 列表只有 content_preview,这里 lazy-load 完整 content 注入 body
  // 加载期间在 body 显示占位符,避免用户在 body 还没加载完就点 Edit 把空内容存回去
  const openItemWithBody = async (it) => {
    if (it.body || it._bodyLoaded) { setOpenItem(it); return; }
    const loadingItem = { ...it, body: '⌛ 加载完整内容…', _loading: true };
    setOpenItem(loadingItem);
    try {
      const detail = await window.__obFetchBucketDetail(it.id);
      const merged = { ...it, body: detail.content || '', _meta: detail.metadata, _bodyLoaded: true, _loading: false };
      setOpenItem(prev => prev && prev.id === it.id ? merged : prev);
      // 同步到 data 缓存,下次再点不用重拉
      setData(prev => prev.map(x => x.id === it.id ? merged : x));
    } catch (e) {
      console.error('[ombre v2] detail load failed', e);
      setOpenItem(prev => prev && prev.id === it.id ? { ...prev, body: '(加载失败,稍后重试)', _loading: false } : prev);
    }
  };

  const jumpToToday = () => {
    const el = document.querySelector(`[data-screen-label="day-${TODAY}"]`);
    if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };

  const jumpToItem = (it) => {
    const el = document.querySelector(`[data-screen-label="day-${it.date}"]`);
    if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };

  return (
    <div className={`ob-shape-${t.nodeShape || 'circle'}`}>
      <TopBarV2 dark={dark} onDark={(v) => { setDark(v); setTweak('dark', v); }} data={data} />
      <NavBarV2 />
      <main className="ob-page">
        <header className="ob-page-hd">
          <div>
            <h1 className="ob-page-title">{t.headline}</h1>
            <p className="ob-page-sub">{t.subline}</p>
          </div>
          <div className="ob-page-side">
            <div className="ob-page-counter">
              <b>{data.length}</b> 条记忆 · <b>{new Set(data.map(i => i.date)).size}</b> 个时间节点
            </div>
            <button className="ob-add-btn" onClick={() => setWriteOpen(true)}>+ 添加事件</button>
          </div>
        </header>

        {loading && (
          <div style={{padding:'14px 18px',margin:'0 0 16px',background:'rgba(110,79,154,0.08)',border:'1px solid rgba(110,79,154,0.2)',borderRadius:10,color:'#6e4f9a',fontSize:13}}>
            正在加载真实记忆 …
          </div>
        )}
        {loadError && (
          <div style={{padding:'14px 18px',margin:'0 0 16px',background:'rgba(139,74,74,0.08)',border:'1px solid rgba(139,74,74,0.3)',borderRadius:10,color:'#8B4A4A',fontSize:13}}>
            加载失败:{loadError} · <a onClick={refresh} style={{cursor:'pointer',textDecoration:'underline'}}>重试</a>
          </div>
        )}

        <TodayBar
          todayItems={todayItems}
          lastWriteDate={lastWriteDate}
          todayDate={TODAY}
          onWrite={() => setWriteOpen(true)}
          onJumpToday={jumpToToday}
        />

        <div className="ob-toolbar">
          <div className="ob-toolbar-search">
            <span style={{ opacity: 0.5 }}>⌕</span>
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="搜索关键词、人物、地点……  按 / 快速聚焦"
            />
          </div>
          <FilterChipV2
            active={!filters.importantOnly && !filters.feelOnly && !filters.protectedOnly}
            onClick={() => setFilters({ importantOnly: false, feelOnly: false, protectedOnly: false })}
          >全部</FilterChipV2>
          <FilterChipV2 tone="gold" active={filters.importantOnly}
            onClick={() => setFilters(f => ({ ...f, importantOnly: !f.importantOnly }))}
          >★ 重要 (≥8)</FilterChipV2>
          <FilterChipV2 tone="rose" active={filters.feelOnly}
            onClick={() => setFilters(f => ({ ...f, feelOnly: !f.feelOnly }))}
          >❀ feel</FilterChipV2>
          <FilterChipV2 tone="amber" active={filters.protectedOnly}
            onClick={() => setFilters(f => ({ ...f, protectedOnly: !f.protectedOnly }))}
          >⛨ 已保护</FilterChipV2>
        </div>

        <TimelineV2
          items={data}
          query={query}
          filters={filters}
          density={t.density}
          todayDate={TODAY}
          onOpenItem={(it) => openItemWithBody(it)}
          onOpenDay={(d) => setOpenDay(d)}
        />
      </main>

      <MiniTimeline items={data} onJump={jumpToItem} />
      <Fab onClick={() => setWriteOpen(true)} />

      {shortcutsHint && (
        <div className="ob-shortcuts-hint">
          <span><b>/</b>搜索</span>
          <span><b>I</b>重要</span>
          <span><b>F</b>feel</span>
          <span><b>D</b>暗色</span>
          <span><b>⌘N</b>写入</span>
        </div>
      )}

      {openDay && !openItem && (
        <DayDetail
          date={openDay}
          items={dayItems}
          accent={t.accent}
          onClose={() => setOpenDay(null)}
          onOpenItem={(it) => openItemWithBody(it)}
        />
      )}

      {openItem && (
        <ItemModal
          item={openItem}
          allItems={data}
          onClose={() => setOpenItem(null)}
          onNavigate={handleNavigate}
          onOpenItem={(it) => openItemWithBody(it)}
          onUpdate={async (id, patch) => {
            // 先做乐观更新让 UI 立刻有反馈
            setData(prev => prev.map(x => x.id === id ? { ...x, ...patch } : x));
            setOpenItem(prev => prev && prev.id === id ? { ...prev, ...patch } : prev);
            try {
              await window.__obUpdateBucket(id, patch);
              // 刷新拿权威数据
              await refresh();
            } catch (e) {
              alert('保存失败: ' + e.message + '\n(界面已回滚)');
              await refresh();
            }
          }}
        />
      )}

      <WriteDrawer
        open={writeOpen}
        onClose={() => setWriteOpen(false)}
        onSave={handleSave}
        defaultDate={TODAY}
        defaultTime={NOW}
      />

      <TweaksPanel>
        <TweakSection label="主题" />
        <TweakToggle label="暗夜模式 (D)" value={dark} onChange={(v) => setDark(v)} />
        <TweakColor label="强调色（紫）" value={t.accent}
          onChange={(v) => { setTweak('accent', v); document.documentElement.style.setProperty('--accent', v); }} />
        <TweakColor label="情感色（粉）" value={t.feelColor}
          onChange={(v) => { setTweak('feelColor', v); document.documentElement.style.setProperty('--rose', v); document.documentElement.style.setProperty('--rose-deep', v); }} />

        <TweakSection label="时间线" />
        <TweakRadio label="密度" value={t.density}
          options={['compact', 'regular', 'comfy']}
          onChange={(v) => setTweak('density', v)} />
        <TweakRadio label="节点形状" value={t.nodeShape}
          options={['circle', 'square', 'diamond']}
          onChange={(v) => setTweak('nodeShape', v)} />

        <TweakSection label="演示" />
        <TweakButton label="打开写入抽屉 (⌘N)" onClick={() => setWriteOpen(true)}>打开</TweakButton>
        <TweakButton label="打开单条详情" onClick={() => setOpenItem(data.find(i => i.id === 'm11'))}>预览</TweakButton>
        <TweakButton label="打开当日详情" onClick={() => { setOpenItem(null); setOpenDay('2026-04-26'); }}>预览</TweakButton>
      </TweaksPanel>
    </div>
  );
}

if (!window.__OB_NO_AUTO_RENDER) {
  ReactDOM.createRoot(document.getElementById('root')).render(<AppV2 />);
}
