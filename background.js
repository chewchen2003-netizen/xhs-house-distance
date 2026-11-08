/*!
 * background.js — 后台服务：调百度地图搜索 POI、算最近地铁站、缓存、右键菜单
 * 说明：百度地图网页版接口不需要 key，返回带墨卡托坐标；这里做限速 + 本地缓存，
 *      避免在信息流里滑动时把接口打爆。
 */
importScripts('lib/geo.js', 'lib/detect.js');

const BAIDU_HOST = 'https://map.baidu.com/';
const MIN_GAP = 320;          // 两次请求的最小间隔(ms)
const CACHE_TTL_OK = 14 * 864e5;
const CACHE_TTL_MISS = 3 * 864e5;

// ---------- 小工具 ----------
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function hash(str) {
  let h = 5381;
  for (let i = 0; i < str.length; i++) h = ((h << 5) + h + str.charCodeAt(i)) | 0;
  return Math.abs(h).toString(36);
}

let lastCall = 0;
let chain = Promise.resolve();

/** 串行化 + 限速 */
function serial(fn) {
  chain = chain.then(async () => {
    const wait = lastCall + MIN_GAP - Date.now();
    if (wait > 0) await sleep(wait);
    lastCall = Date.now();
    return fn();
  }, async () => {
    const wait = lastCall + MIN_GAP - Date.now();
    if (wait > 0) await sleep(wait);
    lastCall = Date.now();
    return fn();
  });
  return chain;
}

async function fetchJson(url) {
  const res = await fetch(url, {
    method: 'GET',
    credentials: 'omit',
    headers: { Accept: '*/*' }
  });
  if (!res.ok) throw new Error('网络请求失败 HTTP ' + res.status);
  const text = await res.text();
  try {
    return JSON.parse(text);
  } catch (e) {
    // 被风控时百度会返回一段 HTML
    if (/<html/i.test(text)) throw new Error('地图接口被限流了，请稍后再试');
    const m = /^[\w$.]+\((.*)\)\s*;?$/s.exec(text.trim());
    if (m) return JSON.parse(m[1]);
    throw new Error('地图返回格式异常');
  }
}

// ---------- 百度 POI 搜索 ----------
function buildSearchUrl(keyword, city, bbox) {
  const q = encodeURIComponent(keyword);
  // city=0 表示不限城市，此时不带 c 参数
  const c = city ? '&c=' + city : '';
  return BAIDU_HOST + '?qt=s&wd=' + q + c +
    '&src=0&pn=0&sug=0&l=19&b=' + (bbox || '(0,0;0,0)') +
    '&from=webmap&tn=B_NORMAL_MAP&nn=0&ie=utf-8&oue=1&res=api';
}

function parseGeo(geo) {
  // "1|12967485.13,4838591.55;...|..."  ->  [mcX, mcY]
  if (!geo) return null;
  const m = /(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?)/.exec(geo);
  if (!m) return null;
  return [parseFloat(m[1]), parseFloat(m[2])];
}

function pickPois(data) {
  const list = (data && data.content) || [];
  const out = [];
  for (const it of list) {
    if (!it || !it.name) continue;
    const mc = parseGeo(it.geo);
    if (!mc) continue;
    const ll = Geo.mc2ll(mc[0], mc[1]);
    if (!ll) continue;
    out.push({
      uid: it.uid || it.name,
      name: String(it.name).trim(),
      addr: it.addr || it.area_name || '',
      tag: it.std_tag || '',
      cityId: it.city_id || 131,
      mcX: mc[0], mcY: mc[1],
      lng: ll.lng, lat: ll.lat
    });
  }
  return out;
}

async function rawSearch(keyword, city) {
  const data = await fetchJson(buildSearchUrl(keyword, city));
  if (data && data.result && data.result.error && !data.content) {
    throw new Error('地图接口返回错误');
  }
  return pickPois(data);
}

