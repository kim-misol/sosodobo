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

  var ItineraryCore = {
    LIMITS: LIMITS, KINDS: KINDS, MOVE_MODES: MOVE_MODES, TIMINGS: TIMINGS, MAP_LABEL: MAP_LABEL,
    safeUrl: safeUrl, detectMapProvider: detectMapProvider, stars: stars,
    validateDay: validateDay, validateItem: validateItem, groupItems: groupItems, moveItem: moveItem,
    buildDays: buildDays, dayHasContent: dayHasContent, lodgingNights: lodgingNights, shortWon: shortWon,
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = ItineraryCore;
  if (root) root.ItineraryCore = ItineraryCore;
})(typeof window !== 'undefined' ? window : null);
