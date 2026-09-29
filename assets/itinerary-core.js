/**
 * 날짜별 일정(코스 · 이동 · 주차)과 숙소의 순수 로직 (DOM·네트워크 없음).
 * 브라우저 window.ItineraryCore / 서버 검증·테스트에서 require.
 */
(function (root) {
  'use strict';

  var LIMITS = {
    dayTitleMax: 40, daySummaryMax: 120, freeNoteMax: 200,
    nameMax: 60, subtitleMax: 60, placeMax: 60, durationMax: 30, memoMax: 300, urlMax: 500,
    distanceMax: 999.9, difficultyMax: 5, itemsPerDay: 30,
  };
  var KINDS = ['course', 'move', 'parking'];
  var MOVE_MODES = [
    { key: 'car', label: '자가용', icon: '🚗' },
    { key: 'taxi', label: '택시', icon: '🚕' },
    { key: 'bus', label: '버스', icon: '🚌' },
    { key: 'train', label: '기차', icon: '🚆' },
    { key: 'plane', label: '비행기', icon: '✈️' },
    { key: 'ship', label: '배', icon: '⛴️' },
    { key: 'walk', label: '도보', icon: '🚶' },
    { key: 'other', label: '기타', icon: '🧭' },
  ];
  var TIMINGS = ['before', 'after']; // 코스 전 이동 · 코스 후 이동

  function clean(v) { return v === null || v === undefined ? '' : String(v).trim(); }
  function has(o, k) { return Object.prototype.hasOwnProperty.call(o, k); }

  /** http(s) 링크만 (allowAssets 면 이 사이트 안의 'assets/…' 경로도). 빈 값은 null, 잘못되면 undefined. */
  function safeUrl(value, opts) {
    var v = clean(value);
    if (!v) return null;
    if (v.length > LIMITS.urlMax) return undefined;
    if (opts && opts.allowAssets && /^assets\/[A-Za-z0-9._\-/]+$/.test(v) && v.indexOf('..') < 0) return v;
    if (!/^https?:\/\/[^\s]+$/i.test(v)) return undefined;
    return v;
  }

  /** 지도 링크 종류: 'kakao' | 'naver' | 'google' | 'other' (잘못된 링크면 null) */
  function detectMapProvider(url) {
    var v = safeUrl(url);
    if (!v) return null;
    var host;
    try { host = new URL(v).hostname.toLowerCase(); } catch (e) { return null; }
    var path = v.toLowerCase();
    if (/(^|\.)kko\.to$|(^|\.)map\.kakao\.com$|(^|\.)place\.map\.kakao\.com$|(^|\.)kakaomap\.com$/.test(host)) return 'kakao';
    if (/(^|\.)naver\.me$|(^|\.)map\.naver\.com$|(^|\.)place\.naver\.com$/.test(host)) return 'naver';
    if (/(^|\.)maps\.app\.goo\.gl$|(^|\.)maps\.google\.[a-z.]+$/.test(host) ||
        (/(^|\.)goo\.gl$/.test(host) && path.indexOf('/maps') >= 0) ||
        (/(^|\.)google\.[a-z.]+$/.test(host) && path.indexOf('/maps') >= 0)) return 'google';
    return 'other';
  }

  var MAP_LABEL = { kakao: '카카오맵', naver: '네이버지도', google: '구글 지도', other: '지도' };

  /** ★ 개수 표시 (예: 3 → ★★★☆☆) */
  function stars(n, max) {
    var m = max || LIMITS.difficultyMax;
    var k = Math.max(0, Math.min(m, Math.round(Number(n) || 0)));
    return k ? new Array(k + 1).join('★') + new Array(m - k + 1).join('☆') : '';
  }

  function textField(out, b, key, outKey, max, label, required, partial) {
    if (partial && !has(b, key)) return null;
    var v = clean(b[key]);
    if (required && !v) return label + '을(를) 입력해 주세요.';
    if (v.length > max) return label + '은(는) ' + max + '자 이하로 입력해 주세요.';
    out[outKey] = v || null;
    return null;
  }

  /** 날짜 정보: 제목 · 한줄 설명 · 코스 방식 · 발 닿는대로 메모 (들어온 항목만) */
  function validateDay(input) {
    var b = input || {};
    var out = {};
    var err = textField(out, b, 'title', 'title', LIMITS.dayTitleMax, '제목', false, true) ||
      textField(out, b, 'summary', 'summary', LIMITS.daySummaryMax, '한줄 설명', false, true) ||
      textField(out, b, 'freeNote', 'freeNote', LIMITS.freeNoteMax, '발 닿는대로 메모', false, true);
    if (err) return { error: err };
    if (has(b, 'planMode')) {
      if (['course', 'free'].indexOf(b.planMode) < 0) return { error: '코스 방식이 올바르지 않아요.' };
      out.planMode = b.planMode;
    }
    if (!Object.keys(out).length) return { error: '바꿀 내용이 없어요.' };
    return { value: out };
  }

  function numberOrNull(v) {
    if (v === null || v === undefined || String(v).trim() === '') return null;
    var n = Number(String(v).replace(',', '.'));
    return Number.isFinite(n) ? n : NaN;
  }

  /**
   * 코스 · 이동 · 주차 한 줄 검증. partial 이면 수정(들어온 항목만).
   * → { value } | { error }
   */
  function validateItem(kind, input, opts) {
    if (KINDS.indexOf(kind) < 0) return { error: '알 수 없는 항목이에요.' };
    var b = input || {};
    var partial = !!(opts && opts.partial);
    var out = {};
    var err;
    if (kind === 'course') {
      err = textField(out, b, 'name', 'name', LIMITS.nameMax, '코스 이름', true, partial) ||
        textField(out, b, 'subtitle', 'subtitle', LIMITS.subtitleMax, '부제', false, partial) ||
        textField(out, b, 'fromPlace', 'fromPlace', LIMITS.placeMax, '출발', false, partial) ||
        textField(out, b, 'toPlace', 'toPlace', LIMITS.placeMax, '도착', false, partial) ||
        textField(out, b, 'durationText', 'durationText', LIMITS.durationMax, '걷는 시간', false, partial) ||
        textField(out, b, 'memo', 'memo', LIMITS.memoMax, '메모', false, partial);
      if (err) return { error: err };
      if (!partial || has(b, 'distanceKm')) {
        var d = numberOrNull(b.distanceKm);
        if (Number.isNaN(d) || (d !== null && (d < 0 || d > LIMITS.distanceMax))) return { error: '거리를 km 숫자로 입력해 주세요 (예: 15.0).' };
        out.distanceKm = d === null ? null : Math.round(d * 10) / 10;
      }
      if (!partial || has(b, 'difficulty')) {
        var s = numberOrNull(b.difficulty);
        if (Number.isNaN(s) || (s !== null && (!Number.isInteger(s) || s < 1 || s > LIMITS.difficultyMax))) return { error: '난이도는 1~5 중에서 골라 주세요.' };
        out.difficulty = s;
      }
    } else if (kind === 'move') {
      err = textField(out, b, 'fromPlace', 'fromPlace', LIMITS.placeMax, '출발', false, partial) ||
        textField(out, b, 'toPlace', 'toPlace', LIMITS.placeMax, '도착', false, partial) ||
        textField(out, b, 'memo', 'memo', LIMITS.memoMax, '메모', false, partial);
      if (err) return { error: err };
      if (!partial || has(b, 'mode')) {
        var mode = clean(b.mode) || 'other';
        if (!MOVE_MODES.some(function (m) { return m.key === mode; })) return { error: '이동 수단이 올바르지 않아요.' };
        out.mode = mode;
      }
      if (!partial || has(b, 'timing')) {
        var timing = clean(b.timing) || 'before';
        if (TIMINGS.indexOf(timing) < 0) return { error: '언제 이동하는지 골라 주세요.' };
        out.timing = timing;
      }
      if (!partial && !out.fromPlace && !out.toPlace && !out.memo) return { error: '출발 · 도착 · 메모 중 하나는 적어 주세요.' };
    } else {
      err = textField(out, b, 'name', 'name', LIMITS.nameMax, '주차 장소', true, partial) ||
        textField(out, b, 'memo', 'memo', LIMITS.memoMax, '메모', false, partial);
      if (err) return { error: err };
    }
    if (!partial || has(b, 'mapUrl')) {
      var mu = safeUrl(b.mapUrl);
      if (mu === undefined) return { error: '지도 링크는 https:// 로 시작하는 주소를 붙여넣어 주세요.' };
      out.mapUrl = mu;
    }
    if (!partial || has(b, 'linkUrl')) {
      var lu = safeUrl(b.linkUrl);
      if (lu === undefined) return { error: '참고 링크는 https:// 로 시작하는 주소를 붙여넣어 주세요.' };
      out.linkUrl = lu;
    }
    if (partial && !Object.keys(out).length) return { error: '바꿀 내용이 없어요.' };
    return { value: out };
  }

  /** 하루의 항목을 화면 순서대로: 주차 · 코스 전 이동 → 코스 → 코스 후 이동 (각각 position 순) */
  function groupItems(items) {
    var sorted = (items || []).slice().sort(function (a, b) { return (a.position - b.position) || (a.id - b.id); });
    return {
      parking: sorted.filter(function (i) { return i.kind === 'parking'; }),
      movesBefore: sorted.filter(function (i) { return i.kind === 'move' && i.timing !== 'after'; }),
      courses: sorted.filter(function (i) { return i.kind === 'course'; }),
      movesAfter: sorted.filter(function (i) { return i.kind === 'move' && i.timing === 'after'; }),
    };
  }

  /**
   * 같은 종류(이동은 같은 때) 안에서 한 칸 위/아래로. → 바뀐 [{ id, position }] (못 움직이면 빈 배열)
   */
  function moveItem(items, id, dir) {
    var target = (items || []).find(function (i) { return i.id === id; });
    if (!target || (dir !== -1 && dir !== 1)) return [];
    var same = (items || []).filter(function (i) {
      return i.kind === target.kind && (i.kind !== 'move' || (i.timing === 'after') === (target.timing === 'after'));
    }).sort(function (a, b) { return (a.position - b.position) || (a.id - b.id); });
    var idx = same.findIndex(function (i) { return i.id === id; });
    var other = same[idx + dir];
    if (!other) return [];
    var a = target.position;
    var b = other.position;
    if (a === b) { b = a + dir; } // 같은 순서값이면 벌려 줌
    return [{ id: target.id, position: b }, { id: other.id, position: a }];
  }

  /** 여행 기간(1..days)에 맞춘 날짜 목록 + 저장된 날짜 정보 합치기 */
  function buildDays(startDate, days, rows) {
    var byNo = {};
    (rows || []).forEach(function (r) { byNo[r.dayNo] = r; });
    var start = Date.parse(startDate + 'T00:00:00Z');
    var out = [];
    for (var n = 1; n <= days; n++) {
      var r = byNo[n] || {};
      var d = new Date(start + (n - 1) * 86400000);
      out.push({
        dayNo: n,
        date: d.toISOString().slice(0, 10),
        dateLabel: (d.getUTCMonth() + 1) + '/' + d.getUTCDate() + ' (' + '일월화수목금토'[d.getUTCDay()] + ')',
        id: r.id || null,
        title: r.title || null,
        summary: r.summary || null,
        planMode: r.planMode || 'course',
        freeNote: r.freeNote || null,
        items: r.items || [],
        photos: r.photos || [],
      });
    }
    return out;
  }

  /** 하루에 적힌 게 있는지 (기간을 줄일 때 경고용) */
  function dayHasContent(day) {
    return !!(day && (day.title || day.summary || day.freeNote || (day.items && day.items.length) || (day.photos && day.photos.length)));
  }

  /** 숙소가 묵는 날짜들 ('YYYY-MM-DD' 체크인부터 nights 박) */
  function lodgingNights(checkIn, nights) {
    var start = Date.parse(checkIn + 'T00:00:00Z');
    var out = [];
    for (var i = 0; i < (nights || 1); i++) out.push(new Date(start + i * 86400000).toISOString().slice(0, 10));
    return out;
  }

  /** 12만 3천 원 같은 표시 대신 짧게: 170000 → '17만원', 125000 → '12.5만원', 8000 → '8,000원' */
  function shortWon(n) {
    var v = Number(n);
    if (!Number.isFinite(v)) return '';
    if (v >= 10000) {
      var man = Math.round(v / 1000) / 10;
      return (Number.isInteger(man) ? man : man.toFixed(1)) + '만원';
    }
    return v.toLocaleString('ko-KR') + '원';
  }

  // ---------------------------------------------------------------------------
  // 숙소
  // ---------------------------------------------------------------------------
  var LODGING = { nameMax: 60, memoMax: 300, addressMax: 120, costMax: 1000000000 };

  function dayIndex(startDate, date) {
    var a = Date.parse(startDate + 'T00:00:00Z');
    var b = Date.parse(date + 'T00:00:00Z');
    return Number.isFinite(a) && Number.isFinite(b) ? Math.round((b - a) / 86400000) : NaN;
  }

  /**
   * 숙소 검증. ctx = { startDate, days, travelerIds }.
   * - 체크인은 여행 기간 안, 묵는 밤은 여행 마지막 날 밤까지
   * - 함께 묵는 사람은 이 여행 사람만 (비우면 전원)
   * - addExpense 면 비용(1원 이상) · 결제한 사람(이 여행 사람) · 묵는 사람 1명 이상 필요
   * → { value } | { error }
   */
  function validateLodging(input, ctx) {
    var b = input || {};
    var c = ctx || {};
    var ids = (c.travelerIds || []).map(Number);
    var out = {};
    var err = textField(out, b, 'name', 'name', LODGING.nameMax, '숙소 이름', true, false) ||
      textField(out, b, 'memo', 'memo', LODGING.memoMax, '메모', false, false) ||
      textField(out, b, 'address', 'address', LODGING.addressMax, '주소', false, false);
    if (err) return { error: err };
    var idx = dayIndex(c.startDate, clean(b.checkIn));
    if (!/^\d{4}-\d{2}-\d{2}$/.test(clean(b.checkIn)) || !(idx >= 0 && idx < c.days)) return { error: '체크인 날짜는 여행 기간 안에서 골라 주세요.' };
    out.checkIn = clean(b.checkIn);
    var nights = Number(b.nights === undefined || b.nights === '' ? 1 : b.nights);
    if (!Number.isInteger(nights) || nights < 1) return { error: '몇 박인지 1박 이상으로 골라 주세요.' };
    if (idx + nights > c.days) return { error: '여행 마지막 날 밤까지만 묵을 수 있어요. 박 수를 줄여 주세요.' };
    out.nights = nights;
    var cost = typeof b.cost === 'number' ? b.cost : parseWon(b.cost);
    if (Number.isNaN(cost) || (cost !== null && (!Number.isInteger(cost) || cost < 0 || cost > LODGING.costMax))) return { error: '비용은 숫자로 입력해 주세요 (예: 170000 또는 17만).' };
    out.cost = cost;
    var guests = Array.isArray(b.guestIds) ? b.guestIds.map(Number) : ids.slice();
    guests = guests.filter(function (g, i) { return guests.indexOf(g) === i; });
    if (guests.some(function (g) { return ids.indexOf(g) < 0; })) return { error: '이 여행에 없는 사람이 들어 있어요.' };
    out.guestIds = guests;
    var mu = safeUrl(b.mapUrl);
    if (mu === undefined) return { error: '지도 링크는 https:// 로 시작하는 주소를 붙여넣어 주세요.' };
    out.mapUrl = mu;
    var lu = safeUrl(b.linkUrl);
    if (lu === undefined) return { error: '참고 링크는 https:// 로 시작하는 주소를 붙여넣어 주세요.' };
    out.linkUrl = lu;
    out.addExpense = !!b.addExpense;
    if (out.addExpense) {
      if (!(cost > 0)) return { error: '숙소비를 지출에 추가하려면 비용을 입력해 주세요.' };
      if (!guests.length) return { error: '숙소비를 나눠 낼 사람(함께 묵는 사람)을 한 명 이상 골라 주세요.' };
      var payer = Number(b.payerId);
      if (ids.indexOf(payer) < 0) return { error: '결제한 사람을 골라 주세요.' };
      out.payerId = payer;
    }
    return { value: out };
  }

  /** '170,000원' · '17만' · '12.5만원' → 숫자 (비었으면 null, 못 읽으면 NaN) */
  function parseWon(v) {
    var t = clean(v).replace(/[,\s]/g, '').replace(/원$/, '');
    if (!t) return null;
    var m = /^(\d+(?:\.\d+)?)만$/.exec(t);
    if (m) return Math.round(Number(m[1]) * 10000);
    return /^\d+$/.test(t) ? Number(t) : NaN;
  }

  /** 1인당 금액 (반올림, 모르면 null) */
  function perPersonCost(cost, count) {
    if (cost === null || cost === undefined || !(count > 0)) return null;
    return Math.round(cost / count);
  }

  /** 숙소와 연결된 지출 기록의 설명 */
  function lodgingExpenseDescription(l) {
    return '숙소 · ' + l.name + (l.nights > 1 ? ' (' + l.nights + '박)' : '');
  }

  /**
   * 밤마다 숙소 배정 확인. dates 는 확인할 밤들('YYYY-MM-DD'), travelerIds 는 여행 사람.
   * → { 'YYYY-MM-DD': { lodgingIds: [], doubled: [id…], missing: [id…] } }
   * 숙소가 하나도 없는 밤은 missing 을 비워 둠 (아직 안 정한 밤으로 봄).
   */
  function nightlyCoverage(dates, lodgings, travelerIds) {
    var out = {};
    (dates || []).forEach(function (date) {
      var here = (lodgings || []).filter(function (l) { return lodgingNights(l.checkIn, l.nights).indexOf(date) >= 0; });
      var count = {};
      here.forEach(function (l) { (l.guestIds || []).forEach(function (g) { count[g] = (count[g] || 0) + 1; }); });
      out[date] = {
        lodgingIds: here.map(function (l) { return l.id; }),
        doubled: (travelerIds || []).filter(function (t) { return count[t] > 1; }),
        missing: here.length ? (travelerIds || []).filter(function (t) { return !count[t]; }) : [],
      };
    });
    return out;
  }

  // ---------------------------------------------------------------------------
  // 미리보기 사진
  // ---------------------------------------------------------------------------
  var PREVIEW = { perDay: 10, captionMax: 100, maxEdge: 1600, thumbEdge: 480 };

  /** 이 여행의 미리보기 사진 저장 위치 (Vercel Blob · trips/<id>/preview/) 인지 */
  function isPreviewUrl(url, tripId) {
    var v = safeUrl(url);
    if (!v) return false;
    var u;
    try { u = new URL(v); } catch (e) { return false; }
    return u.protocol === 'https:' && /\.blob\.vercel-storage\.com$/.test(u.hostname) &&
      new RegExp('^/trips/' + Number(tripId) + '/preview/[A-Za-z0-9._-]+$').test(u.pathname);
  }

  /** 미리보기 사진 등록값 검증 → { value } | { error } */
  function validateDayPhoto(input, tripId, currentCount) {
    var b = input || {};
    if ((currentCount || 0) >= PREVIEW.perDay) return { error: '미리보기 사진은 하루에 ' + PREVIEW.perDay + '장까지 넣을 수 있어요.' };
    if (!isPreviewUrl(b.url, tripId) || !isPreviewUrl(b.thumbUrl || b.url, tripId)) return { error: '올린 사진 주소가 올바르지 않아요.' };
    var caption = clean(b.caption);
    if (caption.length > PREVIEW.captionMax) return { error: '사진 설명은 ' + PREVIEW.captionMax + '자 이하로 입력해 주세요.' };
    var w = Number(b.width);
    var h = Number(b.height);
    return {
      value: {
        url: clean(b.url), thumbUrl: clean(b.thumbUrl || b.url), caption: caption || null,
        width: Number.isInteger(w) && w > 0 ? w : null, height: Number.isInteger(h) && h > 0 ? h : null,
      },
    };
  }

  /** 미리보기 사진 저장 경로 (브라우저에서 만들어 올림) */
  function previewPath(tripId, kind, nowMs, rand) {
    var safe = String(rand || '').replace(/[^A-Za-z0-9]/g, '');
    return 'trips/' + Number(tripId) + '/preview/' + nowMs + '-' + safe + (kind === 'thumb' ? '-t' : '') + '.jpg';
  }

  var ItineraryCore = {
    LIMITS: LIMITS, KINDS: KINDS, MOVE_MODES: MOVE_MODES, TIMINGS: TIMINGS, MAP_LABEL: MAP_LABEL,
    safeUrl: safeUrl, detectMapProvider: detectMapProvider, stars: stars,
    validateDay: validateDay, validateItem: validateItem, groupItems: groupItems, moveItem: moveItem,
    buildDays: buildDays, dayHasContent: dayHasContent, lodgingNights: lodgingNights, shortWon: shortWon,
    PREVIEW: PREVIEW, isPreviewUrl: isPreviewUrl, validateDayPhoto: validateDayPhoto, previewPath: previewPath,
    LODGING: LODGING, validateLodging: validateLodging, perPersonCost: perPersonCost, parseWon: parseWon,
    lodgingExpenseDescription: lodgingExpenseDescription, nightlyCoverage: nightlyCoverage,
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = ItineraryCore;
  if (root) root.ItineraryCore = ItineraryCore;
})(typeof window !== 'undefined' ? window : null);