/** 带缓存的搜索（原始结果） */
async function searchPois(keyword, city) {
  const key = 'c:' + hash((city || 131) + '|' + keyword);
  const store = await chrome.storage.local.get(key);
  const hit = store[key];
  if (hit && Date.now() - hit.t < (hit.list && hit.list.length ? CACHE_TTL_OK : CACHE_TTL_MISS)) {
    return hit.list || [];
  }
  const list = await serial(() => rawSearch(keyword, city));
  const cache = {};
  cache[key] = { t: Date.now(), list };
  chrome.storage.local.set(cache);
  return list;
}

/** 搜索并挑出最像的 POI */
async function resolvePlace(keyword, city) {
  const list = await searchPois(keyword, city);
  if (!list.length) return null;
  let best = null, bestScore = 0;
  for (const p of list) {
    let s = Detect.score(keyword, p.name);
    if (Detect.looksResidential(p.tag)) s += 0.02;
    if (s > bestScore) { bestScore = s; best = p; }
  }
  if (!best || bestScore < 0.6) return null;
  return Object.assign({}, best, { matchScore: bestScore });
}

/** 找最近的地铁站（半径 2.5km） */
async function nearestSubway(mcX, mcY, cityId) {
  if (!isFinite(mcX) || !isFinite(mcY)) return null;
  const key = 's:' + hash(Math.round(mcX / 100) + ',' + Math.round(mcY / 100));
  const store = await chrome.storage.local.get(key);
  if (store[key] && Date.now() - store[key].t < CACHE_TTL_OK) return store[key].v;

  const R = 2500;
  const bbox = '(' + Math.round(mcX - R) + ',' + Math.round(mcY - R) + ';' +
    Math.round(mcX + R) + ',' + Math.round(mcY + R) + ')';
  const url = BAIDU_HOST + '?qt=con&wd=' + encodeURIComponent('地铁站') + '&c=' + (cityId || 131) + '&src=0&pn=0&sug=0&l=19&b=' +
    bbox + '&from=webmap&tn=B_NORMAL_MAP&nn=0&rn=10&ie=utf-8&oue=1&res=api';

  let value = null;
  try {
    const data = await serial(() => fetchJson(url));
    const pois = pickPois(data);
    let min = Infinity;
    for (const p of pois) {
      if (!/地铁/.test(p.tag)) continue;
      const d = Geo.haversine(p.lng, p.lat, Geo.mc2ll(mcX, mcY).lng, Geo.mc2ll(mcX, mcY).lat);
      if (d < min) { min = d; value = { name: p.name, dist: Math.round(d) }; }
    }
  } catch (e) {
    value = null;
  }
  const cache = {};
  cache[key] = { t: Date.now(), v: value };
  chrome.storage.local.set(cache);
  return value;
}


// ---------- 路径规划（地铁 / 打车）----------
const ROUTE_TTL = 7 * 864e5;

function routePoint(p) {
  // 百度老接口格式：sn=1$$uid$$mcX,mcY$$名称$$$$$$
  const uid = p.uid || '';
  const mc = (isFinite(p.mcX) && isFinite(p.mcY)) ? (p.mcX + ',' + p.mcY) : '';
  return '1$$' + uid + '$$' + mc + '$$' + encodeURIComponent(p.name || '') + '$$$$$$';
}

function routeUrl(qt, from, to, city, extra) {
  const c = city || 131;
  return BAIDU_HOST + '?qt=' + qt + '&' + (extra || '') + 'c=' + c +
    '&sn=' + routePoint(from) + '&en=' + routePoint(to) +
    '&sy=0&ie=utf-8&oue=1&res=api&t=' + Date.now();
}

function pickLines(scheme) {
  const out = [];
  const groups = Array.isArray(scheme.lines) ? scheme.lines : [];
  for (const g of groups) {
    if (!Array.isArray(g)) continue;
    for (const it of g) {
      if (it && typeof it === 'object' && it.name) {
        out.push({
          name: String(it.name).replace(/\(.*?\)/g, '').replace(/^地铁/, '').trim(),
          type: it.type,                       // 1 = 地铁, 0 = 公交
          stationNum: it.station_num || 0,
          time: it.time || 0,
          color: it.lineColor || ''
        });
      }
    }
  }
  return out;
}

