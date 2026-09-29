/**
 * 여행 만들기·수정의 순수 로직 (DOM·네트워크 없음). 브라우저 window.TripCore / 서버·테스트 require.
 */
(function (root) {
  'use strict';

  var LIMITS = { titleMax: 40, summaryMax: 80, regionMax: 40, maxDays: 90, nameMax: 40 };
  var DAY_MS = 24 * 60 * 60 * 1000;
  var VISIBILITY = ['private', 'link'];

  function parseDate(s) {
    if (typeof s !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return NaN;
    var ms = Date.parse(s + 'T00:00:00Z');
    // 2026-02-30 같은 없는 날짜 거르기
    return Number.isFinite(ms) && new Date(ms).toISOString().slice(0, 10) === s ? ms : NaN;
  }

  /** 시작일~마지막 날 → 일수 (둘 다 포함). 잘못되면 NaN. */
  function tripDays(startDate, endDate) {
    var a = parseDate(startDate);
    var b = parseDate(endDate);
    if (!Number.isFinite(a) || !Number.isFinite(b)) return NaN;
    return Math.round((b - a) / DAY_MS) + 1;
  }

  function cleanText(v) {
    return v === null || v === undefined ? '' : String(v).trim();
  }

  /**
   * 여행 기본 정보 검증. partial 이면 들어온 항목만 (수정용), current 는 수정 전 값(날짜 비교용).
   * → { value: {...} } | { error }
   */
  function validateTrip(input, opts) {
    var b = input || {};
    var o = opts || {};
    var partial = !!o.partial;
    var cur = o.current || {};
    var has = function (k) { return Object.prototype.hasOwnProperty.call(b, k); };
    var out = {};

    if (!partial || has('title')) {
      var title = cleanText(b.title);
      if (!title) return { error: '여행 이름을 입력해 주세요.' };
      if (title.length > LIMITS.titleMax) return { error: '여행 이름은 ' + LIMITS.titleMax + '자 이하로 입력해 주세요.' };
      out.title = title;
    }
    if (!partial || has('region')) {
      var region = cleanText(b.region);
      if (!region) return { error: '지역을 입력해 주세요.' };
      if (region.length > LIMITS.regionMax) return { error: '지역은 ' + LIMITS.regionMax + '자 이하로 입력해 주세요.' };
      out.region = region;
    }
    if (!partial || has('summary')) {
      var summary = cleanText(b.summary);
      if (summary.length > LIMITS.summaryMax) return { error: '한줄 설명은 ' + LIMITS.summaryMax + '자 이하로 입력해 주세요.' };
      out.summary = summary || null;
    }
    if (!partial || has('startDate') || has('endDate')) {
      var start = has('startDate') ? b.startDate : cur.startDate;
      var end = has('endDate') ? b.endDate : cur.endDate;
      if (!Number.isFinite(parseDate(start))) return { error: '시작일을 골라 주세요.' };
      if (!Number.isFinite(parseDate(end))) return { error: '마지막 날을 골라 주세요.' };
      var days = tripDays(start, end);
      if (days < 1) return { error: '마지막 날은 시작일과 같거나 뒤여야 해요.' };
      if (days > LIMITS.maxDays) return { error: '여행 기간은 최대 ' + LIMITS.maxDays + '일까지 만들 수 있어요.' };
      out.startDate = start;
      out.endDate = end;
    }
    if (!partial || has('visibility')) {
      var vis = has('visibility') ? b.visibility : 'private';
      if (VISIBILITY.indexOf(vis) < 0) return { error: '공개 설정이 올바르지 않아요.' };
      out.visibility = vis;
    }
    if (has('membersCanEdit')) {
      if (typeof b.membersCanEdit !== 'boolean') return { error: '수정 권한 설정이 올바르지 않아요.' };
      out.membersCanEdit = b.membersCanEdit;
    } else if (!partial) {
      out.membersCanEdit = true;
    }
    if (partial && !Object.keys(out).length) return { error: '바꿀 내용이 없어요.' };
    return { value: out };
  }

  /** 여행 목록을 다가오는(출발 전·여행 중) / 지난 여행으로. todayStr 은 한국 날짜 'YYYY-MM-DD'. */
  function splitTrips(trips, todayStr) {
    var upcoming = [];
    var past = [];
    (trips || []).forEach(function (t) { (t.endDate < todayStr ? past : upcoming).push(t); });
    upcoming.sort(function (a, b) { return a.startDate < b.startDate ? -1 : a.startDate > b.startDate ? 1 : a.id - b.id; });
    past.sort(function (a, b) { return a.startDate > b.startDate ? -1 : a.startDate < b.startDate ? 1 : b.id - a.id; });
    return { upcoming: upcoming, past: past };
  }

  /** 처음 볼 여행: 주소의 여행 → 지난번에 본 여행 → 가장 가까운 다가오는 여행 → 가장 최근 지난 여행. */
  function pickTrip(trips, wantedId, lastId, todayStr) {
    var list = trips || [];
    var byId = function (id) { return list.find(function (t) { return t.id === id; }) || null; };
    if (Number.isInteger(wantedId) && byId(wantedId)) return byId(wantedId);
    if (Number.isInteger(lastId) && byId(lastId)) return byId(lastId);
    var g = splitTrips(list, todayStr);
    return g.upcoming[0] || g.past[0] || null;
  }

  var TripCore = { LIMITS: LIMITS, parseDate: parseDate, tripDays: tripDays, validateTrip: validateTrip, splitTrips: splitTrips, pickTrip: pickTrip };
  if (typeof module !== 'undefined' && module.exports) module.exports = TripCore;
  if (root) root.TripCore = TripCore;
})(typeof window !== 'undefined' ? window : null);
