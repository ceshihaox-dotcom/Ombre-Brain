// theme-system.js — 主题预设 + 自定义色 (全局)
// 在 React 加载之前 IIFE 应用已存主题, 避免闪烁
// 暴露: window.OB_THEME, window.ThemeToggle (React component)

(function () {
  const THEME_STORAGE_KEY = 'ob-theme-v1';

  // 5 个预设主题, 每个含 3 个核心色 (accent / rose / gold)
  const PRESETS = [
    {
      id: 'moonlight-purple',
      name: '月光紫',
      desc: '默认 · 冷紫调, 略带粉气',
      colors: { accent: '#6e4f9a', rose: '#d291b3', gold: '#d4a85f' },
    },
    {
      id: 'sand-gold',
      name: '沙金',
      desc: '温暖大地, 沙漠日落',
      colors: { accent: '#8b6f47', rose: '#c8a785', gold: '#d4a85f' },
    },
    {
      id: 'ink-mono',
      name: '淡墨',
      desc: '黑白灰 · 沉静',
      colors: { accent: '#3a3445', rose: '#7d7a8c', gold: '#5a5565' },
    },
    {
      id: 'cedar-sage',
      name: '雪松',
      desc: '自然鼠尾草, 林间晨光',
      colors: { accent: '#4a7556', rose: '#a8b896', gold: '#9b8b5e' },
    },
    {
      id: 'rose-warm',
      name: '玫瑰灰',
      desc: '柔暖玫瑰, 黄昏微温',
      colors: { accent: '#b06998', rose: '#d291b3', gold: '#c896b3' },
    },
  ];

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

  // 应用主题色到 document.documentElement.style
  // 同时覆盖 v2 主视图 (--accent / --rose / --gold) 和星图视图 (--c-accent / --c-rose / --c-gold)
  function applyTheme(colors) {
    if (!colors) return;
    const root = document.documentElement.style;
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
    if (state.preset === 'custom' && state.custom) return state.custom;
    const p = PRESETS.find(x => x.id === state.preset);
    return p ? p.colors : PRESETS[0].colors;
  }

  // 启动时应用 (在 React 渲染前, 防闪)
  const stored = loadTheme();
  if (stored) applyTheme(getCurrentColors(stored));

  window.OB_THEME = {
    PRESETS,
    applyTheme,
    loadTheme,
    saveTheme,
    getCurrentColors,
  };
})();

// ── React 组件 (要求页面已加载 React) ─────────────────────
(function () {
  if (typeof React === 'undefined') return;
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
                className={`ob-theme-chip ${state.preset === p.id ? 'on' : ''}`}
                onClick={() => choose(p)}
                title={p.desc}
              >
                <span className="ob-theme-chip-dot" style={{ background: p.colors.accent }}/>
                <span>{p.name}</span>
              </button>
            ))}
            <button
              className={`ob-theme-chip ${state.preset === 'custom' ? 'on' : ''}`}
              onClick={() => setCustomOpen(true)}
              title="自由调三色"
            >
              <span
                className="ob-theme-chip-dot"
                style={{ background: 'conic-gradient(from 0deg, #6e4f9a, #d291b3, #d4a85f, #6e4f9a)' }}
              />
              <span>自定义</span>
            </button>
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

  function ThemeCustomModal({ initial, onClose, onApply }) {
    const [colors, setColors] = useState(initial);
    const reset = () => setColors(initial);
    return (
      <div className="ob-theme-modal-mask" onClick={onClose}>
        <div className="ob-theme-modal" onClick={e => e.stopPropagation()}>
          <div className="ob-theme-modal-hd">自定义配色</div>
          <div className="ob-theme-modal-sub">3 个核心色, 实时预览</div>

          {[
            ['accent', '强调色', '主紫色, 按钮 / 链接 / 高亮'],
            ['rose',   '情感色', 'feel 桶 / 温度感'],
            ['gold',   '重要色', '★ 重要 / 永久标记'],
          ].map(([key, label, hint]) => (
            <div key={key} className="ob-theme-modal-row">
              <div className="ob-theme-modal-row-l">
                <div className="ob-theme-modal-lbl">{label}</div>
                <div className="ob-theme-modal-hint">{hint}</div>
              </div>
              <input
                type="color"
                value={colors[key]}
                onChange={e => {
                  const next = { ...colors, [key]: e.target.value };
                  setColors(next);
                  // 实时预览
                  window.OB_THEME.applyTheme(next);
                }}
              />
              <span className="ob-theme-modal-val">{colors[key]}</span>
            </div>
          ))}

          <div className="ob-theme-modal-foot">
            <button className="ob-theme-modal-btn" onClick={() => {
              // 取消时恢复最初值
              window.OB_THEME.applyTheme(initial);
              onClose();
            }}>取消</button>
            <button className="ob-theme-modal-btn ghost" onClick={reset} title="恢复到打开前">重置</button>
            <button className="ob-theme-modal-btn primary" onClick={() => onApply(colors)}>应用</button>
          </div>
        </div>
      </div>
    );
  }

  window.ThemeToggle = ThemeToggle;
  window.ThemeCustomModal = ThemeCustomModal;
})();