async function queryTransit(from, to, city) {
  const raw = await serial(() => fetchJson(routeUrl('bt', from, to, city, 'bttp=0&')));
  const list = Array.isArray(raw.content) ? raw.content : [];
  if (!list.length) return null;

  const schemes = [];
  for (const it of list) {
    const ext = (it.exts && it.exts[0]) || {};
    const lines = pickLines(it);
    if (!lines.length) continue;
    schemes.push({
      time: ext.time || 0,                 // 秒
      distance: ext.distance || 0,
      price: (ext.price || 0) / 100,       // 接口单位是分
      walkDistance: ext.walk_distance || 0,
      walkTime: ext.walk_time || 0,
      lines: lines,
      transfers: Math.max(0, lines.length - 1),
      hasSubway: lines.some((l) => l.type === 1)
    });
  }
  if (!schemes.length) return null;
  // 优先地铁；同等条件少走路 —— 纯时长最短常常是「走路 3 公里」
  const score = (x) => x.time + x.walkTime * 0.5;
  schemes.sort((a, b) => {
    if (a.hasSubway !== b.hasSubway) return a.hasSubway ? -1 : 1;
    return score(a) - score(b);
  });
  return { best: schemes[0], all: schemes.slice(0, 3) };
}

async function queryDrive(from, to, city) {
  const raw = await serial(() => fetchJson(routeUrl('nav', from, to, city, '')));
  const c = raw.content;
  if (!c || typeof c !== 'object' || !c.dis) return null;
  const taxi = c.taxi || {};
  const day = (taxi.detail || []).find((d) => /白天/.test(d.desc || '')) || (taxi.detail || [])[0] || {};
  return {
    distance: c.dis,
    time: c.time || 0,
    toll: c.toll || 0,
    taxiPrice: day.totalPrice ? Number(day.totalPrice) : null
  };
}

async function getRoute(from, to, city, wantDrive) {
  if (!from || !to || !from.name || !to.name) return null;
  const key = 'r:' + hash([from.uid || from.name, to.uid || to.name, city || 131].join('|'));
  const store = await chrome.storage.local.get(key);
  if (store[key] && Date.now() - store[key].t < ROUTE_TTL) return store[key].v;

  let transit = null, drive = null;
  try { transit = await queryTransit(from, to, city); } catch (e) { transit = null; }
  if (wantDrive !== false) {
    try { drive = await queryDrive(from, to, city); } catch (e) { drive = null; }
  }

  const value = { transit, drive };
  const cache = {};
  cache[key] = { t: Date.now(), v: value };
  chrome.storage.local.set(cache);
  return value;
}

/** 老版本存的 anchor 可能没有 uid/mc，补一次 */
async function ensureAnchor(anchor, city) {
  if (anchor && anchor.uid && isFinite(anchor.mcX)) return anchor;
  const poi = await resolvePlace(anchor.name, city);
  if (!poi) return anchor;
  const merged = Object.assign({}, anchor, {
    uid: poi.uid, mcX: poi.mcX, mcY: poi.mcY,
    lng: poi.lng, lat: poi.lat
  });
  // 顺手写回存储
  const s = await chrome.storage.local.get(['anchors']);
  const list = Array.isArray(s.anchors) ? s.anchors : [];
  const idx = list.findIndex((a) => a.id === anchor.id);
  if (idx >= 0) {
    list[idx] = merged;
    await chrome.storage.local.set({ anchors: list });
  }
  return merged;
}

// ---------- 状态 ----------
const DEFAULT_SETTINGS = { city: 131, cityName: '北京', autoTag: true, subway: true };

async function getState() {
  const s = await chrome.storage.local.get(['anchors', 'settings']);
  return {
    anchors: Array.isArray(s.anchors) ? s.anchors : [],
    settings: Object.assign({}, DEFAULT_SETTINGS, s.settings || {})
  };
}

