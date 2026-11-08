/*!
 * geo.js — 坐标换算 / 距离 / 地图链接
 * 坐标系说明：
 *  - 百度地图返回的是 BD09 墨卡托(MC)坐标，这里统一换算成 BD09 经纬度保存
 *  - 高德/腾讯/微信使用 GCJ02，所以给高德出链接前要做 BD09 -> GCJ02
 *  - 计算距离用 BD09 经纬度做球面距离即可（两点偏移量相同，误差可忽略）
 */
(function (root, factory) {
  var Geo = factory();
  root.Geo = Geo;
  if (typeof module !== 'undefined' && module.exports) module.exports = Geo;
})(typeof self !== 'undefined' ? self : globalThis, function () {
  'use strict';

  var PI = Math.PI;
  var X_PI = (PI * 3000.0) / 180.0;
  var EARTH_R = 6371008.8;

  // 百度 MC 坐标反算经纬度所用的分段系数（官方 JS 实现中的常量）
  var MCBAND = [12890594.86, 8362377.87, 5591021, 3481989.83, 1678043.12, 0];
  var MC2LL = [
    [1.410526172116255e-8, 8.98305509648872e-6, -1.9939833816331, 200.9824383106796, -187.2403703815547, 91.6087516669843, -23.38765649603339, 2.57121317296198, -0.03801003308653, 17337981.2],
    [-7.435856389565537e-9, 8.983055097726239e-6, -0.78625201886289, 96.32687599759846, -1.85204757529826, -59.36935905485877, 47.40033549296737, -16.50741931063887, 2.28786674699375, 10260144.86],
    [-3.030883460898826e-8, 8.98305509983578e-6, 0.30071316287616, 59.74293618442277, 7.357984074871, -25.38371002664745, 13.45380521110908, -3.29883767235584, 0.32710905363475, 6856817.37],
    [-1.981981304930552e-8, 8.983055099779535e-6, 0.03278182852591, 40.31678527705744, 0.65659298677277, -4.44255534477492, 0.85341911805263, 0.12923347998204, -0.04625736007561, 4482777.06],
    [3.09191371068437e-9, 8.983055096812155e-6, 6.957856341986e-5, 23.10934304144901, -0.00023663490511, -0.6321817810242, -0.00663494467273, 0.03430082397953, -0.00466043876332, 2555164.4],
    [2.890871144776878e-9, 8.983055095805407e-6, -3.068298e-8, 7.47137025468032, -3.53937994e-6, -0.02145144861037, -1.234426596e-5, 3.295032423e-5, -3.196148e-6, 323248.0]
  ];

  /**
   * 百度墨卡托坐标 -> BD09 经纬度
   * @param {number} mcX 墨卡托 x（米）
   * @param {number} mcY 墨卡托 y（米）
   */
  function mc2ll(mcX, mcY) {
    if (!isFinite(mcX) || !isFinite(mcY)) return null;
    var cF = null;
    var absY = Math.abs(mcY);
    for (var i = 0; i < MCBAND.length; i++) {
      if (absY >= MCBAND[i]) { cF = MC2LL[i]; break; }
    }
    if (!cF) return null;
    var cD = cF[0] + cF[1] * Math.abs(mcX);
    var cE = absY / cF[9];
    var lat = cF[2] + cF[3] * cE + cF[4] * cE * cE + cF[5] * cE * cE * cE +
      cF[6] * Math.pow(cE, 4) + cF[7] * Math.pow(cE, 5) + cF[8] * Math.pow(cE, 6);
    return { lng: cD * (mcX < 0 ? -1 : 1), lat: lat * (mcY < 0 ? -1 : 1) };
  }

  /** BD09 -> GCJ02（高德/腾讯系） */
  function bd2gcj(bdLng, bdLat) {
    var x = bdLng - 0.0065;
    var y = bdLat - 0.006;
    var z = Math.sqrt(x * x + y * y) - 0.00002 * Math.sin(y * X_PI);
    var theta = Math.atan2(y, x) - 0.000003 * Math.cos(x * X_PI);
    return { lng: z * Math.cos(theta), lat: z * Math.sin(theta) };
  }

  /** 两点球面距离（米） */
  function haversine(lng1, lat1, lng2, lat2) {
    if ([lng1, lat1, lng2, lat2].some(function (v) { return !isFinite(v); })) return Infinity;
    var rad = PI / 180;
    var dLat = (lat2 - lat1) * rad;
    var dLng = (lng2 - lng1) * rad;
    var a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
      Math.cos(lat1 * rad) * Math.cos(lat2 * rad) * Math.sin(dLng / 2) * Math.sin(dLng / 2);
    return 2 * EARTH_R * Math.asin(Math.min(1, Math.sqrt(a)));
  }

  /** 距离格式化：320m / 1.2km / 12km */
  function fmtDist(m) {
    if (!isFinite(m)) return '—';
    if (m < 1000) return Math.max(10, Math.round(m / 10) * 10) + 'm';
    if (m < 10000) return (m / 1000).toFixed(1).replace(/\.0$/, '') + 'km';
    return Math.round(m / 1000) + 'km';
  }

  /** 高德 marker 链接（网页版，GCJ02） */
  function amapMarker(lng, lat, name) {
    var g = bd2gcj(lng, lat);
    return 'https://uri.amap.com/marker?position=' + g.lng.toFixed(6) + ',' + g.lat.toFixed(6) +
      '&name=' + encodeURIComponent(name || '位置') + '&coordinate=gaode&callnative=0&src=xhs-house-distance';
  }

  /** 高德公交/驾车路线链接（网页版，GCJ02） */
  function amapRoute(fromLng, fromLat, fromName, toLng, toLat, toName, mode) {
    var g1 = bd2gcj(fromLng, fromLat);
    var g2 = bd2gcj(toLng, toLat);
    return 'https://uri.amap.com/navigation?from=' + g1.lng.toFixed(6) + ',' + g1.lat.toFixed(6) + ',' +
      encodeURIComponent(fromName || '起点') +
      '&to=' + g2.lng.toFixed(6) + ',' + g2.lat.toFixed(6) + ',' + encodeURIComponent(toName || '终点') +
      '&mode=' + (mode || 'bus') + '&coordinate=gaode&callnative=0&src=xhs-house-distance';
  }

  /** 百度地图 marker 链接（BD09） */
  function baiduMarker(lng, lat, name) {
    return 'https://map.baidu.com/?latlng=' + lat.toFixed(6) + ',' + lng.toFixed(6) +
      '&title=' + encodeURIComponent(name || '位置') + '&output=html';
  }

  return {
    mc2ll: mc2ll,
    bd2gcj: bd2gcj,
    haversine: haversine,
    fmtDist: fmtDist,
    amapMarker: amapMarker,
    amapRoute: amapRoute,
    baiduMarker: baiduMarker
  };
});
