/**
 * 모바일 화면(하단 탭)의 순수 로직. 브라우저에서는 window.ShellCore, 테스트에서는 require 로 씁니다.
 */
(function (root) {
  'use strict';

  var DAY_MS = 24 * 60 * 60 * 1000;
  var KST_OFFSET_MS = 9 * 60 * 60 * 1000;
  var TABS = ['home', 'photos', 'people', 'profile'];

  function kstToday(nowMs) {
    return new Date(nowMs + KST_OFFSET_MS).toISOString().slice(0, 10);
  }

  /** 여행 단계 (한국 날짜 기준): 'before' 출발 전 · 'during' 여행 중 · 'after' 끝남. 첫날을 모르면 'before'. */
  function tripPhase(startDate, days, nowMs) {
    var start = startDate ? Date.parse(startDate + 'T00:00:00Z') : NaN;
    if (!Number.isFinite(start)) return 'before';
    var today = Date.parse(kstToday(Number.isFinite(nowMs) ? nowMs : Date.now()) + 'T00:00:00Z');
    var n = Math.round((today - start) / DAY_MS);
    if (n < 0) return 'before';
    if (n < (days || 1)) return 'during';
    return 'after';
  }

  /**
   * 여행 상태 문구용 숫자: 출발 전이면 { phase:'before', days: 남은 날 }, 여행 중이면 { phase:'during', day: n일차 },
   * 끝났으면 { phase:'after' }.
   */
  function tripStatus(startDate, days, nowMs) {
    var phase = tripPhase(startDate, days, nowMs);
    var start = startDate ? Date.parse(startDate + 'T00:00:00Z') : NaN;
    if (!Number.isFinite(start)) return { phase: phase };
    var today = Date.parse(kstToday(Number.isFinite(nowMs) ? nowMs : Date.now()) + 'T00:00:00Z');
    var n = Math.round((today - start) / DAY_MS);
    if (phase === 'before') return { phase: phase, days: -n };
    if (phase === 'during') return { phase: phase, day: n + 1 };
    return { phase: phase };
  }

  /** 처음 여는 탭: 끝난 여행은 사진첩, 출발 전·여행 중은 홈. */
  function defaultTab(phase) {
    return phase === 'after' ? 'photos' : 'home';
  }

  /** 주소의 #탭 이름 → 탭 (모르는 값이면 null). */
  function tabFromHash(hash) {
    var h = String(hash || '').replace(/^#/, '');
    return TABS.indexOf(h) >= 0 ? h : null;
  }

  /** '2026-09-24', 3 → '2026.9.24 – 9.26' */
  function dateRangeLabel(startDate, days) {
    var start = startDate ? Date.parse(startDate + 'T00:00:00Z') : NaN;
    if (!Number.isFinite(start)) return '';
    var a = new Date(start);
    var b = new Date(start + ((days || 1) - 1) * DAY_MS);
    var head = a.getUTCFullYear() + '.' + (a.getUTCMonth() + 1) + '.' + a.getUTCDate();
    var tail = (b.getUTCFullYear() !== a.getUTCFullYear() ? b.getUTCFullYear() + '.' : '') + (b.getUTCMonth() + 1) + '.' + b.getUTCDate();
    return days > 1 ? head + ' – ' + tail : head;
  }

  var ShellCore = { TABS: TABS, tripPhase: tripPhase, tripStatus: tripStatus, defaultTab: defaultTab, tabFromHash: tabFromHash, dateRangeLabel: dateRangeLabel };

  if (typeof module !== 'undefined' && module.exports) module.exports = ShellCore;
  if (root) root.ShellCore = ShellCore;
})(typeof window !== 'undefined' ? window : null);
