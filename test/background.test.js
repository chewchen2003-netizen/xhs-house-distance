/* 在 Node 里跑 background.js 的联调测试（stub 掉 chrome.* API），验证百度取数、匹配、地铁、缓存 */
const fs = require('fs');
const vm = require('vm');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const store = {};
const listeners = {};

global.chrome = {
  runtime: {
    onMessage: { addListener: (fn) => { listeners.msg = fn; } },
    onInstalled: { addListener: () => {} },
    onStartup: { addListener: () => {} },
    lastError: null
  },
  storage: {
    local: {
      get(keys) {
        const out = {};
        if (typeof keys === 'string') { if (keys in store) out[keys] = store[keys]; }
        else if (Array.isArray(keys)) { keys.forEach((k) => { if (k in store) out[k] = store[k]; }); }
        else if (keys && typeof keys === 'object') { Object.keys(keys).forEach((k) => { out[k] = k in store ? store[k] : keys[k]; }); }
        return Promise.resolve(out);
      },
      set(obj) { Object.assign(store, obj); return Promise.resolve(); }
    }
  },
  contextMenus: { removeAll() {}, create() {}, onClicked: { addListener: () => {} } },
  tabs: { sendMessage() {} }
};
global.importScripts = (...files) => {
  files.forEach((f) => vm.runInThisContext(fs.readFileSync(path.join(ROOT, f), 'utf8'), { filename: f }));
};

vm.runInThisContext(fs.readFileSync(path.join(ROOT, 'background.js'), 'utf8'), { filename: 'background.js' });

function ask(msg) {
  return new Promise((resolve) => {
    listeners.msg(msg, {}, resolve);
  });
}

(async () => {
  const t0 = Date.now();
  const r1 = await ask({ type: 'search', q: '望京西园三区' });
  console.log('search 望京西园三区:', r1.ok, 'n=', (r1.list || []).length);
  (r1.list || []).slice(0, 4).forEach((p) => {
    console.log('  -', p.name, '|', p.addr, '|', p.tag, '|', p.lng.toFixed(5), p.lat.toFixed(5), '| match', p.matchScore.toFixed(2));
  });

  const r2 = await ask({ type: 'resolve', q: '望京SOHO', withSubway: true });
  console.log('resolve 望京SOHO:', JSON.stringify(r2.poi && { name: r2.poi.name, lng: r2.poi.lng, lat: r2.poi.lat }), 'subway:', JSON.stringify(r2.subway));

  const r3 = await ask({ type: 'resolve', q: '龙湖别墅', withSubway: false });
  console.log('resolve 龙湖别墅 (should be null):', r3.poi);

  const r4 = await ask({ type: 'resolve', q: '常营苹果派小区', withSubway: false });
  console.log('resolve 常营苹果派小区:', r4.poi && r4.poi.name, r4.poi && r4.poi.matchScore);

  // 缓存命中应该很快
  const t1 = Date.now();
  await ask({ type: 'search', q: '望京西园三区' });
  console.log('cache hit ms:', Date.now() - t1);

  const r5 = await ask({ type: 'state.get' });
  console.log('state:', JSON.stringify(r5.settings));
  console.log('total ms:', Date.now() - t0);
})();
