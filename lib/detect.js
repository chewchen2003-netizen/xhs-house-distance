/*!
 * detect.js — 从一段中文文案里猜「小区/地点名」，并判断它和地图 POI 是否是同一个地方
 */
(function (root, factory) {
  var Detect = factory();
  root.Detect = Detect;
  if (typeof module !== 'undefined' && module.exports) module.exports = Detect;
})(typeof self !== 'undefined' ? self : globalThis, function () {
  'use strict';

  // 长后缀放前面，先匹配更具体的
  var SUFFIX = [
    '小区', '花园', '家园', '新城', '新村', '公寓', '佳苑', '雅苑', '嘉园', '华庭', '华府',
    '公馆', '大厦', '广场', '中心', '社区', '号院', '大院', '山庄', '别墅', '人家',
    'SOHO', 'soho', 'Loft', 'loft', 'MOMA', 'moma',
    '苑', '园', '里', '城', '府', '湾', '庭', '邸', '墅', '院', '庄'
  ];

  var LEAD_NOISE = ['位于', '这里', '这个', '那个', '我在', '我住', '就是', '还有', '所在', '附近', '周边', '推荐', '坐标',
    '旁边是', '附近是', '对面是', '周边是', '旁边有', '附近有', '对面有', '这里是', '这就是', '地址是', '小区叫', '叫做'];
  var LEAD_CHAR = ['的', '在', '了', '是', '和', '与', '到', '离', '距', '我', '这', '那', '个', '一', '套', '房', '看', '住', '买', '租', '去', '从', '有', '旁', '边', '对', '面', '周', '附', '近'];

  // 清单类文案里常见、但不是地名的一行
  var NOISE_LINE = /入住|预算|要求|步行|距离|优先|小区|房源|房子|合同|装修|家电|家具|房租|押金|微信|电话|联系|中介|房东|转租|合租|整租|主卧|次卧|朝南|朝北|供暖|采光|楼层|电梯|燃气|水电|本人|个人|看房|附近|交通|通勤|室友|签|租期|面积|户型|合租|费用|收费|费用|包|含|元|千|万/;

  // 明显不是小区名的词，直接丢掉
  var STOP = [
    '小区', '花园', '家园', '中心', '广场', '大厦', '公寓', '社区', '公园', '商场', '超市',
    '写字楼', '地铁站', '公交站', '停车场', '购物中心', '儿童乐园', '游乐园', '菜市场',
    // 带「院/园/里」但与小区无关的常见词
    '医院', '学院', '法院', '剧院', '影院', '寺院', '四合院', '院子', '校园', '公园里',
    '公里', '里', '城里', '园里', '公里内', '时间', '房间', '空间', '中间', '里面',
    // 租房文案里的高频词，避免浪费查询
    '预算', '要求', '主卧', '次卧', '朝南', '朝北', '入住', '房东', '中介', '转租', '合租',
    '整租', '押金', '微信', '电话', '优先', '供暖', '装修', '采光', '楼层', '电梯', '家具',
    '家电', '步行', '距离', '附近', '联系', '看房', '合同', '本人', '个人', '水电', '燃气'
  ];

  function uniq(arr) {
    var seen = Object.create(null), out = [];
    for (var i = 0; i < arr.length; i++) {
      if (!seen[arr[i]]) { seen[arr[i]] = 1; out.push(arr[i]); }
    }
    return out;
  }

  /**
   * 从文案中提取候选地名。
   * 例："望京西园三区 一居室 5000，离望京SOHO很近" -> ["望京西园三区", "望京SOHO", ...]
   */
  function candidates(text, limit, opts) {
    limit = limit || 6;
    opts = opts || {};
    if (!text) return [];

    var src = String(text).replace(/\r/g, '');
    var lines = src.split('\n').map(function (l) { return l.trim(); }).filter(Boolean);
    var raw = [];

    // A. 一行一个的清单（笔记里最常见的写法）
    if (opts.lines) {
      var lineHits = 0;
      for (var li = 0; li < lines.length && lineHits < 12; li++) {
        var t = lines[li]
          .replace(/^\s*[0-9]{1,2}\s*[.、)）:：]\s*/, '')
          .replace(/^[-–—·•*]\s*/, '')
          .trim();
        if (!t || t.length < 2 || t.length > 14) continue;
        if (/[，。！？；：,;!?、:"“”()（）\[\]【】]/.test(t)) continue;  // 带句读/括号的多半是句子
        if (t.indexOf(' ') >= 0) continue;                 // 表格式的行跳过
        if (/^[0-9.]+$/.test(t)) continue;
        if (/^#/.test(t)) continue;
        if (NOISE_LINE.test(t)) continue;                  // 租房文案里的常见短句
        lineHits++;
        raw.push(t);
      }
    }

    // B. 行内出现的「XX小区 / XX苑 / XXSOHO」
    var suffixPart = SUFFIX.map(function (x) {
      return x.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    }).join('|');
    var re = new RegExp('([\\u4e00-\\u9fa5A-Za-z0-9\\u00b7]{2,10}(?:' + suffixPart + '))', 'g');

    function scan(chunk) {
      var m;
      re.lastIndex = 0;
      while ((m = re.exec(chunk)) !== null) {
        var hit = m[1];
        var rest = chunk.slice(m.index + hit.length);
        var zone = /^([一二三四五六七八九十0-9]{1,2}区|[东西南北]区|二期|三期|一期)/.exec(rest);
        if (zone) hit += zone[1];
        raw.push(hit);
        if (m.index === re.lastIndex) re.lastIndex++;
      }
    }
    lines.forEach(scan);
    scan(src.replace(/\s+/g, ' '));

    // C. 中文 + 英文名（上第MONA / 建外SOHO 这种没有后缀的）
    var reEn = /([\u4e00-\u9fa5]{2,6}[A-Za-z]{2,6})/g;
    var me;
    while ((me = reEn.exec(src)) !== null) raw.push(me[1]);

    var cleaned = [];
    for (var i = 0; i < raw.length; i++) {
      var c = cleanName(raw[i]);
      if (c) cleaned.push(c);
    }
    cleaned = uniq(cleaned);

    // 「北京西二旗上地元中心」结尾是「上地元中心」-> 只留更具体的那个
    var out = cleaned.filter(function (x) {
      return !cleaned.some(function (y) {
        return y !== x && y.length >= 3 && y.length < x.length && x.slice(x.length - y.length) === y;
      });
    });
    return out.slice(0, limit);
  }

  /** 清洗候选名：去前缀噪音、去 "朝阳区" 这类行政前缀 */
  function cleanName(input) {
    var c = String(input || '').trim();
    if (!c) return '';

    // 反复去掉 "位于/旁边是/的" 这类前缀
    for (var guard = 0; guard < 6; guard++) {
      var before = c;
      LEAD_NOISE.forEach(function (w) {
        if (c.indexOf(w) === 0 && c.length > w.length + 2) c = c.slice(w.length);
      });
      // "朝阳区常营苹果派小区" -> "常营苹果派小区"
      var admin = /^[\u4e00-\u9fa5]{2,4}(?:区|市|县)(?=[\u4e00-\u9fa5A-Za-z0-9])/.exec(c);
      if (admin && c.length - admin[0].length >= 5) c = c.slice(admin[0].length);
      while (c.length > 3 && LEAD_CHAR.indexOf(c[0]) >= 0) c = c.slice(1);
      c = c.replace(/^[0-9号栋幢区县\-—]+/, '');
      if (c === before) break;
    }

    if (c.length < 3 || c.length > 14) return '';
    if (STOP.indexOf(c) >= 0) return '';
    if (/^[0-9]+$/.test(c)) return '';
    return c;
  }

  /** 归一化：去括号内容、标点、常见前缀/后缀噪音 */
  function norm(s) {
    return String(s || '')
      // 括号里的 "东区/一期/北门" 往往是有用信息，保留内容只去掉括号
      .replace(/[（(【\[]/g, '')
      .replace(/[）)】\]]/g, '')
      .replace(/[\s·・\-—_.,，。!！?？:：;；'"“”‘’、]/g, '')
      .replace(/^(北京市|北京)/, '')
      .toLowerCase();
  }

  /** 双字切片重合度（Dice 系数） */
  function dice(a, b) {
    if (!a || !b) return 0;
    if (a === b) return 1;
    var A = [], B = [], i;
    for (i = 0; i < a.length - 1; i++) A.push(a.slice(i, i + 2));
    for (i = 0; i < b.length - 1; i++) B.push(b.slice(i, i + 2));
    if (!A.length || !B.length) return a === b ? 1 : 0;
    var map = Object.create(null), hit = 0;
    A.forEach(function (g) { map[g] = (map[g] || 0) + 1; });
    B.forEach(function (g) {
      if (map[g]) { map[g]--; hit++; }
    });
    return (2 * hit) / (A.length + B.length);
  }

  /** 候选名与 POI 名的匹配分 0~1 */
  function score(query, poiName) {
    var q = norm(query), p = norm(poiName);
    if (!q || !p) return 0;
    if (q === p) return 1;
    if (q.length >= 3 && p.indexOf(q) >= 0) return 0.98;
    if (p.length >= 3 && q.indexOf(p) >= 0) return 0.9;
    var d = dice(q, p);
    // 去掉尾部的 "三区/北门" 等再比一次
    var q2 = q.replace(/([一二三四五六七八九十0-9]+区|北门|南门|东门|西门|店|院)$/, '');
    var p2 = p.replace(/([一二三四五六七八九十0-9]+区|北门|南门|东门|西门|店|院)$/, '');
    if (q2 !== q || p2 !== p) d = Math.max(d, dice(q2, p2));
    return d;
  }

  /** 判断 POI 类型是否像住宅/小区 */
  function looksResidential(tag) {
    return /房地产|住宅|公寓|楼盘|小区/.test(tag || '');
  }

  return { candidates: candidates, score: score, norm: norm, dice: dice, looksResidential: looksResidential };
});
