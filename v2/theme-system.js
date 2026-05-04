// theme-system.js — 主题预设 + 自定义色 (全局)
// 在 React 加载之前 IIFE 应用已存主题, 避免闪烁
// 暴露: window.OB_THEME, window.ThemeToggle (React component)

(function () {
  const THEME_STORAGE_KEY = 'ob-theme-v1';

  // 5 个预设主题
  // 核心 3 色 (accent / rose / gold) + 可选 3 色 (bg / paper / ink)
  // 留 bg/paper/ink 为 null = 用 CSS 默认值 (用户找到满意配色后再补)
  const PRESETS = [
    {
      id: 'moonlight-purple',
      name: '月光紫',
      desc: '默认 · 冷紫调, 略带粉气',
      colors: { accent: '#6e4f9a', rose: '#d291b3', gold: '#d4a85f', bg: null, paper: null, ink: null },
    },
    {
      id: 'sand-gold',
      name: '沙金',
      desc: '温暖大地, 沙漠日落',
      colors: { accent: '#8b6f47', rose: '#c8a785', gold: '#d4a85f', bg: null, paper: null, ink: null },
    },
    {
      id: 'ink-mono',
      name: '淡墨',
      desc: '黑白灰 · 沉静',
      colors: { accent: '#3a3445', rose: '#7d7a8c', gold: '#5a5565', bg: null, paper: null, ink: null },
    },
    {
      id: 'cedar-sage',
      name: '雪松',
      desc: '自然鼠尾草, 林间晨光',
      colors: { accent: '#4a7556', rose: '#a8b896', gold: '#9b8b5e', bg: null, paper: null, ink: null },
    },
    {
      id: 'rose-warm',
      name: '玫瑰灰',
      desc: '柔暖玫瑰, 黄昏微温',
      colors: { accent: '#b06998', rose: '#d291b3', gold: '#c896b3', bg: null, paper: null, ink: null },
    },
  ];

  // 默认 (CSS 已定义) 的 5 个底层色 — modal 打开时用作 fallback
  const FALLBACK = {
    accent: '#6e4f9a',
    rose:   '#d291b3',
    gold:   '#d4a85f',
    bg:     '#f4f3f7',   // 雾白带紫
    paper:  '#ffffff',
    ink:    '#1a1922',   // 近黑墨紫
  };

  function _hexToRgba(hex, alpha) {
    const m = String(hex || '').replace('#', '');
    if (m.length !== 6) return `rgba(110, 79, 154, ${alpha})`;
    const r = parseInt(m.substring(0, 2), 16);
    const g = parseInt(m.substring(2, 4), 16);
    const b = parseInt(m.substring(4, 6), 16);
    return `rgba(${r}, ${g}, ${b}, ${alpha})`;
  }
  function _shift(hex, delta) {
    const m = String(hex || '').replace('#', '');
    if (m.length !== 6) return hex;
    const clamp = (v) => Math.max(0, Math.min(255, v));
    const r = clamp(parseInt(m.substring(0, 2), 16) + delta);
    const g = clamp(parseInt(m.substring(2, 4), 16) + delta);
    const b = clamp(parseInt(m.substring(4, 6), 16) + delta);
    const hex2 = (n) => n.toString(16).padStart(2, '0');
    return `#${hex2(r)}${hex2(g)}${hex2(b)}`;
  }

  // 应用主题色
  // null/undefined 字段不动 (保留 CSS 默认)
  function applyTheme(colors) {
    if (!colors) return;
    const root = document.documentElement.style;
    // 强调色三色组
    if (colors.accent) {
      root.setProperty('--accent', colors.accent);
      root.setProperty('--c-accent', colors.accent);
      root.setProperty('--accent-2', _shift(colors.accent, 30));
      root.setProperty('--c-accent-2', _shift(colors.accent, 30));
      root.setProperty('--accent-3', _hexToRgba(colors.accent, 0.10));
    }
    if (colors.rose) {
      root.setProperty('--rose', colors.rose);
      root.setProperty('--c-rose', colors.rose);
      root.setProperty('--rose-deep', _shift(colors.rose, -30));
    }
    if (colors.gold) {
      root.setProperty('--gold', colors.gold);
      root.setProperty('--c-gold', colors.gold);
      root.setProperty('--gold-soft', _shift(colors.gold, 40));
    }
    // 底层 3 色 (用户后面想完全自定义就解锁)
    if (colors.bg) {
      root.setProperty('--bg', colors.bg);
      root.setProperty('--bg-2', _shift(colors.bg, -8));
    }
    if (colors.paper) {
      root.setProperty('--paper', colors.paper);
      root.setProperty('--paper-2', _shift(colors.paper, -8));
    }
    if (colors.ink) {
      root.setProperty('--ink', colors.ink);
      root.setProperty('--ink-2', _shift(colors.ink, 30));
      root.setProperty('--ink-3', _shift(colors.ink, 80));
      root.setProperty('--ink-4', _shift(colors.ink, 140));
    }
  }

  function loadTheme() {
    try {
      const raw = localStorage.getItem(THEME_STORAGE_KEY);
      if (!raw) return null;
      return JSON.parse(raw);
    } catch (_) { return null; }
  }
  function saveTheme(state) {
    try {
      localStorage.setItem(THEME_STORAGE_KEY, JSON.stringify(state));
    } catch (_) {}
  }

  function getCurrentColors(state) {
    if (!state) return PRESETS[0].colors;
    if (state.preset === 'custom' && state.custom) {
      // 合并 fallback 让 modal 总能显示有效值
      return { ...FALLBACK, ...state.custom };
    }
    const p = PRESETS.find(x => x.id === state.preset);
    if (!p) return { ...FALLBACK };
    // 预设的 null 字段用 fallback
    return Object.fromEntries(
      Object.entries({ ...FALLBACK, ...p.colors }).map(([k, v]) => [k, v == null ? FALLBACK[k] : v])
    );
  }

  // 启动应用 (防 React 渲染前闪)
  const stored = loadTheme();
  if (stored) {
    if (stored.preset === 'custom' && stored.custom) applyTheme(stored.custom);
    else {
      const p = PRESETS.find(x => x.id === stored.preset);
      if (p) applyTheme(p.colors);
    }
  }

  window.OB_THEME = {
    PRESETS,
    FALLBACK,
    applyTheme,
    loadTheme,
    saveTheme,
    getCurrentColors,
  };
})();

