window.addEventListener('error', function (e) { document.title = 'JSERR ' + e.message; });
window.addEventListener('unhandledrejection', function (e) { document.title = 'JSREJ ' + (e.reason && (e.reason.message || e.reason)); });
/* 测试用假后台：模拟 background.js 的消息，不联网 */
const POIS = [
  { name: "上地·元中心", addr: "北京市海淀区西二旗西路16号院", tag: "公司企业;园区", lng: 116.32278, lat: 40.05586, mcX: 12949133.21, mcY: 4846307.83, uid: "bfde5b72ce7ec654100daac8", cityId: 131 },
  { name: "燕尚园", addr: "西二旗西路4号", tag: "房地产;住宅区", lng: 116.32003, lat: 40.05466, mcX: 12948827.87, mcY: 4846133.84, uid: "593850fb2dc5fe5dde1e52aa", cityId: 131 },
  { name: "润中苑", addr: "北京市海淀区西二旗南路6号", tag: "房地产;住宅区", lng: 116.31807, lat: 40.05416, mcX: 12948609.46, mcY: 4846061.24, uid: "81d03fe5588b4958882fb5f7", cityId: 131 },
  { name: "铭科苑小区", addr: "北京市海淀区安宁庄西路29号", tag: "房地产;住宅区", lng: 116.32142, lat: 40.05781, mcX: 12948981.98, mcY: 4846590.55, uid: "08fc93df22f91d919a68b4ab", cityId: 131 },
  { name: "西二旗智学苑", addr: "北京市海淀区西二旗西路29号", tag: "房地产;住宅区", lng: 116.31731, lat: 40.05644, mcX: 12948524.67, mcY: 4846391.8, uid: "04bdf4a3aea5504c344aae96", cityId: 131 },
  { name: "上第MOMA", addr: "安宁庄路1号", tag: "房地产;住宅区", lng: 116.32448, lat: 40.05138, mcX: 12949322.87, mcY: 4845657.9, uid: "3519c830b39805dec356ac0b", cityId: 131 },
  { name: "金隅凤栖家园", addr: "北京市海淀区安宁庄路(上林溪西北侧)", tag: "房地产;住宅区", lng: 116.329, lat: 40.05353, mcX: 12949825.49, mcY: 4845969.67, uid: "1c480b8030b296be0b1cc7c5", cityId: 131 },
  { name: "当代城市家园", addr: "北京市海淀区安宁庄西路9号", tag: "房地产;住宅区", lng: 116.32554, lat: 40.04932, mcX: 12949440.61, mcY: 4845360.59, uid: "c7b220c24dc08ff6c7f50d2a", cityId: 131 },
  { name: "领秀新硅谷", addr: "北京市海淀区清河街道", tag: "房地产;住宅区", lng: 116.3163, lat: 40.06113, mcX: 12948412.41, mcY: 4847070.55, uid: "aa40108becd3d015c4effbab", cityId: 131 },
  { name: "博雅德园", addr: "北京市海淀区西二旗北路与西二旗中路交叉口", tag: "房地产;住宅区", lng: 116.32039, lat: 40.06352, mcX: 12948867.09, mcY: 4847417.46, uid: "35debf29053bde44a7da39ab", cityId: 131 },
  { name: "安宁庄路11号院", addr: "北京市海淀区西二旗安宁庄路11号院", tag: "房地产;住宅区", lng: 116.32765, lat: 40.06164, mcX: 12949675.95, mcY: 4847145.12, uid: "4da4d15b2a6f432581288a69", cityId: 131 },
  { name: "融科资讯中心", addr: "北京市海淀区科学院南路2号", tag: "公司企业;园区", lng: 116.33273, lat: 39.98972, mcX: 12950240.67, mcY: 4836730.93, uid: "9c84151dd917923b4afd3f14", cityId: 131 },
  { name: "国贸三期", addr: "北京市朝阳区光华路甲十七号", tag: "房地产;写字楼", lng: 116.4651, lat: 39.9182, mcX: 12964976.45, mcY: 4826386.33, uid: "21d1a2a0320d98a5c61b7505", cityId: 131 },
  { name: "望京西园三区", addr: "北京市朝阳区望京街道宏昌路", tag: "房地产;住宅区", lng: 116.48222, lat: 40.00586, mcX: 12966882.88, mcY: 4839067.44, uid: "5c5631c068d65e52c7f50d76", cityId: 131 },
  { name: "万和嘉园", addr: "北京市海淀区土井村路", tag: "房地产;住宅区", lng: 116.28826, lat: 40.07181, mcX: 12945291.05, mcY: 4848617.59, uid: "05d77ae45247366cf32d83fe", cityId: 131 },
  { name: "上地佳园", addr: "北京市海淀区上地东路", tag: "房地产;住宅区", lng: 116.32468, lat: 40.03814, mcX: 12949345.38, mcY: 4843740.45, uid: "fb6fdd263ec6b813364aaefa", cityId: 131 },
  { name: "望京SOHO", addr: "北京市朝阳区望京街10号", tag: "房地产;写字楼", lng: 116.48763, lat: 40.00257, mcX: 12967485.13, mcY: 4838591.55, uid: "150c4406d3e2d69a5a3ac854", cityId: 131 },
  { name: "望京花园(东区)", addr: "北京市朝阳区利泽中二路第八十中学对面", tag: "房地产;住宅区", lng: 116.48201, lat: 40.01357, mcX: 12966858.78, mcY: 4840183.28, uid: "8749d50a8e9c9de448cc4a88", cityId: 131 },
  { name: "苹果派", addr: "北京市朝阳区黄渠东路2号院13号楼", tag: "房地产;住宅区", lng: 116.58477, lat: 39.93559, mcX: 12978298.33, mcY: 4828899.96, uid: "08fc93df22f91d919a68b4ab", cityId: 131 }
];

