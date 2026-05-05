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
      // 多档透明度 (供光晕 / 阴影用), CSS 用 var(--accent-a15) 替代硬编码 rgba
      root.setProperty('--accent-a06', _hexToRgba(colors.accent, 0.06));
      root.setProperty('--accent-a08', _hexToRgba(colors.accent, 0.08));
      root.setProperty('--accent-a10', _hexToRgba(colors.accent, 0.10));
      root.setProperty('--accent-a15', _hexToRgba(colors.accent, 0.15));
      root.setProperty('--accent-a20', _hexToRgba(colors.accent, 0.20));
      root.setProperty('--accent-a25', _hexToRgba(colors.accent, 0.25));
      root.setProperty('--accent-a30', _hexToRgba(colors.accent, 0.30));
      root.setProperty('--accent-a40', _hexToRgba(colors.accent, 0.40));
      root.setProperty('--accent-a45', _hexToRgba(colors.accent, 0.45));
      root.setProperty('--accent-a55', _hexToRgba(colors.accent, 0.55));
      root.setProperty('--accent-a60', _hexToRgba(colors.accent, 0.60));
    }
    if (colors.rose) {
      root.setProperty('--rose', colors.rose);
      root.setProperty('--c-rose', colors.rose);
      root.setProperty('--rose-deep', _shift(colors.rose, -30));
      root.setProperty('--rose-a08', _hexToRgba(colors.rose, 0.08));
      root.setProperty('--rose-a10', _hexToRgba(colors.rose, 0.10));
      root.setProperty('--rose-a12', _hexToRgba(colors.rose, 0.12));
      root.setProperty('--rose-a18', _hexToRgba(colors.rose, 0.18));
      root.setProperty('--rose-a25', _hexToRgba(colors.rose, 0.25));
      root.setProperty('--rose-a28', _hexToRgba(colors.rose, 0.28));
      root.setProperty('--rose-a30', _hexToRgba(colors.rose, 0.30));
      root.setProperty('--rose-a45', _hexToRgba(colors.rose, 0.45));
      root.setProperty('--rose-a55', _hexToRgba(colors.rose, 0.55));
      root.setProperty('--rose-a80', _hexToRgba(colors.rose, 0.80));
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
  // 先跑一遍 FALLBACK, 让 --accent-aXX / --rose-aXX 派生变量在所有情况下都有值
  applyTheme(FALLBACK);
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
  const { useState, useRef, useEffect } = React;

  // ── 颜色换算 helpers ──
  function hexToRgb(hex) {
    const m = String(hex || '').replace('#', '');
    if (m.length !== 6) return { r: 0, g: 0, b: 0 };
    return {
      r: parseInt(m.slice(0, 2), 16),
      g: parseInt(m.slice(2, 4), 16),
      b: parseInt(m.slice(4, 6), 16),
    };
  }
  function rgbToHex({ r, g, b }) {
    const h = (n) => Math.max(0, Math.min(255, Math.round(n))).toString(16).padStart(2, '0');
    return '#' + h(r) + h(g) + h(b);
  }
  function rgbToHsv({ r, g, b }) {
    r /= 255; g /= 255; b /= 255;
    const max = Math.max(r, g, b), min = Math.min(r, g, b);
    const d = max - min;
    let h = 0;
    if (d !== 0) {
      if (max === r) h = ((g - b) / d) % 6;
      else if (max === g) h = (b - r) / d + 2;
      else h = (r - g) / d + 4;
      h *= 60;
      if (h < 0) h += 360;
    }
    return { h, s: max === 0 ? 0 : d / max, v: max };
  }
  function hsvToRgb({ h, s, v }) {
    const c = v * s;
    const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
    const m = v - c;
    let r = 0, g = 0, b = 0;
    if (h < 60)       { r = c; g = x; }
    else if (h < 120) { r = x; g = c; }
    else if (h < 180) { g = c; b = x; }
    else if (h < 240) { g = x; b = c; }
    else if (h < 300) { r = x; b = c; }
    else              { r = c; b = x; }
    return { r: (r + m) * 255, g: (g + m) * 255, b: (b + m) * 255 };
  }

  // ── 内联 HSV 色板 (替代浏览器原生 input[type=color]) ──
  function InlineColorPicker({ value, onChange }) {
    const [hsv, setHsv] = useState(() => rgbToHsv(hexToRgb(value)));
    const [hexInput, setHexInput] = useState(() => (value || '#000000').toUpperCase());
    const areaRef = useRef(null);
    const hueRef = useRef(null);

    // 外部值变化 (重置 / 切换 row) 时同步内部状态
    useEffect(() => {
      const v = (value || '#000000').toUpperCase();
      setHexInput(v);
      const next = rgbToHsv(hexToRgb(v));
      // 保留 hue 当 s=0 时 (避免转换丢色相)
      setHsv(prev => (next.s === 0 ? { ...next, h: prev.h } : next));
    }, [value]);

    const emit = (newHsv) => {
      setHsv(newHsv);
      const rgb = hsvToRgb(newHsv);
      const hex = rgbToHex(rgb).toUpperCase();
      setHexInput(hex);
      onChange(hex);
    };

    const handleArea = (e) => {
      const rect = areaRef.current.getBoundingClientRect();
      const x = Math.max(0, Math.min(rect.width, e.clientX - rect.left));
      const y = Math.max(0, Math.min(rect.height, e.clientY - rect.top));
      emit({ h: hsv.h, s: x / rect.width, v: 1 - y / rect.height });
    };
    const handleHue = (e) => {
      const rect = hueRef.current.getBoundingClientRect();
      const x = Math.max(0, Math.min(rect.width, e.clientX - rect.left));
      emit({ ...hsv, h: (x / rect.width) * 360 });
    };
    const drag = (handler) => (e) => {
      e.preventDefault();
      handler(e);
      const move = (ev) => handler(ev);
      const up = () => {
        document.removeEventListener('pointermove', move);
        document.removeEventListener('pointerup', up);
      };
      document.addEventListener('pointermove', move);
      document.addEventListener('pointerup', up);
    };

    const onHexBlur = () => {
      let v = hexInput.trim();
      if (!v.startsWith('#')) v = '#' + v;
      if (/^#[0-9a-fA-F]{6}$/.test(v)) {
        const up = v.toUpperCase();
        setHexInput(up);
        const newHsv = rgbToHsv(hexToRgb(up));
        setHsv(prev => newHsv.s === 0 ? { ...newHsv, h: prev.h } : newHsv);
        onChange(up);
      } else {
        // 输入非法回滚
        setHexInput((value || '#000000').toUpperCase());
      }
    };

    const hueColor = `hsl(${hsv.h}, 100%, 50%)`;
    return (
      <div className="ob-cp-drawer">
        <div
          ref={areaRef}
          className="ob-cp-area"
          style={{ background: `linear-gradient(to top, #000, transparent), linear-gradient(to right, #fff, ${hueColor})` }}
          onPointerDown={drag(handleArea)}
        >
          <div
            className="ob-cp-area-thumb"
            style={{ left: `${hsv.s * 100}%`, top: `${(1 - hsv.v) * 100}%` }}
          />
        </div>
        <div
          ref={hueRef}
          className="ob-cp-hue"
          onPointerDown={drag(handleHue)}
        >
          <div className="ob-cp-hue-thumb" style={{ left: `${(hsv.h / 360) * 100}%` }} />
        </div>
        <div className="ob-cp-inputs">
          <div className="ob-cp-preview" style={{ background: rgbToHex(hsvToRgb(hsv)) }} />
          <input
            type="text"
            className="ob-cp-hex"
            value={hexInput}
            maxLength={7}
            onChange={e => setHexInput(e.target.value)}
            onBlur={onHexBlur}
            onKeyDown={e => { if (e.key === 'Enter') e.target.blur(); }}
          />
        </div>
      </div>
    );
  }

  const CUSTOM_ROWS = [
    ['accent', '强调色', '主紫色 · 按钮 / 链接 / 重要 chip'],
    ['rose',   '情感色', 'feel 桶 / 温度感'],
    ['gold',   '重要色', '★ 重要 / 永久标记'],
    ['bg',     '页面底色', '页面背景 (淡紫灰)'],
    ['paper',  '卡片色',   '记忆卡片 / 模态框纸面'],
    ['ink',    '文本色',   '主文字深色 (近黑墨紫)'],
  ];

  function ThemeToggle() {
    const [open, setOpen] = useState(false);
    const [state, setState] = useState(() => window.OB_THEME.loadTheme() || { preset: 'moonlight-purple' });
    const [customOpen, setCustomOpen] = useState(false);
    // 抽屉打开时记下原色, 用于"重置"和"取消"还原
    const [initialColors, setInitialColors] = useState(null);
    const [draftColors, setDraftColors] = useState(null);
    // 哪一行的 picker 抽屉是打开的, null = 都收起
    const [activePicker, setActivePicker] = useState(null);

    const choose = (preset) => {
      // 选预设时若抽屉开着, 顺手关掉并放弃 draft (要切换到新预设了)
      if (customOpen) {
        setCustomOpen(false);
        setDraftColors(null);
        setInitialColors(null);
      }
      const next = { preset: preset.id };
      window.OB_THEME.applyTheme(preset.colors);
      window.OB_THEME.saveTheme(next);
      setState(next);
      setOpen(false);
    };

    const toggleCustom = () => {
      if (customOpen) {
        // 二次点击 = 取消 + 收起 (还原到打开前)
        if (initialColors) window.OB_THEME.applyTheme(initialColors);
        setCustomOpen(false);
        setDraftColors(null);
        setInitialColors(null);
        setActivePicker(null);
      } else {
        const initial = window.OB_THEME.getCurrentColors(state);
        setInitialColors(initial);
        setDraftColors(initial);
        setCustomOpen(true);
      }
    };

    const tweakColor = (key, value) => {
      const next = { ...draftColors, [key]: value };
      setDraftColors(next);
      window.OB_THEME.applyTheme(next);
    };

    const resetDraft = () => {
      if (!initialColors) return;
      setDraftColors(initialColors);
      window.OB_THEME.applyTheme(initialColors);
    };

    const applyCustom = () => {
      if (!draftColors) return;
      const next = { preset: 'custom', custom: draftColors };
      window.OB_THEME.applyTheme(draftColors);
      window.OB_THEME.saveTheme(next);
      setState(next);
      setCustomOpen(false);
      setDraftColors(null);
      setInitialColors(null);
      setActivePicker(null);
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
          <div className={`ob-theme-panel ${customOpen ? 'is-expanded' : ''}`}>
            <div className="ob-theme-panel-swatches">
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
                title={customOpen ? '收起自定义' : '自定义配色'}
                className={`ob-theme-swatch custom ${state.preset === 'custom' ? 'on' : ''} ${customOpen ? 'is-drawer-open' : ''}`}
                style={{ background: 'conic-gradient(from 0deg, #6e4f9a, #d291b3, #d4a85f, #6e4f9a)' }}
                onClick={toggleCustom}
              />
            </div>
            {customOpen && draftColors && (
              <div className="ob-theme-drawer">
                <div className="ob-theme-drawer-hint-top">实时预览 · 点 ⊕ 还原 · 应用保存</div>
                {CUSTOM_ROWS.map(([key, label, hint]) => {
                  const cur = draftColors[key] || window.OB_THEME.FALLBACK[key];
                  const isOpen = activePicker === key;
                  return (
                    <React.Fragment key={key}>
                      <div className={`ob-theme-drawer-row ${isOpen ? 'is-open' : ''}`}>
                        <div className="ob-theme-drawer-row-l">
                          <div className="ob-theme-drawer-lbl">{label}</div>
                          <div className="ob-theme-drawer-hint">{hint}</div>
                        </div>
                        <button
                          type="button"
                          className={`ob-theme-drawer-swatch ${isOpen ? 'is-open' : ''}`}
                          style={{ background: cur }}
                          onClick={() => setActivePicker(p => p === key ? null : key)}
                          title={isOpen ? '收起' : '展开调色'}
                        />
                        <span className="ob-theme-drawer-val">{cur.toUpperCase()}</span>
                      </div>
                      {isOpen && (
                        <InlineColorPicker
                          value={cur}
                          onChange={(v) => tweakColor(key, v)}
                        />
                      )}
                    </React.Fragment>
                  );
                })}
                <div className="ob-theme-drawer-foot">
                  <button className="ob-theme-drawer-btn ghost" onClick={resetDraft} title="恢复到打开前">⊕ 重置</button>
                  <button className="ob-theme-drawer-btn primary" onClick={applyCustom}>应用</button>
                </div>
              </div>
            )}
          </div>
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