// ── React 组件 ─────────────────────────────────────────────
(function () {
  if (typeof React === 'undefined' || typeof ReactDOM === 'undefined') return;
  const { useState } = React;

  function ThemeToggle() {
    const [open, setOpen] = useState(false);
    const [state, setState] = useState(() => window.OB_THEME.loadTheme() || { preset: 'moonlight-purple' });
    const [customOpen, setCustomOpen] = useState(false);

    const choose = (preset) => {
      const next = { preset: preset.id };
      window.OB_THEME.applyTheme(preset.colors);
      window.OB_THEME.saveTheme(next);
      setState(next);
      setOpen(false);
    };
    const applyCustom = (custom) => {
      const next = { preset: 'custom', custom };
      window.OB_THEME.applyTheme(custom);
      window.OB_THEME.saveTheme(next);
      setState(next);
      setCustomOpen(false);
      setOpen(false);
    };

    return (
      <div className="ob-theme-toggle-wrap">
        <button
          className="ob-theme-btn"
          onClick={() => setOpen(o => !o)}
          title="切换主题色"
        >
          <span className="ob-theme-btn-mark"/>
        </button>
        {open && (
          <div className="ob-theme-panel">
            {window.OB_THEME.PRESETS.map(p => (
              <button
                key={p.id}
                type="button"
                aria-label={p.name}
                title={p.name}
                className={`ob-theme-swatch ${state.preset === p.id ? 'on' : ''}`}
                style={{ background: p.colors.accent }}
                onClick={() => choose(p)}
              />
            ))}
            <button
              type="button"
              aria-label="自定义"
              title="自定义"
              className={`ob-theme-swatch custom ${state.preset === 'custom' ? 'on' : ''}`}
              style={{ background: 'conic-gradient(from 0deg, #6e4f9a, #d291b3, #d4a85f, #6e4f9a)' }}
              onClick={() => setCustomOpen(true)}
            />
          </div>
        )}
        {customOpen && (
          <ThemeCustomModal
            initial={window.OB_THEME.getCurrentColors(state)}
            onClose={() => setCustomOpen(false)}
            onApply={applyCustom}
          />
        )}
      </div>
    );
  }

  // ── 自定义 Modal — 用 createPortal 挂到 body, 避免父级 transform 影响定位
  function ThemeCustomModal({ initial, onClose, onApply }) {
    const [colors, setColors] = useState(initial);
    const reset = () => {
      setColors(initial);
      window.OB_THEME.applyTheme(initial);
    };

    const ROWS = [
      ['accent', '强调色', '主紫色 · 按钮 / 链接 / 重要 chip'],
      ['rose',   '情感色', 'feel 桶 / 温度感'],
      ['gold',   '重要色', '★ 重要 / 永久标记'],
      ['bg',     '页面底色', '页面背景 (淡紫灰)'],
      ['paper',  '卡片色',   '记忆卡片 / 模态框纸面'],
      ['ink',    '文本色',   '主文字深色 (近黑墨紫)'],
    ];

    const modalEl = (
      <div className="ob-theme-modal-mask" onClick={() => {
        window.OB_THEME.applyTheme(initial);
        onClose();
      }}>
        <div className="ob-theme-modal" onClick={e => e.stopPropagation()}>
          <div className="ob-theme-modal-hd">自定义配色</div>
          <div className="ob-theme-modal-sub">6 色 · 实时预览 · 取消恢复</div>

          {ROWS.map(([key, label, hint]) => (
            <div key={key} className="ob-theme-modal-row">
              <div className="ob-theme-modal-row-l">
                <div className="ob-theme-modal-lbl">{label}</div>
                <div className="ob-theme-modal-hint">{hint}</div>
              </div>
              <input
                type="color"
                value={colors[key] || window.OB_THEME.FALLBACK[key]}
                onChange={e => {
                  const next = { ...colors, [key]: e.target.value };
                  setColors(next);
                  window.OB_THEME.applyTheme(next);
                }}
              />
              <span className="ob-theme-modal-val">{colors[key] || window.OB_THEME.FALLBACK[key]}</span>
            </div>
          ))}

          <div className="ob-theme-modal-foot">
            <button className="ob-theme-modal-btn" onClick={() => {
              window.OB_THEME.applyTheme(initial);
              onClose();
            }}>取消</button>
            <button className="ob-theme-modal-btn ghost" onClick={reset} title="恢复到打开前">重置</button>
            <button className="ob-theme-modal-btn primary" onClick={() => onApply(colors)}>应用</button>
          </div>
        </div>
      </div>
    );

    // Portal 到 body, 避免被 parent 的 transform/overflow 影响
    return ReactDOM.createPortal(modalEl, document.body);
  }

  window.ThemeToggle = ThemeToggle;
  window.ThemeCustomModal = ThemeCustomModal;
})();
