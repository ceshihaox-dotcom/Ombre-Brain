// ombre-bridge.js — 把 v2 mock 数据形态接到真实 Ombre-Brain API
// 在 babel 脚本之前加载,提供全局 helper

(function () {
  // 真实 bucket(/api/buckets list 项) → v2 mock 形态
  window.__obRealToMock = function (b) {
    var evt = b.event_time || '';
    var created = b.created || '';
    var hasEvent = !!evt;
    // 没事件时间的桶 fallback 到 created;再没就给个标记日期
    var fallback = created || '2026-01-01';
    var src = hasEvent ? evt : fallback;
    var date = src.length >= 10 ? src.slice(0, 10) : '2026-01-01';
    var time = src.length >= 16 ? src.slice(11, 16) : '00:00';

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
      summary: b.summary || b.content_preview || '',
      body: '',  // 列表 endpoint 不返回 content;打开详情时再 lazy-load
      importance: b.importance || 5,
      tags: tags,
      protected: !!(b.protected || b.pinned),
      feel: b.type === 'feel',
      highlight: !!(b.highlight || b.pinned),
      internalized: !!(b.internalized || b.digested),
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

  // 更新桶 — ItemModal save / 快速 toggle 走这里
  window.__obUpdateBucket = async function (id, patch) {
    var body = {};
    if (patch.title != null) body.name = patch.title;
    if (patch.body != null) body.content = patch.body;
    if (patch.summary != null) body.summary = patch.summary;
    if (patch.importance != null) body.importance = patch.importance;
    if (patch.tags != null) body.tags = patch.tags;
    if (patch.protected != null) body.protected = !!patch.protected;
    if (patch.highlight != null) body.highlight = !!patch.highlight;
    if (patch.internalized != null) body.internalized = !!patch.internalized;
    // event_time:patch 里的 date/time 组装成 ISO,空 → 后端会清掉 metadata.event_time
    if (patch.event_time != null) {
      body.event_time = patch.event_time;
    } else if (patch.date != null || patch.time != null) {
      var d = patch.date || '';
      var t = patch.time || '';
      body.event_time = d ? (t ? d + 'T' + t + ':00' : d) : '';
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
