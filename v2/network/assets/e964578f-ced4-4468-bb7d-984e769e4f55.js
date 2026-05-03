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

// ──────────────────────────────────────────────────────────
// Barnes-Hut 四叉树 — 排斥力 O(N²) → O(N log N)
// 200 节点: 17M ops → 150K ops, 提速 ~100x
// 1000 节点: 220M ops → 1M ops, 提速 ~200x
// ──────────────────────────────────────────────────────────
function _qtMakeNode(x, y, size) {
  return { x, y, size, point: null, children: null, mass: 0, cx: 0, cy: 0 };
}
function _qtInsert(node, p) {
  // 累加质心
  node.cx = (node.cx * node.mass + p.x) / (node.mass + 1);
  node.cy = (node.cy * node.mass + p.y) / (node.mass + 1);
  node.mass++;
  if (node.children === null) {
    if (node.point === null) { node.point = p; return; }
    if (node.size < 1) return;  // 太小, 不再细分
    // 已有点 → 细分
    const old = node.point;
    node.point = null;
    const half = node.size / 2;
    node.children = [
      _qtMakeNode(node.x,        node.y,        half),
      _qtMakeNode(node.x + half, node.y,        half),
      _qtMakeNode(node.x,        node.y + half, half),
      _qtMakeNode(node.x + half, node.y + half, half),
    ];
    _qtInsertChild(node, old);
  }
  _qtInsertChild(node, p);
}
function _qtInsertChild(node, p) {
  const half = node.size / 2;
  const right = p.x >= node.x + half;
  const bottom = p.y >= node.y + half;
  _qtInsert(node.children[(bottom ? 2 : 0) + (right ? 1 : 0)], p);
}
function _qtBuild(positions) {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const p of positions) {
    if (p.x < minX) minX = p.x;
    if (p.y < minY) minY = p.y;
    if (p.x > maxX) maxX = p.x;
    if (p.y > maxY) maxY = p.y;
  }
  const w = maxX - minX, h = maxY - minY;
  const size = Math.max(w, h, 100) * 1.1 + 1;
  const cx = (minX + maxX) / 2, cy = (minY + maxY) / 2;
  const root = _qtMakeNode(cx - size / 2, cy - size / 2, size);
  for (const p of positions) _qtInsert(root, p);
  return root;
}
// 对节点 p 应用从整棵树来的排斥力 (Barnes-Hut)
// theta=0.9: 节点距离够远时 (size/d < theta) 用质心近似整个子树
function _qtApplyRepulsion(node, p, theta) {
  if (node.mass === 0) return;
  if (node.point === p) return;  // skip self leaf
  // 关键: 如果 p 落在 node 边界内, 必须递归 — 否则会把"包含 p 的子树质心" 当外部质心,
  // 导致 p 自己的位置参与对自己的斥力计算 (永远抵消, 节点全被引到中心)
  const insideNode = (
    p.x >= node.x && p.x < node.x + node.size &&
    p.y >= node.y && p.y < node.y + node.size
  );
  const dx = node.cx - p.x;
  const dy = node.cy - p.y;
  const d2 = dx * dx + dy * dy + 0.01;
  const d = Math.sqrt(d2);
  if (!insideNode && (node.point !== null || node.size / d < theta)) {
    // 当作单点 (质心 + 总质量)
    const baseForce = 1800 * node.mass / d2;
    let f = baseForce;
    if (node.point !== null) {
      const minD = (p.r + (node.point.r || 5)) * 1.6 + 30;
      if (d < minD) f += (minD - d) * 0.5;
    }
    p.vx -= (dx / d) * f;
    p.vy -= (dy / d) * f;
    return;
  }
  // 包含 p 或太近 → 递归子节点 (单点 leaf 但被 p 落在内, 也走递归 (其实就 return,因为 point===p))
  if (node.children) {
    for (const child of node.children) _qtApplyRepulsion(child, p, theta);
  }
  // 注: insideNode + node.point !== null + node.point !== p 的情况罕见(同位置两点),
  // 此时跳过即可避免 NaN
}

// 力导向布局（Barnes-Hut quadtree, O(N log N)）
// 参数：nodes [{id, r}], links [{source, target, weight}], width, height
function simulateLayout(nodes, links, width, height, iters = 220) {
  const N = nodes.length;
  if (N === 0) return [];
  const cx = width / 2, cy = height / 2;
  const ringR = Math.min(width, height) * 0.36;

  // 初始位置: 圆形布散 (按 importance 内圈)
  const positions = nodes.map((n, i) => {
    const a = (i / N) * Math.PI * 2;
    const importance = n.importance || 5;
    const r = ringR * (1.05 - importance * 0.04) + (Math.random() - 0.5) * 30;
    return {
      x: cx + Math.cos(a) * r + (Math.random() - 0.5) * 40,
      y: cy + Math.sin(a) * r + (Math.random() - 0.5) * 40,
      vx: 0, vy: 0,
      r: n.r || 5,
    };
  });

  // id → idx 映射 (link 引用用)
  const idIdx = {};
  nodes.forEach((n, i) => { idIdx[n.id] = i; });
  const linkPairs = [];
  for (const l of links) {
    const a = idIdx[l.source];
    const b = idIdx[l.target];
    if (a !== undefined && b !== undefined) {
      linkPairs.push({ a, b, weight: l.weight });
    }
  }

  const theta = 0.9;
  for (let step = 0; step < iters; step++) {
    const t = 1 - step / iters;

    // 1) 排斥 (Barnes-Hut O(N log N))
    const tree = _qtBuild(positions);
    for (let i = 0; i < N; i++) _qtApplyRepulsion(tree, positions[i], theta);

    // 2) 弹簧 (按权重) O(L)
    for (const l of linkPairs) {
      const a = positions[l.a], b = positions[l.b];
      const dx = b.x - a.x, dy = b.y - a.y;
      const d = Math.sqrt(dx * dx + dy * dy) + 0.01;
      const target = 130 - Math.min(60, l.weight * 12);
      const k = 0.04 + l.weight * 0.012;
      const f = (d - target) * k;
      const fx = (dx / d) * f, fy = (dy / d) * f;
      a.vx += fx; a.vy += fy;
      b.vx -= fx; b.vy -= fy;
    }

    // 3) 中心引力 O(N)
    for (const p of positions) {
      p.vx += (cx - p.x) * 0.008;
      p.vy += (cy - p.y) * 0.008;
    }

    // 4) 阻尼 + 步进 O(N)
    for (const p of positions) {
      p.vx *= 0.78; p.vy *= 0.78;
      p.x += p.vx * t;
      p.y += p.vy * t;
    }
  }

  return nodes.map((n, i) => ({ ...n, x: positions[i].x, y: positions[i].y }));
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
