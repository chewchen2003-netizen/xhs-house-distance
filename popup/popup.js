/* popup.js — 设置页：管理地点、查距离、开关 */
(function () {
  'use strict';

  var STATE = { anchors: [], settings: {} };
  var $ = function (id) { return document.getElementById(id); };

  function send(msg) {
    return new Promise(function (resolve) {
      chrome.runtime.sendMessage(msg, function (res) {
        if (chrome.runtime.lastError) { resolve({ ok: false, error: chrome.runtime.lastError.message }); return; }
        resolve(res || { ok: false });
      });
    });
  }

  function h(tag, cls, text) {
    var el = document.createElement(tag);
    if (cls) el.className = cls;
    if (text != null) el.textContent = text;
    return el;
  }

  function saveAnchors() {
    return send({ type: 'anchors.set', anchors: STATE.anchors }).then(function () {
      renderAnchors();
    });
  }

  function renderAnchors() {
    var box = $('anchorList');
    box.textContent = '';
    if (!STATE.anchors.length) {
      box.appendChild(h('div', 'empty', '还没有地点，点右上角「+ 添加」'));
      return;
    }
    STATE.anchors.forEach(function (a, i) {
      var chip = h('div', 'anchor-chip');
      var name = h('span', null, a.name);
      name.title = a.addr || a.name;
      var del = h('em', null, '×');
      del.title = '删除';
      del.addEventListener('click', function () {
        STATE.anchors.splice(i, 1);
        saveAnchors();
      });
      chip.appendChild(name);
      chip.appendChild(del);
      box.appendChild(chip);
    });
  }

  function renderResults(list, resultsEl, statusEl, opts) {
    resultsEl.textContent = '';
    opts = opts || {};
    if (!list.length) { statusEl.textContent = '没找到，换个说法试试'; return; }
    statusEl.textContent = '';
    list.forEach(function (poi) {
      var row = h('div', 'item');
      var main = h('div', 'item-main');
      main.appendChild(h('div', 'item-name', poi.name));
      if (poi.addr) main.appendChild(h('div', 'item-addr', poi.addr));

      if (STATE.anchors.length) {
        var dists = h('div', 'item-dists');
        STATE.anchors.slice(0, 3).forEach(function (a) {
          var d = Geo.haversine(a.lng, a.lat, poi.lng, poi.lat);
          var pill = h('span', 'pill');
          pill.appendChild(document.createTextNode('距' + a.name + ' '));
          pill.appendChild(h('b', null, Geo.fmtDist(d)));
          dists.appendChild(pill);
        });
        main.appendChild(dists);
      }
      row.appendChild(main);

      if (opts.pick) {
        var add = h('button', 'mini', '选它');
        add.addEventListener('click', function () { opts.pick(poi); });
        row.appendChild(add);
      } else {
        var link = h('a', 'mini', '地图');
        link.href = Geo.amapMarker(poi.lng, poi.lat, poi.name);
        link.target = '_blank';
        link.rel = 'noreferrer';
        link.style.textDecoration = 'none';
        row.appendChild(link);
      }
      resultsEl.appendChild(row);
    });
  }

  function doSearch(q, resultsEl, statusEl) {
    q = String(q || '').trim();
    if (!q) return;
    statusEl.textContent = '搜索中…';
    resultsEl.textContent = '';
    send({ type: 'search', q: q }).then(function (res) {
      if (!res.ok) { statusEl.textContent = res.error || '搜索失败'; return; }
      renderResults(res.list, resultsEl, statusEl);
    });
  }

  function bind() {
    $('btnSearch').addEventListener('click', function () {
      doSearch($('q').value, $('results'), $('status'));
    });
    $('q').addEventListener('keydown', function (e) {
      if (e.key === 'Enter') doSearch($('q').value, $('results'), $('status'));
    });

    $('btnAdd').addEventListener('click', function () {
      var f = $('addForm');
      f.hidden = !f.hidden;
      if (!f.hidden) $('anchorName').focus();
    });

    $('btnAnchorSearch').addEventListener('click', function () {
      var q = $('anchorQuery').value.trim();
      if (!q) { $('anchorQuery').focus(); return; }
      var resultsEl = $('anchorResults');
      var statusEl = $('anchorStatus');
      statusEl.textContent = '搜索中…';
      resultsEl.textContent = '';
      send({ type: 'search', q: q }).then(function (res) {
        if (!res.ok) { statusEl.textContent = res.error || '搜索失败'; return; }
        var name = ($('anchorName').value || '').trim();
        renderResults(res.list, resultsEl, statusEl, {
          pick: function (poi) {
            STATE.anchors.push({
              id: 'a' + Date.now(),
              name: name || poi.name,
              lng: poi.lng,
              lat: poi.lat,
              addr: poi.addr || ''
            });
            saveAnchors();
            $('addForm').hidden = true;
            $('anchorQuery').value = '';
            $('anchorName').value = '';
            resultsEl.textContent = '';
            statusEl.textContent = '';
            $('q').focus();
          }
        });
      });
    });
    $('anchorQuery').addEventListener('keydown', function (e) {
      if (e.key === 'Enter') $('btnAnchorSearch').click();
    });

    $('city').addEventListener('change', function () {
      var v = parseInt(this.value, 10) || 0;
      STATE.settings.city = v;
      STATE.settings.cityName = v === 131 ? '北京' : '全国';
      send({ type: 'settings.set', patch: { city: v, cityName: STATE.settings.cityName } });
    });
    $('autoTag').addEventListener('change', function () {
      STATE.settings.autoTag = this.checked;
      send({ type: 'settings.set', patch: { autoTag: this.checked } });
    });
    $('pinSwitch').addEventListener('change', function () {
      STATE.settings.pinned = this.checked;
      send({ type: 'settings.set', patch: { pinned: this.checked } });
    });
    $('subway').addEventListener('change', function () {
      STATE.settings.subway = this.checked;
      send({ type: 'settings.set', patch: { subway: this.checked } });
    });
  }

  async function boot() {
    var st = await send({ type: 'state.get' });
    if (!st.ok) {
      $('status').textContent = '后台还没就绪，刷新页面再试：' + (st.error || '');
      return;
    }
    STATE.anchors = st.anchors || [];
    STATE.settings = st.settings || {};
    renderAnchors();
    $('city').value = String(STATE.settings.city || 131);
    $('autoTag').checked = STATE.settings.autoTag !== false;
    $('subway').checked = STATE.settings.subway !== false;
    $('pinSwitch').checked = !!STATE.settings.pinned;
    $('ver').textContent = 'v' + chrome.runtime.getManifest().version;
    bind();
    if (!STATE.anchors.length) {
      $('addForm').hidden = false;
    }
  }

  document.addEventListener('DOMContentLoaded', boot);
})();
