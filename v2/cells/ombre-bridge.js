// ombre-bridge.js — 把 v2 mock 数据形态接到真实 Ombre-Brain API
// 在 babel 脚本之前加载,提供全局 helper

(function () {
  // ISO → 本地 date/time
  //   带 Z / 时区偏移: 按 UTC 解析转本地 (created)
  //   无时区: 按本地解析 (event_time, LLM 从原文文本推断, 无时区)
  function isoToLocal(s) {
    if (!s) return { date: '', time: '' };
    var iso = String(s);
    var d = new Date(iso);
    if (isNaN(d.getTime())) {
      var raw = String(s);
      return {
        date: raw.length >= 10 ? raw.slice(0, 10) : '',
        time: raw.length >= 16 ? raw.slice(11, 16) : '',
      };
    }
    var pad = function (n) { return String(n).padStart(2, '0'); };
    return {
      date: d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()),
      time: pad(d.getHours()) + ':' + pad(d.getMinutes()),
    };
  }
  function localToUtcIso(date, time) {
    if (!date) return '';
    var t = time || '00:00';
    var d = new Date(date + 'T' + t + ':00');
    if (isNaN(d.getTime())) return '';
    return d.toISOString();
  }
  window.__obIsoToLocal = isoToLocal;
  window.__obLocalToUtcIso = localToUtcIso;

  // 真实 bucket(/api/buckets list 项) → v2 mock 形态
  window.__obRealToMock = function (b) {
    var evt = b.event_time || '';
    var created = b.created || '';
    var hasEvent = !!evt;
    var fallback = created || '2026-01-01';
    var src = hasEvent ? evt : fallback;
    var local = isoToLocal(src);
    var date = local.date || '2026-01-01';
    var time = local.time || '00:00';

    var tags = (b.tags || []).slice();
    if (b.created_by === 'user') tags.push('亲手写');
    else tags.push('AI 写入');
    if (b.internalized || b.digested) tags.push('已内化');
    if (b.protected || b.pinned) tags.push('保护');
    if ((b.importance || 5) >= 8) tags.push('重要');
    if (b.type === 'feel') tags.push('feel(柔软)');

    return {
      id: b.id,
      date: date,
      time: time,
      title: b.name || b.id,
      summary: b.summary || '',           // 用户没填就空,前端按"无摘要不显示"渲染
      preview: b.content_preview || '',  // 始终是 content 自动截断,给"显示原文"的视图当兜底用
      body: '',  // 列表 endpoint 不返回 content;打开详情时再 lazy-load
      importance: b.importance || 5,
      score: typeof b.score === 'number' ? b.score : 0,   // decay 分数
      noise: !!(b.resolved && (b.importance || 5) === 1),
      resolved: !!b.resolved,
      tags: tags,
      protected: !!(b.protected || b.pinned),
      feel: b.type === 'feel',
      highlight: !!(b.highlight || b.pinned),
      internalized: !!(b.internalized || b.digested),
      domain: Array.isArray(b.domain) ? b.domain.filter(Boolean) : [],
      artifacts: [],
      _hasEventTime: hasEvent,
    };
  };

  // 拉全部桶并 transform。app 在 useEffect 里调
  window.__obFetchBuckets = async function () {
    var r = await fetch('/api/buckets', { credentials: 'same-origin' });
    if (!r.ok) throw new Error('GET /api/buckets ' + r.status);
    var rows = await r.json();
    return rows.map(window.__obRealToMock);
  };

  // 拉单条桶详情(打开 modal 时用,补 body)
  window.__obFetchBucketDetail = async function (id) {
    var r = await fetch('/api/bucket/' + encodeURIComponent(id), { credentials: 'same-origin' });
    if (!r.ok) throw new Error('GET /api/bucket/' + id + ' ' + r.status);
    return r.json();
  };

  // 全字段搜索(标题 / 摘要 / 标签 / 域 / 完整正文) —— 调 /api/search 拿后端 fuzz 命中
  // 默认不掺向量(语义)结果,避免出现 title/summary/body 都不含 query 但因语义相近被混进结果
  // 返回 { keyword_hits: [{id, name, matched_in: [...], ...}], vector_hits: [] }
  window.__obSearch = async function (query, opts) {
    opts = opts || {};
    var q = (query || '').trim();
    if (!q) return { query: '', keyword_hits: [], vector_hits: [] };
    var params = new URLSearchParams({ q: q, limit: String(opts.limit || 50) });
    if (opts.includeVector) params.set('include_vector', 'true');
    var r = await fetch('/api/search?' + params.toString(), { credentials: 'same-origin' });
    if (!r.ok) throw new Error('GET /api/search ' + r.status);
    return r.json();
  };

  // 新建桶 — WriteDrawer.onSave 走这里
  window.__obCreateBucket = async function (entry) {
    var eventTime = null;
    if (entry.date && entry.time) eventTime = entry.date + 'T' + entry.time + ':00';
    else if (entry.date) eventTime = entry.date;
    var content = (entry.body && entry.body.trim()) || entry.summary || entry.title;
    var body = {
      name: entry.title,
      content: content,
      importance: entry.importance,
      tags: entry.tags || [],
      protected: !!entry.protected,
      event_time: eventTime,
    };
    if (entry.feel) {
      body.valence = 0.6;
      body.arousal = 0.55;
    }
    var r = await fetch('/api/bucket/create', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (!r.ok) throw new Error(await r.text());
    return r.json();
  };

  // 全库语义相似(embedding cosine) — modal "可能关联"区用
  window.__obFetchSimilar = async function (id, n) {
    var r = await fetch('/api/bucket/' + encodeURIComponent(id) + '/similar?n=' + (n || 5));
    if (!r.ok) throw new Error('GET /similar ' + r.status);
    var d = await r.json();
    return d.similar || [];
  };

  // 更新桶 — ItemModal save / 快速 toggle 走这里
  window.__obUpdateBucket = async function (id, patch) {
    var body = {};
    if (patch.title != null) body.name = patch.title;
    if (patch.body != null) body.content = patch.body;
    if (patch.summary != null) body.summary = patch.summary;
    if (patch.raw_source != null) body.raw_source = patch.raw_source;  // 原文片段(用户手动补全)
    if (patch.importance != null) body.importance = patch.importance;
    if (patch.tags != null) body.tags = patch.tags;
    if (patch.protected != null) body.protected = !!patch.protected;
    if (patch.highlight != null) body.highlight = !!patch.highlight;
    if (patch.internalized != null) body.internalized = !!patch.internalized;
    if (patch.noise != null) {
      body.resolved = !!patch.noise;
      if (patch.noise) body.importance = 1;
    }
    // event_time:patch 里的 date/time(本地)组装成 UTC ISO,空 → 后端清掉
    if (patch.event_time != null) {
      body.event_time = patch.event_time;
    } else if (patch.date != null || patch.time != null) {
      var d = patch.date || '';
      var t = patch.time || '';
      body.event_time = d ? localToUtcIso(d, t) : '';
    }
    // feel 在 ombre-brain 是 type 字段(feel / dynamic),update 端点未暴露 type 切换 — 暂跳过
    var r = await fetch('/api/bucket/' + encodeURIComponent(id) + '/update', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (!r.ok) throw new Error(await r.text());
    return r.json();
  };
})();
