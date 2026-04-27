// console-shared.jsx —— 共享顶栏 / nav / 页头（对齐时间线 v2）

const { useState: csS, useEffect: csE, useMemo: csM, useRef: csR } = React;

// ── 顶栏 ──
function ConsoleTopBar({ stats, dark, onDark, search, setSearch }) {
  return (
    <div className="ob-topbar">
      <div className="ob-brand">
        <span className="ob-brand-mark" />
        <span className="ob-brand-name">Ombre Brain</span>
        <div className="ob-brand-stats">
          <span><b>{stats.total}</b> 格</span>
          <span><b>{stats.pinned}</b> 钉决</span>
          <span><b>{stats.feel}</b> feel</span>
          <span><b>{stats.internalized}</b> 已内化</span>
        </div>
      </div>
      <div className="ob-topbar-actions">
        <div className="ob-search">
          <span style={{ opacity: 0.5 }}>⌕</span>
          <input
            placeholder="搜索记忆…  /"
            value={search || ''}
            onChange={(e) => setSearch && setSearch(e.target.value)}
          />
        </div>
        <button
          className={`ob-dark-btn${dark ? ' on' : ''}`}
          onClick={() => onDark && onDark(!dark)}
          title="切换暗夜模式"
        >
          {dark ? '☀' : '☾'}
        </button>
      </div>
    </div>
  );
}

// ── 二级导航 tab ──
function ConsoleNav({ active }) {
  // 网络 tab 已被独立 constellation 取代,这里不再展示
  const tabs = [
    { id: 'cells',     label: '记忆格 v2',  href: '/v2/cells/' },
    { id: 'timeline',  label: '时间线 v2',  href: '/v2/' },
    { id: 'star',      label: '记忆星图',   href: '/v2/network/' },
    { id: 'breath',    label: 'Breath 模拟', href: '#breath' },
    { id: 'config',    label: '配置',       href: '#config' },
    { id: 'import',    label: '导入',       href: '#import' },
  ];
  return (
    <nav className="ob-nav">
      {tabs.map(t => (
        <a
          key={t.id}
          href={t.href}
          className={active === t.id ? 'on' : ''}
        >
          {t.label}
        </a>
      ))}
    </nav>
  );
}

// ── 页头：标题 + 副标题 + 右侧操作 ──
function ConsolePageHd({ icon, title, sub, rightSlot }) {
  return (
    <header className="ob-page-hd">
      <div>
        <h1 className="ob-page-title">{title}</h1>
        {sub && <p className="ob-page-sub">{sub}</p>}
      </div>
      {rightSlot && <div className="ob-page-side">{rightSlot}</div>}
    </header>
  );
}

// ── 卡片 / 区块：模仿时间线"内容卡" ──
function ConsoleCard({ label, sub, children, foot, accent }) {
  return (
    <section className="oc-card" style={accent ? { '--oc-accent': accent } : {}}>
      {(label || sub) && (
        <div className="oc-card-hd">
          {label && <h3 className="oc-card-title">{label}</h3>}
          {sub && <div className="oc-card-sub">{sub}</div>}
        </div>
      )}
      <div className="oc-card-body">{children}</div>
      {foot && <div className="oc-card-foot">{foot}</div>}
    </section>
  );
}

// ── 标签 chip ──
function ConsoleChip({ on, onClick, color = 'ink', children, ...rest }) {
  const cls = ['ob-chip'];
  if (on) cls.push('ob-chip-on', `ob-chip-${color}`);
  return (
    <button className={cls.join(' ')} onClick={onClick} {...rest}>
      {children}
    </button>
  );
}

// ── 计算共享 stats ──
function computeStats(data) {
  return {
    total: data.length,
    pinned: data.filter(i => i.protected).length,
    feel: data.filter(i => i.feel).length,
    important: data.filter(i => i.importance >= 8 || i.highlight).length,
    internalized: data.filter(i => (i.tags || []).includes('已内化')).length,
  };
}

// 暴露给其他 babel 文件
Object.assign(window, {
  ConsoleTopBar,
  ConsoleNav,
  ConsolePageHd,
  ConsoleCard,
  ConsoleChip,
  computeStats,
});
