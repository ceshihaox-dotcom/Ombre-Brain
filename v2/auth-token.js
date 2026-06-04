// ============================================================
// Ombre Brain —— 全局鉴权 token 注入 (所有 v2 页面在 <head> 最前加载)
// ------------------------------------------------------------
// OB 服务端现在要求 X-Admin-Token (除静态页 / /health 外的 /api/* + /mcp 都要门)。
// 这里包一层 window.fetch:
//   · 给同源 /api/ (及 /mcp) 请求自动带上 localStorage['ombre-admin-token'];
//   · 拿到 401 时弹一次 prompt 让你输 token, 存进 localStorage 后刷新页面。
// 必须在任何业务 fetch 之前执行 —— 所以用普通 <script> 放在 <head> 最前
// (早于 babel / React 应用代码)。
// ============================================================
(function () {
  if (window.__obAuthPatched) return;
  window.__obAuthPatched = true;

  var KEY = 'ombre-admin-token';
  var _fetch = window.fetch.bind(window);

  function urlOf(input) {
    try {
      if (typeof input === 'string') return input;
      if (input && typeof input.url === 'string') return input.url;
    } catch (e) {}
    return '';
  }

  window.fetch = function (input, init) {
    var url = urlOf(input);
    var needsToken = url.indexOf('/api/') !== -1 || url.indexOf('/mcp') !== -1;

    if (needsToken) {
      var token = null;
      try { token = localStorage.getItem(KEY); } catch (e) {}
      if (token) {
        init = init || {};
        var h = new Headers(init.headers || {});
        if (!h.has('X-Admin-Token')) h.set('X-Admin-Token', token);
        init.headers = h;
      }
    }

    return _fetch(input, init).then(function (res) {
      if (res && res.status === 401 && needsToken && !window.__obAuthPrompting) {
        window.__obAuthPrompting = true;
        try {
          var entered = window.prompt(
            'Ombre 需要管理员 token (X-Admin-Token)。\n在部署平台设的 OMBRE_ADMIN_TOKEN 值:',
            ''
          );
          if (entered && entered.trim()) {
            try { localStorage.setItem(KEY, entered.trim()); } catch (e) {}
            location.reload();
            return res;
          }
        } catch (e) {}
        window.__obAuthPrompting = false;
      }
      return res;
    });
  };
})();
