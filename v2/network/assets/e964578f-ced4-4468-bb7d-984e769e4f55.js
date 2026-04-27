// constellation-physics.jsx —— 力导向布局 + 类型推断 + 边权计算

// 推断星体类型（4 类）
function inferType(item) {
  if (item.archived) return 'archived';
  if (item.feel) return 'feel';
  if (item.protected || item.highlight) return 'permanent';
  return 'dynamic';
}

// 类型 → 视觉
const TYPE_VIS = {
  dynamic:   { fill: '#a78bd0', glow: 'rgba(167,139,208,0.5)', label: '深紫蓝小星点',  en: 'dynamic'  },
  permanent: { fill: '#d4a85f', glow: 'rgba(212,168,95,0.7)',  label: '金色核心星',    en: 'permanent'},
  feel:      { fill: '#d291b3', glow: 'rgba(210,145,179,0.6)', label: '玫瑰粉情绪星',  en: 'feel'     },
  archived:  { fill: '#8a8898', glow: 'rgba(138,136,152,0.3)', label: '低透明灰星',    en: 'archived' }
};
window.TYPE_VIS = TYPE_VIS;
window.inferType = inferType;

// 半径：importance 1..10 → 5..16
function radiusOf(item) {
  return 5 + (item.importance || 5) * 1.1;
}
window.radiusOf = radiusOf;

// 计算"最近活跃度"（用于光晕）—— 距今 0..30 天
function activityOf(item, now) {
  const d = new Date(item.date + 'T' + (item.time || '00:00'));
  const days = Math.max(0, (now - d) / 864e5);
  return Math.max(0, 1 - days / 30);
}
window.activityOf = activityOf;

// 基于 tag 共现 + 时间邻近 计算边
function buildLinks(items) {
  const links = [];
  for (let i = 0; i < items.length; i++) {
    for (let j = i + 1; j < items.length; j++) {
      const a = items[i], b = items[j];
      const aTags = new Set(a.tags || []);
      const sharedTags = (b.tags || []).filter(t => aTags.has(t));
      let w = sharedTags.length;
      if (w === 0) continue;
      // 同日 +0.5；importance 都高 +0.3
      if (a.date === b.date) w += 0.6;
      if ((a.importance >= 7) && (b.importance >= 7)) w += 0.3;
      // feel ↔ feel 加权
      if (a.feel && b.feel) w += 0.3;
      links.push({ source: a.id, target: b.id, weight: w, shared: sharedTags });
    }
  }
  return links;
}
window.buildLinks = buildLinks;

// 力导向布局（轻量自实现，避免依赖 d3）
// 参数：nodes [{id, r}], links [{source, target, weight}], width, height
function simulateLayout(nodes, links, width, height, iters = 220) {
  // 初始位置：圆形布散
  const N = nodes.length;
  const cx = width / 2, cy = height / 2;
  const ringR = Math.min(width, height) * 0.36;
  const pos = {};
  nodes.forEach((n, i) => {
    const a = (i / N) * Math.PI * 2;
    // 按类型分扇区，重要的内圈
    const importance = n.importance || 5;
    const r = ringR * (1.05 - importance * 0.04) + (Math.random() - 0.5) * 30;
    pos[n.id] = {
      x: cx + Math.cos(a) * r + (Math.random() - 0.5) * 40,
      y: cy + Math.sin(a) * r + (Math.random() - 0.5) * 40,
      vx: 0, vy: 0
    };
  });

  const linkMap = {};
  links.forEach(l => {
    linkMap[l.source] = linkMap[l.source] || [];
    linkMap[l.target] = linkMap[l.target] || [];
    linkMap[l.source].push({ other: l.target, weight: l.weight });
    linkMap[l.target].push({ other: l.source, weight: l.weight });
  });

  for (let step = 0; step < iters; step++) {
    const t = 1 - step / iters;
    // 1) 排斥（O(N^2)，节点 ≤30 没问题）
    for (let i = 0; i < N; i++) {
      for (let j = i + 1; j < N; j++) {
        const a = pos[nodes[i].id], b = pos[nodes[j].id];
        const dx = b.x - a.x, dy = b.y - a.y;
        const d2 = dx*dx + dy*dy + 0.01;
        const d = Math.sqrt(d2);
        const minD = (nodes[i].r + nodes[j].r) * 1.6 + 30;
        const force = 1800 / d2;
        // 距离过近时增大斥力
        const f = force + (d < minD ? (minD - d) * 0.5 : 0);
        const fx = (dx / d) * f, fy = (dy / d) * f;
        a.vx -= fx; a.vy -= fy;
        b.vx += fx; b.vy += fy;
      }
    }
    // 2) 弹簧（按权重）
    links.forEach(l => {
      const a = pos[l.source], b = pos[l.target];
      const dx = b.x - a.x, dy = b.y - a.y;
      const d = Math.sqrt(dx*dx + dy*dy) + 0.01;
      const target = 130 - Math.min(60, l.weight * 12); // 高权 → 短距离
      const k = 0.04 + l.weight * 0.012;
      const f = (d - target) * k;
      const fx = (dx / d) * f, fy = (dy / d) * f;
      a.vx += fx; a.vy += fy;
      b.vx -= fx; b.vy -= fy;
    });
    // 3) 中心引力（更弱）
    nodes.forEach(n => {
      const p = pos[n.id];
      p.vx += (cx - p.x) * 0.008;
      p.vy += (cy - p.y) * 0.008;
    });
    // 4) 阻尼 + 步进
    nodes.forEach(n => {
      const p = pos[n.id];
      p.vx *= 0.78; p.vy *= 0.78;
      p.x += p.vx * t;
      p.y += p.vy * t;
    });
  }

  // 输出最终坐标
  return nodes.map(n => ({ ...n, x: pos[n.id].x, y: pos[n.id].y }));
}
window.simulateLayout = simulateLayout;

// 时间环形布局（按日期排成螺旋）
function timeRingLayout(nodes, width, height) {
  const sorted = [...nodes].sort((a, b) =>
    (a.date + a.time).localeCompare(b.date + b.time)
  );
  const cx = width / 2, cy = height / 2;
  const baseR = Math.min(width, height) * 0.18;
  const N = sorted.length;
  return sorted.map((n, i) => {
    const t = i / Math.max(1, N - 1);
    const a = -Math.PI / 2 + t * Math.PI * 1.85;
    const r = baseR + t * Math.min(width, height) * 0.18;
    return { ...n, x: cx + Math.cos(a) * r, y: cy + Math.sin(a) * r };
  });
}
window.timeRingLayout = timeRingLayout;

// 类型聚类布局
function clusterLayout(nodes, width, height) {
  const groups = {};
  nodes.forEach(n => {
    const t = inferType(n);
    (groups[t] = groups[t] || []).push(n);
  });
  const cx = width / 2, cy = height / 2;
  const R = Math.min(width, height) * 0.3;
  const types = Object.keys(groups);
  const out = [];
  types.forEach((t, ti) => {
    const a = -Math.PI / 2 + (ti / types.length) * Math.PI * 2;
    const gcx = cx + Math.cos(a) * R;
    const gcy = cy + Math.sin(a) * R;
    const arr = groups[t];
    const n = arr.length;
    arr.forEach((node, i) => {
      const inner = (i / Math.max(1, n)) * Math.PI * 2;
      const ir = 30 + Math.sqrt(n) * 14;
      out.push({ ...node, x: gcx + Math.cos(inner) * ir, y: gcy + Math.sin(inner) * ir });
    });
  });
  return out;
}
window.clusterLayout = clusterLayout;
