// constellation-app.jsx —— 主应用：编排布局/状态/键盘

const { useState: caS, useEffect: caE, useMemo: caM, useRef: caR } = React;

function ConstellationApp() {
  const [t, setTweak] = useTweaks(window.TWEAK_DEFAULTS);
  const [data, setData] = caS([]);
  const [loading, setLoading] = caS(true);
  const [loadError, setLoadError] = caS(null);
  // 拉真实数据(由 ombre-bridge.js 提供)
  const refresh = caR ? caR(null) : null;
  const refreshFn = async () => {
    try {
      setLoadError(null);
      const rows = await window.__obFetchBuckets();
      setData(rows);
      setLoading(false);
    } catch (e) {
      console.error('[constellation] load failed', e);
      setLoadError(e.message || String(e));
      setLoading(false);
    }
  };
  caE(() => { refreshFn(); }, []);
  const [mode, setMode] = caS('constellation');  // constellation / cluster / time / type
  const [enabledTypes, setEnabledTypes] = caS(new Set(['dynamic', 'permanent', 'feel', 'archived']));
  const [tagFilters, setTagFilters] = caS(new Set());
  const [impMin, setImpMin] = caS(1);
  const [searchQuery, setSearchQuery] = caS('');

  const [hoverId, setHoverId] = caS(null);
  const [selectedId, setSelectedId] = caS(null);
  const [focusedId, setFocusedId] = caS(null);

  const [zoom, setZoom] = caS(1);
  const [pan, setPan] = caS({ x: 0, y: 0 });

  const [timeOpen, setTimeOpen] = caS(false);
  const [timeIdx, setTimeIdx] = caS(0);

  const containerRef = caR(null);
  const [size, setSize] = caS({ width: 1400, height: 800 });

  caE(() => {
    const update = () => {
      if (!containerRef.current) return;
      const r = containerRef.current.getBoundingClientRect();
      setSize({ width: r.width, height: r.height });
    };
    update();
    window.addEventListener('resize', update);
    return () => window.removeEventListener('resize', update);
  }, []);

  // 时间回放过滤：仅显示前 timeIdx+1 条（按时间）
  const sortedAsc = caM(() => [...data].sort((a, b) => (a.date + a.time).localeCompare(b.date + b.time)), [data]);
  caE(() => { setTimeIdx(sortedAsc.length - 1); }, [sortedAsc.length]);

  // 可见 items：tag/imp/type 过滤
  const visibleItems = caM(() => {
    let arr = data;
    if (timeOpen) {
      const allowed = new Set(sortedAsc.slice(0, timeIdx + 1).map(i => i.id));
      arr = arr.filter(i => allowed.has(i.id));
    }
    arr = arr.filter(i => i.importance >= impMin);
    if (tagFilters.size > 0) {
      arr = arr.filter(i => (i.tags || []).some(t => tagFilters.has(t)));
    }
    return arr;
  }, [data, timeOpen, sortedAsc, timeIdx, impMin, tagFilters]);

  // 边
  const links = caM(() => buildLinks(visibleItems), [visibleItems]);

  // 布局（按 mode）
  const layout = caM(() => {
    const nodes = visibleItems.map(i => ({ id: i.id, r: radiusOf(i), importance: i.importance, date: i.date, time: i.time }));
    if (mode === 'time') return timeRingLayout(nodes, size.width, size.height);
    if (mode === 'cluster' || mode === 'type') {
      // 用类型聚类（cluster vs type 区别留给后续）
      const enriched = nodes.map(n => {
        const it = visibleItems.find(i => i.id === n.id);
        return { ...n, feel: it.feel, protected: it.protected, archived: it.archived, highlight: it.highlight };
      });
      return clusterLayout(enriched, size.width, size.height);
    }
    return simulateLayout(nodes, links, size.width, size.height);
  }, [visibleItems, links, size, mode]);

  // toggles
  const toggleType = (k) => setEnabledTypes(s => {
    const n = new Set(s); n.has(k) ? n.delete(k) : n.add(k); return n;
  });
  const toggleTag = (t) => setTagFilters(s => {
    const n = new Set(s); n.has(t) ? n.delete(t) : n.add(t); return n;
  });

  // 选中
  const selectedItem = selectedId ? data.find(i => i.id === selectedId) : null;

  const handleUpdate = async (id, patch) => {
    if (patch.__delete) {
      try {
        const r = await fetch('/api/bucket/' + encodeURIComponent(id) + '/delete', { method: 'POST' });
        if (!r.ok) throw new Error(await r.text());
        setSelectedId(null);
        await refreshFn();
      } catch (e) {
        alert('删除失败: ' + e.message);
      }
      return;
    }
    setData(prev => prev.map(x => x.id === id ? { ...x, ...patch } : x));
    try {
      await window.__obUpdateBucket(id, patch);
      await refreshFn();
    } catch (e) {
      alert('保存失败: ' + e.message + '\n(界面已回滚)');
      await refreshFn();
    }
  };

  const onResetView = () => { setZoom(1); setPan({ x: 0, y: 0 }); };
  const onFocusIsland = (islands) => {
    if (islands.length === 0) return;
    setFocusedId(islands[0].id);
    setSelectedId(islands[0].id);
  };

  // 键盘
  caE(() => {
    const onKey = (e) => {
      if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;
      if (e.key === 'Escape') {
        if (selectedId) setSelectedId(null);
        else if (focusedId) setFocusedId(null);
        else if (searchQuery) setSearchQuery('');
      }
      if (e.key === '/') {
        e.preventDefault();
        document.querySelector('.cs-search input')?.focus();
      }
      if (e.key === '0') onResetView();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [selectedId, focusedId, searchQuery]);

  // 用类型筛选 = enabledTypes（注意：enabledTypes 全开则不筛）
  const filteredTypes = caM(() => {
    if (enabledTypes.size === 4) return null;
    return enabledTypes;
  }, [enabledTypes]);

  // 统计顶栏
  const stats = caM(() => ({
    total: data.length,
    pinned: data.filter(i => i.protected).length,
    feel: data.filter(i => i.feel).length,
    internalized: data.filter(i => (i.tags || []).includes('已内化')).length,
  }), [data]);

  return (
    <div className="cs-root">
      {/* 顶栏：品牌 + 统计 / 搜索 / 暗夜 */}
      <header className="cs-topbar">
        <div className="cs-brand">
          <span className="cs-brand-mark" />
          <span className="cs-brand-name">Ombre Brain</span>
          <div className="cs-brand-stats">
            <span><b>{stats.total}</b> 格</span>
            <span><b>{stats.pinned}</b> 钉决</span>
            <span><b>{stats.feel}</b> feel</span>
            <span><b>{stats.internalized}</b> 已内化</span>
          </div>
        </div>
        <div className="cs-topbar-actions">
          <div className="cs-search">
            <span className="cs-search-icon">⌕</span>
            <input
              type="text"
              placeholder="搜索记忆…  /"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
            />
            {searchQuery && (
              <button className="cs-search-clear" onClick={() => setSearchQuery('')}>✕</button>
            )}
          </div>
          <button className="cs-dark-toggle" title="切换昼夜（星图固定夜幕）">☾</button>
        </div>
      </header>

      {/* 二级导航 tab */}
      <nav className="cs-nav">
        <a href="/v2/cells/">记忆格</a>
        <a href="/v2/">时间线</a>
        <a href="/v2/network/" className="on">记忆星图</a>
        <a href="/v2/console/import/">导入</a>
        <a href="/v2/console/breath/">Breath 模拟</a>
        <a href="/v2/console/config/">配置</a>
        <a href="/v2/console/trash/">回收站</a>
      </nav>

      {/* 页头：标题 + 副标题 + 计数 + 操作 */}
      <header className="cs-page-hd">
        <div className="cs-page-hd-l">
          <h1 className="cs-page-title">记忆星图</h1>
          <p className="cs-page-sub">
            按 tag 共现与时间邻近自动连结 —— 拖拽 pan，滚轮 zoom，按 <kbd>/</kbd> 聚焦搜索，<kbd>0</kbd> 重置视图。
          </p>
        </div>
        <div className="cs-page-hd-r">
          <div className="cs-page-counter">
            <b>{stats.total}</b> 颗星 · <b>{links.length}</b> 条连线
          </div>
        </div>
      </header>

      {/* 主区 */}
      <div className="cs-main" ref={containerRef}>
        <StarCanvas
          items={visibleItems}
          links={links}
          layout={layout}
          width={size.width}
          height={size.height}
          selectedId={selectedId}
          focusId={focusedId}
          hoverId={hoverId}
          searchQuery={searchQuery}
          filteredTypes={filteredTypes}
          showLinks={t.showLinks !== false}
          showLabels={t.showLabels || 'smart'}
          linkOpacity={t.linkOpacity ?? 0.5}
          zoom={zoom}
          setZoom={setZoom}
          pan={pan}
          setPan={setPan}
          now={new Date()}
          onHover={setHoverId}
          onSelect={(id) => setSelectedId(id)}
          onBlur={() => { setSelectedId(null); }}
        />

        <LeftPanel
          items={data}
          links={links}
          layout={layout}
          mode={mode}
          setMode={setMode}
          enabledTypes={enabledTypes}
          toggleType={toggleType}
          tagFilters={tagFilters}
          toggleTag={toggleTag}
          impMin={impMin}
          setImpMin={setImpMin}
          searchQuery={searchQuery}
          onFocusIsland={onFocusIsland}
        />

        <RightDrawer
          item={selectedItem}
          items={data}
          links={links}
          onClose={() => setSelectedId(null)}
          onSelect={(id) => setSelectedId(id)}
          onUpdate={handleUpdate}
          onFocus={setFocusedId}
          focusedId={focusedId}
        />

        {focusedId && (
          <div className="cs-focus-hint">
            <span>聚焦于 <b>{(data.find(i => i.id === focusedId) || {}).title}</b> · 仅显示一跳关联</span>
            <button className="cs-focus-exit" onClick={() => setFocusedId(null)}>✕ 退出</button>
          </div>
        )}

        <BottomBar
          zoom={zoom}
          setZoom={setZoom}
          onReset={onResetView}
          focusedId={focusedId}
          onClearFocus={() => setFocusedId(null)}
          mode={mode}
          setMode={setMode}
          timeOpen={timeOpen}
          setTimeOpen={setTimeOpen}
        />

        {timeOpen && (
          <TimeBar
            items={data}
            value={timeIdx}
            onChange={setTimeIdx}
            rightOpen={!!selectedItem}
            onClose={() => setTimeOpen(false)}
          />
        )}
      </div>

      <TweaksPanel>
        <TweakSection label="星图视觉" />
        <TweakToggle label="显示连线" value={t.showLinks !== false} onChange={(v) => setTweak('showLinks', v)} />
        <TweakSlider label="连线透明度" min={0.1} max={1} step={0.05} value={t.linkOpacity ?? 0.5} onChange={(v) => setTweak('linkOpacity', v)} />
        <TweakRadio label="标签显示" options={[['smart','智能'],['all','全部'],['none','无']]} value={t.showLabels || 'smart'} onChange={(v) => setTweak('showLabels', v)} />
        <TweakSection label="配色" />
        <TweakColor label="主紫 accent" value={t.accent} onChange={(v) => { setTweak('accent', v); document.documentElement.style.setProperty('--c-accent', v); }} />
        <TweakColor label="情感粉 feel" value={t.feelColor} onChange={(v) => { setTweak('feelColor', v); document.documentElement.style.setProperty('--c-rose', v); }} />
        <TweakColor label="永久金 permanent" value={t.goldColor} onChange={(v) => { setTweak('goldColor', v); document.documentElement.style.setProperty('--c-gold', v); }} />
      </TweaksPanel>
    </div>
  );
}

ReactDOM.createRoot(document.getElementById('root')).render(<ConstellationApp />);
