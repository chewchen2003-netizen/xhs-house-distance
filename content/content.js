/*!
 * content.js — 小红书页面内 UI：悬浮面板、卡片距离角标、划词查询
 */
(function () {
  'use strict';

  if (window.__xhdLoaded) return;
  window.__xhdLoaded = true;

  var STATE = { anchors: [], settings: {} };
  var PANEL_OPEN = false;
  var rendered = [];          // 已渲染的角标 {el, poi, subway}
  var cardQueue = [];
  var cardBusy = false;
  var resolveCount = 0;
  var MAX_RESOLVE = 40;
  var CAND_MEM = new Map();   // 候选词 -> {poi, subway}
  var FAVS = [];              // 收藏的小区

  // ---------------- 与后台通信 ----------------
  function send(msg) {
    return new Promise(function (resolve) {
      try {
        chrome.runtime.sendMessage(msg, function (res) {
          if (chrome.runtime.lastError) { resolve({ ok: false, error: chrome.runtime.lastError.message }); return; }
          resolve(res || { ok: false });
        });
      } catch (e) {
        resolve({ ok: false, error: String(e && e.message || e) });
      }
    });
  }

  // ---------------- 收藏 ----------------
  function loadFavs() {
    return new Promise(function (resolve) {
      try {
        chrome.storage.local.get(['favorites'], function (v) {
          FAVS = (v && v.favorites) || [];
          resolve(FAVS);
        });
      } catch (e) { resolve(FAVS); }
    });
  }

  function saveFavs() {
    try { chrome.storage.local.set({ favorites: FAVS }); } catch (e) {}
  }

  function favKey(poi) { return poi.uid || poi.name; }

  function isFav(poi) {
    var k = favKey(poi);
    return FAVS.some(function (f) { return f.key === k; });
  }

  function addFav(poi, note) {
    var k = favKey(poi);
    if (FAVS.some(function (f) { return f.key === k; })) return false;
    FAVS.unshift({
      key: k,
      name: poi.name,
      addr: poi.addr || '',
      lng: poi.lng, lat: poi.lat, mcX: poi.mcX, mcY: poi.mcY,
      uid: poi.uid, cityId: poi.cityId,
      noteTitle: (note && note.title) || '',
      noteUrl: (note && note.url) || '',
      ts: Date.now()
    });
    return true;
  }

  function toggleFav(poi, note) {
    var k = favKey(poi);
    var idx = FAVS.findIndex(function (f) { return f.key === k; });
    if (idx >= 0) {
      FAVS.splice(idx, 1);
      saveFavs();
      toast('已取消收藏：' + poi.name);
      return false;
    }
    addFav(poi, note);
    saveFavs();
    toast('已收藏：' + poi.name);
    return true;
  }

  function currentNote() {
    var t = '';
    var el = document.querySelector('#detail-title') || document.querySelector('[class*="note-content"] [class*="title"]');
    if (el) t = (el.innerText || '').split('\n')[0].slice(0, 60);
    var u = location.origin + location.pathname;
    return { title: t, url: u };
  }

  // ---------------- 小工具 ----------------
  function h(tag, cls, text) {
    var el = document.createElement(tag);
    if (cls) el.className = cls;
    if (text != null) el.textContent = text;
    return el;
  }
  function distOf(poi, anchor) {
    return Geo.haversine(anchor.lng, anchor.lat, poi.lng, poi.lat);
  }
  function debounce(fn, ms) {
    var t;
    return function () {
      var args = arguments, self = this;
      clearTimeout(t);
      t = setTimeout(function () { fn.apply(self, args); }, ms);
    };
  }

  // ---------------- 悬浮按钮 ----------------
  var fab, panel, panelBody, tipEl;

  function buildUI() {
    fab = h('button', 'xhd-fab');
    fab.type = 'button';
    fab.title = '小红书看房距离助手';
    fab.innerHTML = svgPin();
    fab.addEventListener('click', function (e) {
      e.stopPropagation();
      togglePanel(!PANEL_OPEN);
    });

    panel = h('section', 'xhd-panel');
    panel.addEventListener('mousedown', function (e) { e.stopPropagation(); });
    panel.addEventListener('click', function (e) { e.stopPropagation(); });

    var head = h('header', 'xhd-head');
    var title = h('div', 'xhd-title');
    title.appendChild(h('span', 'xhd-title-dot'));
    title.appendChild(document.createTextNode('看房距离'));

    var tools = h('div', 'xhd-tools');
    var pin = h('button', 'xhd-pin');
    pin.type = 'button';
    pin.title = '固定悬浮窗：刷新/切页面后也保持打开';
    pin.innerHTML = '<svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true">' +
      '<path d="M14.5 2.5l7 7-2.1 2.1-1.4-1.4-4.2 4.2.7 3.5-1.4 1.4-4.2-4.2-4.9 4.9-1.4-1.4 4.9-4.9-4.2-4.2 1.4-1.4 3.5.7 4.2-4.2-1.4-1.4z" fill="currentColor"/></svg>';
    pin.addEventListener('click', function (e) {
      e.stopPropagation();
      togglePin();
    });
    var favBtn = h('button', 'xhd-icon-btn xhd-fav-btn');
    favBtn.type = 'button';
    favBtn.title = '我的收藏';
    favBtn.innerHTML = '<svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true">' +
      '<path d="M12 3l2.7 5.6 6.1.9-4.4 4.3 1 6.1-5.4-2.9-5.4 2.9 1-6.1L3.2 9.5l6.1-.9z" fill="currentColor"/></svg>';
    favBtn.addEventListener('click', function (e) {
      e.stopPropagation();
      renderPanel('favs');
      togglePanel(true, true);
    });
    var close = h('button', 'xhd-close', '×');
    close.type = 'button';
    close.addEventListener('click', function () { togglePanel(false); });
    tools.appendChild(favBtn);
    tools.appendChild(pin);
    tools.appendChild(close);

    head.appendChild(title);
    head.appendChild(tools);

    panelBody = h('div', 'xhd-body');
    panel.appendChild(head);
    panel.appendChild(panelBody);

    tipEl = h('button', 'xhd-tip');
    tipEl.type = 'button';

    document.documentElement.appendChild(fab);
    document.documentElement.appendChild(panel);
    document.documentElement.appendChild(tipEl);
    panel.style.display = 'none';
    tipEl.style.display = 'none';
  }

  function svgPin() {
    return '<svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true">' +
      '<path d="M12 2C8.1 2 5 5.1 5 9c0 5.2 7 13 7 13s7-7.8 7-13c0-3.9-3.1-7-7-7z" fill="#fff"/>' +
      '<circle cx="12" cy="9" r="2.6" fill="#ff2442"/></svg>';
  }

  function togglePanel(open, keep) {
    PANEL_OPEN = open;
    panel.style.display = open ? 'flex' : 'none';
    fab.classList.toggle('xhd-fab-on', open);
    if (open && !keep) renderPanel();
  }

  // ---------------- 面板 ----------------
  function togglePin() {
    STATE.settings.pinned = !STATE.settings.pinned;
    syncPin();
    send({ type: 'settings.set', patch: { pinned: !!STATE.settings.pinned } });
    toast(STATE.settings.pinned ? '已固定，刷新后也会保持打开' : '已取消固定');
  }

  function syncPin() {
    var on = !!STATE.settings.pinned;
    if (panel) panel.classList.toggle('xhd-panel-pinned', on);
    var btn = panel && panel.querySelector('.xhd-pin');
    if (btn) btn.classList.toggle('xhd-pin-on', on);
  }

  function renderPanel(mode, payload) {
    syncPin();
    panelBody.textContent = '';
    panelBody.appendChild(renderAnchors());

    if (mode === 'add') {
      panelBody.appendChild(renderAddForm(payload));
      return;
    }
    if (mode === 'favs') {
      panelBody.appendChild(renderFavs());
      return;
    }
    if (mode === 'detail') {
      panelBody.appendChild(renderDetail(payload));
      return;
    }

    var box = h('div', 'xhd-search');
    var input = h('input', 'xhd-input');
    input.type = 'text';
    input.placeholder = '查小区 / 地点，如 望京西园三区';
    var go = h('button', 'xhd-go', '查');
    go.type = 'button';
    box.appendChild(input);
    box.appendChild(go);

    var results = h('div', 'xhd-results');
    var status = h('div', 'xhd-status');

    function run() {
      var q = input.value.trim();
      if (!q) { input.focus(); return; }
      doSearch(q, results, status);
    }
    go.addEventListener('click', run);
    input.addEventListener('keydown', function (e) { if (e.key === 'Enter') run(); });

    panelBody.appendChild(box);
    panelBody.appendChild(status);
    panelBody.appendChild(results);

    var foot = h('div', 'xhd-foot');
    foot.textContent = '小提示：在笔记里划选小区名，也能直接查距离';
    panelBody.appendChild(foot);

    if (payload && payload.autoQuery) {
      input.value = payload.autoQuery;
      run();
    } else {
      setTimeout(function () { input.focus(); }, 30);
    }
  }

  function renderAnchors() {
    var wrap = h('div', 'xhd-anchors');
    if (!STATE.anchors.length) {
      var empty = h('div', 'xhd-anchors-empty', '还没设置你的地点');
      wrap.appendChild(empty);
    } else {
      STATE.anchors.forEach(function (a) {
        var chip = h('span', 'xhd-anchor', a.name);
        chip.title = a.addr || a.name;
        wrap.appendChild(chip);
      });
    }
    var add = h('button', 'xhd-anchor-add', '+ 地点');
    add.type = 'button';
    add.addEventListener('click', function () { renderPanel('add'); });
    wrap.appendChild(add);
    return wrap;
  }

  function renderAddForm() {
    var wrap = h('div', 'xhd-add');
    var tip = h('div', 'xhd-add-tip', '先给你在意的地方起个名（比如「公司」「健身房」），再搜索它的位置');

    var nameRow = h('div', 'xhd-row2');
    var nameInput = h('input', 'xhd-input');
    nameInput.type = 'text';
    nameInput.placeholder = '备注名，如 公司';
    nameRow.appendChild(nameInput);
    wrap.appendChild(nameRow);

    var box = h('div', 'xhd-search');
    var input = h('input', 'xhd-input');
    input.type = 'text';
    input.placeholder = '搜索地点，如 国贸三期';
    var go = h('button', 'xhd-go', '搜');
    go.type = 'button';
    box.appendChild(input);
    box.appendChild(go);

    var status = h('div', 'xhd-status');
    var results = h('div', 'xhd-results');
    wrap.appendChild(box);
    wrap.appendChild(status);
    wrap.appendChild(results);
    wrap.appendChild(tip);

    function run() {
      var q = input.value.trim();
      if (!q) return;
      status.textContent = '搜索中…';
      send({ type: 'search', q: q }).then(function (res) {
        status.textContent = '';
        results.textContent = '';
        if (!res.ok) { status.textContent = res.error || '搜索失败'; return; }
        if (!res.list.length) { status.textContent = '没找到，换个说法试试（加上商场/地铁站名）'; return; }
        res.list.forEach(function (poi) {
          var row = h('div', 'xhd-row xhd-row-pick');
          var main = h('div', 'xhd-row-main');
          main.appendChild(h('div', 'xhd-name', poi.name));
          main.appendChild(h('div', 'xhd-addr', poi.addr || ''));
          var btn = h('button', 'xhd-mini', '选它');
          btn.type = 'button';
          btn.addEventListener('click', function () {
            var nm = (nameInput.value || '').trim() || poi.name;
            addAnchor({ name: nm, lng: poi.lng, lat: poi.lat, addr: poi.addr || '' });
            renderPanel();
          });
          row.appendChild(main);
          row.appendChild(btn);
          results.appendChild(row);
        });
      });
    }
    go.addEventListener('click', run);
    input.addEventListener('keydown', function (e) { if (e.key === 'Enter') run(); });
    setTimeout(function () { nameInput.focus(); }, 30);
    return wrap;
  }

  function renderDetail(d) {
    var wrap = h('div', 'xhd-detail');
    var back = h('button', 'xhd-back', '← 返回');
    back.type = 'button';
    back.addEventListener('click', function () { renderPanel('default'); });
    wrap.appendChild(back);

    var head = h('div', 'xhd-detail-head');
    head.appendChild(h('div', 'xhd-name', d.poi.name));
    head.appendChild(h('div', 'xhd-addr', d.poi.addr || ''));
    wrap.appendChild(head);

    var dists = h('div', 'xhd-dists');
    STATE.anchors.forEach(function (a) {
      var chip = h('span', 'xhd-chip xhd-chip-main');
      chip.appendChild(document.createTextNode('距' + a.name + ' '));
      chip.appendChild(h('b', null, Geo.fmtDist(distOf(d.poi, a))));
      dists.appendChild(chip);
    });
    wrap.appendChild(dists);

    // 通勤：先占位，再异步填
    var commute = h('div', 'xhd-commute');
    commute.appendChild(h('div', 'xhd-commute-title', '通勤 · 到' + (STATE.anchors[0] ? STATE.anchors[0].name : '公司')));
    var loading = h('div', 'xhd-loading');
    loading.appendChild(h('span', 'xhd-spinner'));
    loading.appendChild(document.createTextNode(' 正在算地铁 / 打车…'));
    commute.appendChild(loading);
    wrap.appendChild(commute);

    var acts = h('div', 'xhd-actions');
    var a1 = h('a', 'xhd-link', '高德地图');
    a1.href = Geo.amapMarker(d.poi.lng, d.poi.lat, d.poi.name);
    a1.target = '_blank';
    a1.rel = 'noreferrer';
    acts.appendChild(a1);
    if (STATE.anchors.length) {
      var base = STATE.anchors[0];
      var a2 = h('a', 'xhd-link', '高德路线');
      a2.href = Geo.amapRoute(base.lng, base.lat, base.name, d.poi.lng, d.poi.lat, d.poi.name, 'bus');
      a2.target = '_blank';
      a2.rel = 'noreferrer';
      acts.appendChild(a2);
    }
    wrap.appendChild(acts);

    var a3 = h('a', 'xhd-link xhd-link-sm', '百度路线');
    a3.href = Geo.baiduMarker(d.poi.lng, d.poi.lat, d.poi.name);
    a3.target = '_blank';
    a3.rel = 'noreferrer';
    acts.appendChild(a3);

    var favBtn = h('button', 'xhd-link xhd-link-sm' + (isFav(d.poi) ? ' xhd-fav-on' : ''),
      isFav(d.poi) ? '★ 已收藏' : '☆ 收藏');
    favBtn.type = 'button';
    favBtn.addEventListener('click', function () {
      var on = toggleFav(d.poi, currentNote());
      favBtn.textContent = on ? '★ 已收藏' : '☆ 收藏';
      favBtn.classList.toggle('xhd-fav-on', on);
    });
    acts.appendChild(favBtn);

    send({ type: 'poi.detail', poi: d.poi }).then(function (res) {
      commute.textContent = '';
      commute.appendChild(h('div', 'xhd-commute-title', '通勤 · 到' + (STATE.anchors[0] ? STATE.anchors[0].name : '公司')));
      if (!res || !res.ok) {
        commute.appendChild(h('div', 'xhd-place-sub', (res && res.error) || '算路失败，点「高德路线」看看'));
        return;
      }
      var t = res.transit && res.transit.best;
      var dv = res.drive;
      if (t) {
        var row = h('div', 'xhd-line');
        row.appendChild(h('span', 'xhd-line-icon', '🚇'));
        var body = h('div', 'xhd-line-body');
        body.appendChild(h('div', 'xhd-line-main', '地铁 ' + fmtMin(t.time) + ' · ¥' + t.price + ' · 步行 ' + Geo.fmtDist(t.walkDistance)));
        body.appendChild(h('div', 'xhd-line-sub',
          (t.lines || []).map(function (l) { return l.name; }).join(' → ') +
          (t.transfers ? ' · 换乘 ' + t.transfers + ' 次' : ' · 不用换乘')));
        row.appendChild(body);
        commute.appendChild(row);
      }
      if (dv) {
        var row2 = h('div', 'xhd-line');
        row2.appendChild(h('span', 'xhd-line-icon', '🚕'));
        var b2 = h('div', 'xhd-line-body');
        b2.appendChild(h('div', 'xhd-line-main',
          '打车 ' + Geo.fmtDist(dv.distance) + ' · ' + fmtMin(dv.time) + (dv.taxiPrice ? ' · 约¥' + dv.taxiPrice : '')));
        b2.appendChild(h('div', 'xhd-line-sub', '不含拥堵，实际以实时路况为准'));
        row2.appendChild(b2);
        commute.appendChild(row2);
      }
      if (res.subway) {
        var row3 = h('div', 'xhd-line');
        row3.appendChild(h('span', 'xhd-line-icon', '📍'));
        var b3 = h('div', 'xhd-line-body');
        b3.appendChild(h('div', 'xhd-line-main',
          '最近地铁 ' + res.subway.name + ' · ' + Geo.fmtDist(res.subway.dist) +
          '（走路约 ' + Math.round(res.subway.dist / 75) + ' 分钟）'));
        row3.appendChild(b3);
        commute.appendChild(row3);
      }
      if (!t && !dv && !res.subway) {
        commute.appendChild(h('div', 'xhd-place-sub', '这一带没算到路线，点「高德路线」看看'));
      }
    });

    return wrap;
  }

  // 通勤信息缓存（页面内）
  var TRANSIT_MEM = new Map();
  function loadTransit(poi) {
    var first = STATE.anchors[0];
    if (!first) return Promise.resolve(null);
    var key = (poi.uid || poi.name) + '|' + (first.uid || first.name);
    if (TRANSIT_MEM.has(key)) return Promise.resolve(TRANSIT_MEM.get(key));
    return send({ type: 'route.only', poi: poi, withDrive: false }).then(function (res) {
      var v = res && res.ok ? (res.transit || null) : null;
      TRANSIT_MEM.set(key, v);
      return v;
    });
  }

  function doSearch(q, results, status) {
    status.textContent = '搜索中…';
    results.textContent = '';
    send({ type: 'search', q: q }).then(function (res) {
      if (!res.ok) { status.textContent = res.error || '搜索失败'; return; }
      if (!res.list.length) { status.textContent = '没找到这个地方'; return; }
      status.textContent = '';
      res.list.forEach(function (poi) {
        results.appendChild(renderResultRow(poi));
      });
    });
  }

  function renderFavs() {
    var wrap = h('div', 'xhd-favs');
    var back = h('button', 'xhd-back', '← 返回');
    back.type = 'button';
    back.addEventListener('click', function () { renderPanel('default'); });
    wrap.appendChild(back);

    if (!FAVS.length) {
      wrap.appendChild(h('div', 'xhd-empty',
        '还没有收藏。点开任意小区，点「☆ 收藏」；或者在笔记的小区清单上点「☆ 全部收藏」。'));
      return wrap;
    }

    var first = STATE.anchors[0];
    var list = FAVS.slice();
    if (first) {
      list.sort(function (a, b) { return distOf(a, first) - distOf(b, first); });
    }

    var head = h('div', 'xhd-favs-head');
    head.appendChild(h('span', null, '已收藏 ' + list.length + ' 个小区'));
    var sortTip = h('span', 'xhd-favs-sort', first ? '按距' + first.name : '');
    head.appendChild(sortTip);
    wrap.appendChild(head);

    var share = h('button', 'xhd-mini xhd-fav-copy', '复制清单发给朋友');
    share.type = 'button';
    share.style.width = '100%';
    share.style.marginBottom = '8px';
    share.addEventListener('click', function () {
      var lines = ['看房距离 · ' + (first ? '距' + first.name : '')];
      list.forEach(function (f, i) {
        lines.push((i + 1) + '. ' + f.name + '  ' +
          (first ? Geo.fmtDist(distOf(f, first)) : '') +
          (f.noteTitle ? '  （' + f.noteTitle + '）' : ''));
      });
      var text = lines.join('\n');
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(text).then(function () { toast('已复制，去微信粘贴吧'); },
          function () { toast('复制失败，可长按选择'); });
      } else {
        toast('复制失败，可长按选择');
      }
    });
    wrap.appendChild(share);

    list.forEach(function (f) {
      var row = h('div', 'xhd-fav-row');
      var main = h('div', 'xhd-fav-main');

      var top = h('div', 'xhd-fav-top');
      top.appendChild(h('span', 'xhd-name', f.name));
      var del = h('button', 'xhd-fav-del', '×');
      del.type = 'button';
      del.title = '移除收藏';
      del.addEventListener('click', function (e) {
        e.stopPropagation();
        FAVS = FAVS.filter(function (x) { return x.key !== f.key; });
        saveFavs();
        renderPanel('favs');
      });
      top.appendChild(del);
      main.appendChild(top);

      if (f.addr) main.appendChild(h('div', 'xhd-addr', f.addr));

      var dists = h('div', 'xhd-dists');
      if (first) {
        var chip = h('span', 'xhd-chip xhd-chip-main');
        chip.appendChild(document.createTextNode('距' + first.name + ' '));
        chip.appendChild(h('b', null, Geo.fmtDist(distOf(f, first))));
        dists.appendChild(chip);
      }
      var tChip = h('span', 'xhd-chip', '通勤…');
      tChip.dataset.favTransit = f.key;
      dists.appendChild(tChip);
      main.appendChild(dists);

      if (f.noteTitle) {
        var src = h('a', 'xhd-fav-src', '来自：' + f.noteTitle);
        src.href = f.noteUrl || '#';
        src.target = '_blank';
        src.rel = 'noreferrer';
        src.addEventListener('click', function (e) { e.stopPropagation(); });
        main.appendChild(src);
      }

      row.appendChild(main);
      row.addEventListener('click', function () { openPoi(f); });
      wrap.appendChild(row);

      if (first) {
        loadTransit(f).then(function (t) {
          if (!t || !t.best) { tChip.textContent = '没算到地铁'; return; }
          tChip.textContent = '🚇 ' + fmtMin(t.best.time);
        });
      } else {
        tChip.textContent = '先设置地点';
      }
    });

    var foot = h('div', 'xhd-foot', '收藏只存在本机浏览器里，不会上传');
    wrap.appendChild(foot);
    return wrap;
  }

  function renderResultRow(poi) {
    var row = h('div', 'xhd-row');
    var main = h('div', 'xhd-row-main');
    main.appendChild(h('div', 'xhd-name', poi.name));
    main.appendChild(h('div', 'xhd-addr', poi.addr || ''));

    if (STATE.anchors.length) {
      var dists = h('div', 'xhd-dists');
      STATE.anchors.slice(0, 3).forEach(function (a) {
        var chip = h('span', 'xhd-chip');
        chip.appendChild(document.createTextNode('距' + a.name + ' '));
        chip.appendChild(h('b', null, Geo.fmtDist(distOf(poi, a))));
        dists.appendChild(chip);
      });
      main.appendChild(dists);
    }

    var acts = h('div', 'xhd-row-acts');
    var link = h('a', 'xhd-link', '地图');
    link.href = Geo.amapMarker(poi.lng, poi.lat, poi.name);
    link.target = '_blank';
    link.rel = 'noreferrer';
    acts.appendChild(link);
    acts.appendChild(h('span', 'xhd-tag', (poi.tag || '').split(';').pop()));

    row.appendChild(main);
    row.appendChild(acts);
    row.addEventListener('click', function (e) {
      if (e.target.closest('a')) return;
      openPoi(poi);
    });
    return row;
  }

  function openPoi(poi) {
    if (!STATE.anchors.length) { renderPanel('add'); togglePanel(true, true); return; }
    renderPanel('detail', { poi: poi });
    togglePanel(true, true);
  }

  function addAnchor(a) {
    var anchors = STATE.anchors.slice();
    anchors.push({
      id: 'a' + Date.now(), name: a.name, lng: a.lng, lat: a.lat, addr: a.addr || '',
      uid: a.uid, mcX: a.mcX, mcY: a.mcY, cityId: a.cityId
    });
    STATE.anchors = anchors;
    send({ type: 'anchors.set', anchors: anchors });
    refreshChips();
    toast('已添加地点：' + a.name);
  }

  // ---------------- 卡片角标 ----------------
  function refreshChips() {
    rendered = rendered.filter(function (r) { return document.contains(r.el); });
    rendered.forEach(function (r) { paintChip(r.el, r.poi, r); });
  }

  // info: { transit, subway } 均可缺省
  function paintChip(el, poi, info) {
    info = info || {};
    el.textContent = '';
    if (!STATE.anchors.length) {
      el.appendChild(h('span', 'xhd-chip-strong', '设置地点'));
      el.appendChild(h('span', null, ' 后可看距离'));
      return;
    }
    var first = STATE.anchors[0];
    var d = distOf(poi, first);
    el.appendChild(h('span', 'xhd-chip-strong', '距' + first.name + ' ' + Geo.fmtDist(d)));

    var transit = info.transit && info.transit.best;
    if (transit) {
      el.appendChild(h('span', 'xhd-sep', '·'));
      el.appendChild(h('span', null, '🚇' + fmtMin(transit.time)));
    } else if (info.subway) {
      el.appendChild(h('span', 'xhd-sep', '·'));
      el.appendChild(h('span', null, '🚇' + Geo.fmtDist(info.subway.dist)));
    }

    var lines = [poi.name, poi.addr || ''];
    STATE.anchors.forEach(function (a) {
      lines.push('距' + a.name + ' ' + Geo.fmtDist(distOf(poi, a)));
    });
    if (transit) {
      lines.push('地铁 ' + fmtMin(transit.time) + ' · ' + (transit.lines || []).map(function (l) { return l.name; }).join(' → '));
    }
    if (info.drive) lines.push('打车 ' + fmtMin(info.drive.time) + ' · 约¥' + info.drive.taxiPrice);
    if (info.subway) lines.push('最近地铁：' + info.subway.name + ' ' + Geo.fmtDist(info.subway.dist));
    el.title = lines.filter(Boolean).join('\n');
  }

  function fmtMin(sec) {
    if (!sec) return '—';
    var m = Math.round(sec / 60);
    if (m < 60) return m + 'min';
    var hh = Math.floor(m / 60), mm = m % 60;
    return hh + 'h' + (mm ? mm + 'm' : '');
  }

  function getCardText(card) {
    var t = (card.innerText || '').replace(/\s+/g, ' ').trim();
    return t.slice(0, 260);
  }

  function isFeed() {
    var p = location.pathname.replace(/\/+$/, '');
    if (/^\/explore\/[0-9a-zA-Z]{8,}/.test(p)) return false;   // 笔记详情页
    var last = p.split('/').pop();
    return last === 'explore' || last === '' || last === 'index';
  }

  function scanFeed() {
    if (!isFeed()) return;
    var links = document.querySelectorAll('a[href*="/explore/"]');
    for (var i = 0; i < links.length; i++) {
      var a = links[i];
      if (a.dataset.xhdSeen) continue;
      var mm = /\/explore\/([0-9a-zA-Z]{8,})/.exec(a.getAttribute('href') || '');
      if (!mm) continue;
      var card = a.closest('[class*="note-item"]') || a.closest('section') || a.closest('li');
      if (!card) continue;
      // 如果抓到了包含很多笔记的外层容器，就不处理，避免角标放错位置
      if (card.querySelectorAll('a[href*="/explore/"]').length > 4) continue;
      a.dataset.xhdSeen = '1';
      enqueueCard(card);
    }
  }

  function enqueueCard(card) {
    if (card.dataset.xhdQueued) return;
    card.dataset.xhdQueued = '1';

    // 已经在视口附近就直接处理，避免依赖 IntersectionObserver
    var r = card.getBoundingClientRect();
    if (r.top < window.innerHeight * 1.2 && r.bottom > -200) {
      cardQueue.push(card);
      pumpQueue();
      return;
    }

    var io = new IntersectionObserver(function (entries) {
      var visible = entries.some(function (e) { return e.isIntersecting; });
      if (!visible) return;
      io.disconnect();
      cardQueue.push(card);
      pumpQueue();
    }, { rootMargin: '250px 0px' });
    io.observe(card);
  }

  function pumpQueue() {
    if (cardBusy) return;
    var card = cardQueue.shift();
    if (!card) return;
    cardBusy = true;
    processCard(card).finally(function () {
      cardBusy = false;
      setTimeout(pumpQueue, 260);
    });
  }

  async function processCard(card) {
    if (!STATE.settings.autoTag) return;
    if (!card.isConnected) return;
    if (card.querySelector('.xhd-card-chip')) return;
    if (resolveCount >= MAX_RESOLVE) return;

    var text = getCardText(card);
    var cands = Detect.candidates(text, 3);
    if (!cands.length) return;

    var got = null;
    for (var i = 0; i < cands.length; i++) {
      var c = await resolveCandidate(cands[i]);
      if (c && c.poi) { got = c; break; }
    }
    if (!got) return;

    resolveCount++;
    var chip = h('div', 'xhd-card-chip');
    chip.dataset.poiName = got.poi.name;
    var rec = { el: chip, poi: got.poi, subway: got.subway, transit: null, drive: null };
    paintChip(chip, got.poi, rec);
    chip.addEventListener('click', function (e) {
      e.preventDefault();
      e.stopPropagation();
      openPoi(got.poi);
    });

    var holder = card.querySelector('[class*="footer"]') || card;
    var titleEl = holder.querySelector('[class*="title"]');
    if (titleEl && titleEl.parentElement) {
      titleEl.parentElement.insertBefore(chip, titleEl.nextSibling);
    } else {
      holder.appendChild(chip);
    }
    rendered.push(rec);

    // 异步把「地铁 X 分钟」补上，先让人看到直线距离
    if (STATE.anchors.length) {
      loadTransit(got.poi).then(function (t) {
        if (!t || !chip.isConnected) return;
        rec.transit = t;
        paintChip(chip, got.poi, rec);
      });
    }
  }

  async function resolveCandidate(word) {
    if (CAND_MEM.has(word)) return CAND_MEM.get(word);
    var res = await send({ type: 'resolve', q: word, withSubway: STATE.settings.subway !== false });
    var val = res && res.ok && res.poi ? { poi: res.poi, subway: res.subway || null } : { poi: null, subway: null };
    CAND_MEM.set(word, val);
    return val;
  }

  // ---------------- 详情页 ----------------
  var lastDetailKey = '';

  function scanDetail() {
    if (isFeed()) return;
    var m = /\/explore\/([0-9a-zA-Z]+)/.exec(location.pathname);
    if (!m) return;
    if (lastDetailKey === m[1] && document.querySelector('.xhd-detail-chips')) return;

    var titleEl = document.querySelector('#detail-title') || document.querySelector('[class*="note-content"] [class*="title"]');
    if (!titleEl) return;
    if (titleEl.nextElementSibling && titleEl.nextElementSibling.classList.contains('xhd-detail-chips')) return;

    var descEl = document.querySelector('#detail-desc') || document.querySelector('[class*="note-content"] [class*="desc"]');
    var text = (titleEl.innerText || '') + '\n' + (descEl ? descEl.innerText : '');
    var cands = Detect.candidates(text, 12, { lines: true });
    if (!cands.length) return;

    lastDetailKey = m[1];

    var box = h('div', 'xhd-detail-chips');
    var card = h('div', 'xhd-places');
    var head = h('div', 'xhd-places-head');
    var headText = h('span', 'xhd-places-title', '识别这篇笔记里的地点…');
    var favAll = h('button', 'xhd-fav-all', '☆ 收藏全部');
    favAll.type = 'button';
    head.appendChild(headText);
    head.appendChild(favAll);
    var list = h('div', 'xhd-places-list');
    card.appendChild(head);
    card.appendChild(list);
    box.appendChild(card);
    titleEl.parentElement.insertBefore(box, titleEl.nextSibling);

    var first = STATE.anchors[0];
    var seen = Object.create(null);
    var rows = [];
    var pending = cands.length;

    var foundPois = [];
    favAll.addEventListener('click', function (e) {
      e.preventDefault();
      e.stopPropagation();
      if (!foundPois.length) return;
      var note = currentNote();
      var added = 0;
      foundPois.forEach(function (poi) { if (addFav(poi, note)) added++; });
      saveFavs();
      favAll.textContent = added ? '★ 已收藏 ' + added : '已在收藏里';
      if (added) toast('已收藏 ' + added + ' 个小区');
      else toast('这些小区都在收藏里了');
    });

    function refreshHead() {
      headText.textContent = '';
      headText.appendChild(document.createTextNode('这篇笔记提到 '));
      headText.appendChild(h('b', null, String(rows.length)));
      headText.appendChild(document.createTextNode(' 个地点 · 距' + (first ? first.name : '公司')));
      if (pending > 0) {
        headText.appendChild(h('span', 'xhd-places-pending', ' 识别中…'));
      }
    }

    function addRow(poi) {
      var row = h('div', 'xhd-place-row');
      row.appendChild(h('span', 'xhd-place-name', poi.name));
      row.appendChild(h('span', 'xhd-place-dist', first ? Geo.fmtDist(distOf(poi, first)) : ''));
      row.addEventListener('click', function (e) { e.preventDefault(); e.stopPropagation(); openPoi(poi); });
      row.dataset.dist = first ? String(distOf(poi, first)) : '0';
      list.appendChild(row);
      rows.push(row);
    }

    function finish() {
      if (!rows.length) {
        box.remove();
        lastDetailKey = '';
        return;
      }
      // 按距离从近到远排一下
      rows.sort(function (a, b) { return Number(a.dataset.dist) - Number(b.dataset.dist); });
      rows.forEach(function (r) { list.appendChild(r); });
      refreshHead();
      if (list.scrollHeight > list.clientHeight + 4) {
        card.appendChild(h('div', 'xhd-places-hint', '↕ 共 ' + rows.length + ' 个，滚动查看'));
      }
    }

    refreshHead();
    cands.forEach(function (word) {
      resolveCandidate(word).then(function (c) {
        pending--;
        if (c && c.poi && !seen[c.poi.uid]) {
          seen[c.poi.uid] = 1;
          foundPois.push(c.poi);
          addRow(c.poi);
        }
        if (pending === 0) finish(); else refreshHead();
      });
    });
  }

  // ---------------- 评论区 ----------------
  var commentSeen = new WeakSet();
  var commentBudget = 20;

  function scanComments() {
    if (isFeed() || commentBudget <= 0) return;
    var nodes = document.querySelectorAll('[class*="comment-item"], .comment-item, [id^="comment-item"]');
    for (var i = 0; i < nodes.length && commentBudget > 0; i++) {
      var el = nodes[i];
      if (commentSeen.has(el)) continue;
      // 只处理最内层，避免把整串回复当成一条
      if (el.querySelector('[class*="comment-item"], .comment-item')) continue;
      commentSeen.add(el);

      var text = (el.innerText || '').replace(/\s+/g, ' ').trim();
      if (text.length < 4 || text.length > 160) continue;
      var cands = Detect.candidates(text, 2);
      if (!cands.length) continue;

      commentBudget--;
      annotateComment(el, cands);
    }
  }

  // 评论条一般是「头像 | 正文 | …」的 flex 行，直接 append 会被挤到行尾甚至溢出卡片。
  // 这里找一个块级的正文容器，把标签挂进去；找不到就挂在整行下面。
  function commentBody(el) {
    var list = el.querySelectorAll('[class*="content"], [class*="text"], [class*="desc"]');
    for (var i = 0; i < list.length; i++) {
      var c = list[i];
      var cs = getComputedStyle(c);
      if (cs.display === 'flex' && cs.flexDirection.indexOf('row') === 0) continue;
      if (cs.display === 'inline' || cs.display === 'inline-flex') continue;
      if (c === el) continue;
      return c;
    }
    return null;
  }

  // 找到「最深」的那层包含该地名的元素，插在它后面，正好在评论正文下面
  function deepestTextNode(el, needle) {
    var nodes = el.querySelectorAll('*');
    var best = null;
    for (var i = 0; i < nodes.length; i++) {
      var n = nodes[i];
      if (n.textContent.indexOf(needle) < 0) continue;
      var childHit = false;
      for (var j = 0; j < n.children.length; j++) {
        if (n.children[j].textContent.indexOf(needle) >= 0) { childHit = true; break; }
      }
      if (!childHit) best = n;
    }
    return best;
  }

  function annotateComment(el, cands) {
    var box = h('div', 'xhd-comment-chip');
    var loading = h('span', 'xhd-comment-loading', '识别地点…');
    box.appendChild(loading);

    var placed = false;
    var host = deepestTextNode(el, cands[0]);
    if (host && host.parentElement && host !== el) {
      var pcs = getComputedStyle(host.parentElement);
      var rowFlex = pcs.display === 'flex' && pcs.flexDirection.indexOf('row') === 0;
      if (!rowFlex && host.parentElement !== el) {
        host.parentElement.insertBefore(box, host.nextSibling);
        placed = true;
      }
    }
    if (!placed) {
      var body = commentBody(el);
      if (body) body.appendChild(box);
      else if (el.parentElement) el.parentElement.insertBefore(box, el.nextSibling);
      else el.appendChild(box);
    }

    (async function () {
      var got = null;
      for (var i = 0; i < cands.length; i++) {
        var c = await resolveCandidate(cands[i]);
        if (c && c.poi) { got = c; break; }
      }
      box.textContent = '';
      if (!got) { box.remove(); return; }

      var poi = got.poi;
      var first = STATE.anchors[0];
      var pill = h('button', 'xhd-comment-pill');
      pill.type = 'button';
      pill.appendChild(h('span', 'xhd-inline-name', poi.name));
      if (first) {
        pill.appendChild(h('span', 'xhd-sep', ' · '));
        pill.appendChild(h('span', 'xhd-chip-strong', '距' + first.name + ' ' + Geo.fmtDist(distOf(poi, first))));
      }
      var t = h('span', 'xhd-comment-transit', '');
      pill.appendChild(t);
      pill.addEventListener('click', function (e) {
        e.preventDefault();
        e.stopPropagation();
        openPoi(poi);
      });
      box.appendChild(pill);

      if (first) {
        loadTransit(poi).then(function (tr) {
          if (!tr || !tr.best) return;
          t.textContent = ' · 🚇' + fmtMin(tr.best.time);
        });
      }
    })();
  }

  // ---------------- 划词查询 ----------------
  var lastSelText = '';

  function onSelectionEnd(e) {
    if (e && e.target && e.target.closest &&
      e.target.closest('.xhd-panel, .xhd-tip, .xhd-fab, .xhd-toast, .xhd-card-chip, .xhd-inline-chip')) return;
    setTimeout(function () {
      var sel = window.getSelection();
      var text = sel ? String(sel).replace(/\s+/g, ' ').trim() : '';
      if (!text || text.length < 2 || text.length > 40) { hideTip(); return; }
      lastSelText = text;
      var rect;
      try { rect = sel.getRangeAt(0).getBoundingClientRect(); } catch (err) { hideTip(); return; }
      if (!rect || (!rect.width && !rect.height)) { hideTip(); return; }
      showTip(text, rect);
    }, 10);
  }

  function showTip(text, rect) {
    tipEl.textContent = '查「' + (text.length > 12 ? text.slice(0, 12) + '…' : text) + '」距离';
    tipEl.style.display = 'block';
    var top = rect.top - 44;
    var left = rect.left + rect.width / 2 - 70;
    tipEl.style.top = Math.max(8, top) + 'px';
    tipEl.style.left = Math.max(8, Math.min(left, window.innerWidth - 160)) + 'px';
  }
  function hideTip() { if (tipEl) tipEl.style.display = 'none'; }
  function queryText(text) {
    hideTip();
    renderPanel('default', { autoQuery: text });
    togglePanel(true, true);
  }

  // ---------------- toast ----------------
  var toastTimer;
  function toast(msg) {
    var t = document.querySelector('.xhd-toast');
    if (!t) { t = h('div', 'xhd-toast'); document.documentElement.appendChild(t); }
    t.textContent = msg;
    t.classList.add('xhd-toast-show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { t.classList.remove('xhd-toast-show'); }, 2200);
  }

  // ---------------- 路由监听 ----------------
  function watchRoute() {
    var last = location.href;
    setInterval(function () {
      if (location.href === last) return;
      last = location.href;
      hideTip();
      document.querySelectorAll('.xhd-detail-chips').forEach(function (n) { n.remove(); });
      lastDetailKey = '';
      rendered = rendered.filter(function (r) { return document.contains(r.el); });
      commentBudget = 20;
      setTimeout(function () { scanFeed(); scanDetail(); scanComments(); }, 600);
    }, 500);
  }

  // ---------------- 启动 ----------------
  async function boot() {
    await loadFavs();
    var st = await send({ type: 'state.get' });
    if (st && st.ok) {
      STATE.anchors = st.anchors || [];
      STATE.settings = st.settings || {};
    }
    buildUI();

    document.addEventListener('mouseup', onSelectionEnd, true);
    document.addEventListener('mousedown', function (e) {
      if (tipEl && tipEl.style.display === 'block' &&
        (!e.target || !e.target.closest || !e.target.closest('.xhd-tip'))) hideTip();
    }, true);
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape') { togglePanel(false); hideTip(); }
    });
    tipEl.addEventListener('click', function () { queryText(lastSelText); });

    chrome.runtime.onMessage.addListener(function (msg) {
      if (msg && msg.type === 'query.text' && msg.text) queryText(msg.text);
    });

    // 设置页 / popup 改了地点或开关，同步到当前页
    if (chrome.storage && chrome.storage.onChanged) {
      chrome.storage.onChanged.addListener(function (changes, area) {
        if (area !== 'local') return;
        if (changes.anchors) {
          STATE.anchors = changes.anchors.newValue || [];
          refreshChips();
          if (PANEL_OPEN) renderPanel('default');
        }
        if (changes.settings) {
          var wasAuto = STATE.settings.autoTag !== false;
          var wasPinned = !!STATE.settings.pinned;
          STATE.settings = changes.settings.newValue || {};
          syncPin();
          if (!wasAuto && STATE.settings.autoTag !== false) { scanFeed(); scanDetail(); }
          if (!wasPinned && STATE.settings.pinned && !PANEL_OPEN) togglePanel(true);
        }
      });
    }

    if (STATE.settings.autoTag !== false) {
      scanFeed();
      setTimeout(scanDetail, 900);
      setTimeout(scanComments, 1800);
      var mo = new MutationObserver(debounce(function () {
        scanFeed();
        scanDetail();
        scanComments();
      }, 400));
      mo.observe(document.body, { childList: true, subtree: true });
    }
    watchRoute();

    // 首次使用：提示设置地点；固定过就直接打开
    if (!STATE.anchors.length) {
      setTimeout(function () { renderPanel('add'); togglePanel(true, true); }, 1200);
    } else if (STATE.settings.pinned) {
      setTimeout(function () { renderPanel('default'); togglePanel(true, true); }, 400);
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }
})();
