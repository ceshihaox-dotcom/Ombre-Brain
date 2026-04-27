// console-app.jsx —— 控制台主入口(hash 路由) — 真实数据接入版

const { useState: cAS, useEffect: cAE, useMemo: cAM } = React;

// network tab 已下线 — 用独立 constellation(/v2/network/)取代
const ROUTES = {
  '#breath': 'breath',
  '#config': 'config',
  '#import': 'import',
};

function ConsoleApp() {
  const [t, setTweak] = useTweaks(window.TWEAK_DEFAULTS);
  const [route, setRoute] = cAS(ROUTES[window.location.hash] || 'breath');
  const [search, setSearch] = cAS('');
  const [dark, setDark] = cAS(t.dark || false);
  // 真实数据
  const [data, setData] = cAS([]);
  const [loading, setLoading] = cAS(true);
  const [loadError, setLoadError] = cAS(null);

  cAE(() => {
    const onHash = () => {
      const r = ROUTES[window.location.hash];
      // 用户点了已下线的 #network → 跳到独立星图
      if (window.location.hash === '#network') {
        window.location.href = '/v2/network/';
        return;
      }
      setRoute(r || 'breath');
    };
    window.addEventListener('hashchange', onHash);
    if (!window.location.hash) window.location.hash = 'breath';
    return () => window.removeEventListener('hashchange', onHash);
  }, []);

  cAE(() => {
    document.documentElement.setAttribute('data-theme', dark ? 'dark' : 'light');
    setTweak('dark', dark);
  }, [dark]);

  // 拉真实数据
  const refresh = async () => {
    try {
      setLoadError(null);
      const rows = await window.__obFetchBuckets();
      setData(rows);
      window.MEMORY_DATA = rows;  // 给 BreathPage / NetworkPage(已废) 等组件用
      setLoading(false);
    } catch (e) {
      console.error('[console] load failed', e);
      setLoadError(e.message || String(e));
      setLoading(false);
    }
  };
  cAE(() => { refresh(); }, []);

  const stats = cAM(() => computeStats(data), [data]);

  return (
    <div>
      <ConsoleTopBar
        stats={stats}
        dark={dark}
        onDark={setDark}
        search={search}
        setSearch={setSearch}
      />
      <ConsoleNav active={route} />

      {loading && (
        <div style={{margin:'18px 28px 0',padding:'14px 18px',background:'rgba(110,79,154,0.08)',border:'1px solid rgba(110,79,154,0.2)',borderRadius:10,color:'#6e4f9a',fontSize:13}}>
          正在加载真实记忆 …
        </div>
      )}
      {loadError && (
        <div style={{margin:'18px 28px 0',padding:'14px 18px',background:'rgba(139,74,74,0.08)',border:'1px solid rgba(139,74,74,0.3)',borderRadius:10,color:'#8B4A4A',fontSize:13}}>
          加载失败:{loadError} · <a onClick={refresh} style={{cursor:'pointer',textDecoration:'underline'}}>重试</a>
        </div>
      )}

      {route === 'breath' && <BreathPage items={data} />}
      {route === 'config' && <ConfigPage />}
      {route === 'import' && <ImportWorkbench />}

      <TweaksPanel>
        <TweakSection label="控制台" />
        <TweakToggle label="暗夜模式" value={dark} onChange={setDark} />
      </TweaksPanel>
    </div>
  );
}

ReactDOM.createRoot(document.getElementById('root')).render(<ConsoleApp />);