const ANCHORS = location.search.includes('onboard=1') ? [] : [
  { id: 'a1', name: '公司', addr: '融科资讯中心', lng: 116.32582, lat: 39.98333, mcX: 12949739.0, mcY: 4836522.0, uid: 'c2f1e0d0d0d0d0d0d0d0d0d0' },
  { id: 'a2', name: '常去的健身房', addr: '望京SOHO', lng: 116.48763, lat: 40.00257, mcX: 12967485.13, mcY: 4838591.55, uid: '150c4406d3e2d69a5a3ac854' }
];
const SETTINGS = { city: 131, cityName: '北京', autoTag: true, subway: true, pinned: location.search.includes('pinned=1') };

window.chrome = {
  runtime: {
    lastError: null,
    sendMessage(msg, cb) {
      setTimeout(() => cb(window.__mock(msg)), 60);
    },
    onMessage: { addListener() {} }
  }
};

function distTo(a, b) {
  const R = 6371008.8, rad = Math.PI / 180;
  const dLat = (b.lat - a.lat) * rad, dLng = (b.lng - a.lng) * rad;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

function fakeRoute(poi) {
  const a = ANCHORS[0];
  const d = distTo(a, poi);
  const t = Math.round((d / 260 + 12) * 60);           // 假的地铁时长
  const walk = Math.round(d * 0.12 + 260);
  return {
    transit: {
      best: {
        time: t, distance: Math.round(d * 1.25), price: d > 9000 ? 5 : 4,
        walkDistance: walk, walkTime: Math.round(walk / 1.2),
        lines: [{ name: d > 8000 ? '地铁13号线' : '地铁13号线', type: 1 }, { name: '地铁10号线', type: 1 }],
        transfers: 1,
        hasSubway: true
      },
      all: []
    },
    drive: { distance: Math.round(d * 1.35), time: Math.round((d / 380 + 9) * 60), taxiPrice: Math.round(14 + d * 1.35 / 1000 * 2.3) },
    subway: { name: '西二旗', dist: 800 }
  };
}

window.__mock = function (msg) {
  if (msg.type === 'state.get') return { ok: true, anchors: ANCHORS, settings: SETTINGS };
  if (msg.type === 'anchors.set') return { ok: true };
  if (msg.type === 'settings.set') return { ok: true };
  if (msg.type === 'subway') return { ok: true, subway: { name: '西二旗', dist: 800 } };
  if (msg.type === 'resolve') {
    let best = null, bs = 0;
    POIS.forEach((p) => {
      const s = Detect.score(msg.q, p.name);
      if (s > bs) { bs = s; best = p; }
    });
    if (bs < 0.6) best = null;
    return { ok: true, poi: best, subway: best ? { name: '西二旗', dist: 800 } : null };
  }
  if (msg.type === 'search') {
    const q = msg.q;
    const list = POIS
      .map((p) => Object.assign({ matchScore: Detect.score(q, p.name) }, p))
      .sort((a, b) => b.matchScore - a.matchScore)
      .slice(0, 6);
    return { ok: true, list };
  }
  if (msg.type === 'poi.detail' || msg.type === 'route.only') {
    const r = fakeRoute(msg.poi);
    if (msg.type === 'route.only') return { ok: true, transit: r.transit, drive: msg.withDrive === false ? null : r.drive };
    return { ok: true, transit: r.transit, drive: r.drive, subway: r.subway };
  }
  return { ok: false };
};