// ---------- 消息 ----------
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  (async () => {
    try {
      switch (msg && msg.type) {
        case 'ping':
          sendResponse({ ok: true });
          return;
        case 'state.get': {
          sendResponse(Object.assign({ ok: true }, await getState()));
          return;
        }
        case 'anchors.set': {
          await chrome.storage.local.set({ anchors: msg.anchors || [] });
          sendResponse({ ok: true });
          return;
        }
        case 'settings.set': {
          const cur = await getState();
          const next = Object.assign({}, cur.settings, msg.patch || {});
          await chrome.storage.local.set({ settings: next });
          sendResponse({ ok: true, settings: next });
          return;
        }
        case 'search': {
          const kw = String(msg.q || '').trim();
          if (!kw) { sendResponse({ ok: false, error: '请输入地点名' }); return; }
          const city = msg.city !== undefined ? msg.city : (await getState()).settings.city;
          const pois = await searchPois(kw, city);
          const scored = pois
            .map((p) => Object.assign({}, p, { matchScore: Detect.score(kw, p.name) }))
            .sort((a, b) => b.matchScore - a.matchScore)
            .slice(0, 8);
          sendResponse({ ok: true, list: scored });
          return;
        }
        case 'resolve': {
          // 从一段文字里找小区，返回最佳匹配
          const kw = String(msg.q || '').trim();
          if (!kw) { sendResponse({ ok: false }); return; }
          const city = msg.city !== undefined ? msg.city : (await getState()).settings.city;
          const poi = await resolvePlace(kw, city);
          if (!poi) { sendResponse({ ok: true, poi: null }); return; }
          let subway = null;
          if (msg.withSubway) subway = await nearestSubway(poi.mcX, poi.mcY, poi.cityId);
          sendResponse({ ok: true, poi, subway });
          return;
        }
        case 'subway': {
          const v = await nearestSubway(msg.mcX, msg.mcY, msg.cityId);
          sendResponse({ ok: true, subway: v });
          return;
        }
        case 'poi.detail': {
          // 一个小区 + 一个落脚点 -> 地铁方案 / 打车 / 最近地铁站
          const st2 = await getState();
          const city = msg.city || st2.settings.city;
          const to = msg.poi;
          let from = msg.anchor || st2.anchors[0] || null;
          if (!from) { sendResponse({ ok: false, error: '还没有设置地点' }); return; }
          from = await ensureAnchor(from, city);
          const [route, subway] = await Promise.all([
            getRoute(from, to, city),
            msg.withSubway === false ? Promise.resolve(null) : nearestSubway(to.mcX, to.mcY, to.cityId)
          ]);
          sendResponse({ ok: true, transit: route && route.transit, drive: route && route.drive, subway });
          return;
        }
        case 'route.only': {
          // 只要地铁/打车，不查地铁站（给小卡片用）
          const st3 = await getState();
          const city3 = msg.city || st3.settings.city;
          let from3 = msg.anchor || st3.anchors[0] || null;
          if (!from3) { sendResponse({ ok: false, error: '还没有设置地点' }); return; }
          from3 = await ensureAnchor(from3, city3);
          const r3 = await getRoute(from3, msg.poi, city3, msg.withDrive !== false);
          sendResponse({ ok: true, transit: r3 && r3.transit, drive: r3 && r3.drive });
          return;
        }
        default:
          sendResponse({ ok: false, error: 'unknown message' });
      }
    } catch (e) {
      sendResponse({ ok: false, error: (e && e.message) || String(e) });
    }
  })();
  return true;
});

// ---------- 右键菜单 ----------
function installMenu() {
  chrome.contextMenus.removeAll(() => {
    chrome.contextMenus.create({
      id: 'xhs-distance',
      title: '查「%s」到我的地点距离',
      contexts: ['selection'],
      documentUrlPatterns: ['*://*.xiaohongshu.com/*']
    });
  });
}

chrome.runtime.onInstalled.addListener((details) => {
  installMenu();
  if (details.reason === 'install') {
    chrome.storage.local.get(['settings']).then((s) => {
      if (!s.settings) chrome.storage.local.set({ settings: DEFAULT_SETTINGS });
    });
  }
});
chrome.runtime.onStartup.addListener(installMenu);

chrome.contextMenus.onClicked.addListener((info, tab) => {
  if (info.menuItemId !== 'xhs-distance' || !tab || !tab.id) return;
  const text = String(info.selectionText || '').trim().slice(0, 60);
  if (!text) return;
  chrome.tabs.sendMessage(tab.id, { type: 'query.text', text }, () => void chrome.runtime.lastError);
});
