/**
 * 지금 보고 있는 여행 정하기 · 불러오기.
 *
 * - 주소 ?trip=<id> → 지난번에 본 여행 → 가장 가까운 다가오는 여행 → 가장 최근 지난 여행 순으로 고름
 * - 여행 정보를 불러와 다른 화면이 쓰는 값(TripPlaces, PhotoCore.LIMITS.tripDays, 제목)을 맞추고
 *   api/* 요청에 ?trip= 를 자동으로 붙임 (api/auth, api/trips 제외)
 * - 위쪽 여행 카드: 남해 바래길은 index.html 에 적힌 그대로, 다른 여행은 여행 정보로 그림 (날짜별 일정은 itinerary-ui.js)
 * - 준비가 끝나면 TripContext.ready 가 풀리고 'sosodobo:trip' 이벤트를 보냄
 *
 * 필요 전역: AuthUI(있으면), TripCore, TripPlaces, PhotoCore(있으면)
 * <head> 에서 auth-ui.js 다음에 불러옵니다.
 */
(function () {
  'use strict';

  var LAST_KEY = 'sosodobo.trip';
  var TC = { trip: null, trips: null, ready: null };
  var resolveReady;
  TC.ready = new Promise(function (r) { resolveReady = r; });
  window.TripContext = TC;

  // ---- api/* 요청에 지금 여행 붙이기 ------------------------------------------
  var baseFetch = window.fetch ? window.fetch.bind(window) : null;
  if (baseFetch) {
    window.fetch = function (input, init) {
      if (typeof input === 'string' && TC.trip && /^\/?api\//.test(input) && !/^\/?api\/(auth|trips)\b/.test(input) && !/[?&]trip=/.test(input)) {
        input += (input.indexOf('?') >= 0 ? '&' : '?') + 'trip=' + TC.trip.id;
      }
      return baseFetch(input, init);
    };
  }

  function getJson(path) {
    return (baseFetch || fetch)(path, { credentials: 'same-origin' }).then(function (res) {
      return res.json().catch(function () { return {}; }).then(function (data) { return { status: res.status, ok: res.ok, data: data }; });
    });
  }

  function kstToday() { return new Date(Date.now() + 9 * 3600 * 1000).toISOString().slice(0, 10); }
  function readLast() { try { var v = parseInt(localStorage.getItem(LAST_KEY), 10); return Number.isInteger(v) ? v : null; } catch (e) { return null; } }
  function saveLast(id) { try { localStorage.setItem(LAST_KEY, String(id)); } catch (e) { /* 사생활 보호 모드 등 */ } }
  function urlTrip() { var m = /[?&]trip=(\d+)/.exec(location.search); return m ? Number(m[1]) : null; }

  // 주소에 여행이 있으면 로그인 확인을 기다리지 않고 여행 정보를 미리 불러 둠 (왕복 한 번 줄이기)
  var prefetched = null;
  (function () {
    var id = urlTrip();
    if (id && baseFetch) prefetched = { id: id, promise: getJson('api/trips?id=' + id) };
  })();

  /** 내 여행 목록 (다시 불러오려면 force). */
  TC.loadTrips = function (force) {
    if (TC.trips && !force) return Promise.resolve(TC.trips);
    return getJson('api/trips').then(function (r) { TC.trips = r.ok ? (r.data.trips || []) : []; return TC.trips; });
  };

  /** 다른 여행으로 (화면 전체를 새로 불러 모든 기능이 그 여행 데이터로 시작). */
  TC.switchTo = function (id) {
    saveLast(id);
    location.href = location.pathname + '?trip=' + id;
  };

  function esc(s) {
    return String(s === null || s === undefined ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  // ---- 여행을 화면에 반영 ------------------------------------------------------
  function applyTrip(t) {
    TC.trip = t;
    saveLast(t.id);
    if (urlTrip() !== t.id) {
      try { history.replaceState(null, '', location.pathname + '?trip=' + t.id + location.hash); } catch (e) { /* 무시 */ }
    }
    var legacy = t.legacyKey === 'namhae';
    var places = window.TripPlaces || (window.TripPlaces = {});
    places.TRIP_START_DATE = t.startDate;
    places.TRIP_TITLE = t.title;
    places.TRIP_SUBTITLE = t.summary || '';
    places.TRIP_DAYS = t.days;
    if (!legacy) { places.DAY_NAMES = {}; places.PLACES = []; }
    if (window.PhotoCore) window.PhotoCore.LIMITS.tripDays = t.days;
    document.title = t.title;
    document.body.setAttribute('data-legacy', legacy ? t.legacyKey : '');

    var brand = document.querySelector('.nav-brand span:last-child');
    if (brand) brand.textContent = t.title;
    if (!legacy) renderTripHero(t);
  }

  /** 옛 페이지가 아닌 여행: 위쪽 여행 카드와 날짜 카드를 여행 정보로 */
  function renderTripHero(t) {
    var head = document.getElementById('top');
    if (head) {
      var status = document.getElementById('m-trip-status');
      head.innerHTML = '<div class="eyebrow">' + esc(window.ShellCore ? window.ShellCore.dateRangeLabel(t.startDate, t.days) : t.startDate) + ' · ' + t.days + '일</div>' +
        '<h1>' + esc(t.title) + '</h1>' + (t.summary ? '<p>' + esc(t.summary) + '</p>' : '') +
        '<div class="summary"><span>📍 ' + esc(t.region) + '</span><span>🗓 ' + t.days + '일' + (t.days > 1 ? ' (' + (t.days - 1) + '박)' : '') + '</span>' +
        (t.memberCount ? '<span>👥 ' + t.memberCount + '명</span>' : '') + '</div>';
      if (status) head.appendChild(status);
    }
  }

  function finish(t) {
    applyTrip(t);
    // 링크 공개 여행을 참여하지 않고 보는 중: 지출·정산·준비물·올리기 숨김 + 안내
    var viewer = t.isMember === false;
    document.body.classList.toggle('trip-viewer', viewer);
    if (viewer && window.AuthUI && window.AuthUI.enterViewer) window.AuthUI.enterViewer();
    if (window.AuthUI) {
      window.AuthUI.setMember(t.travelerId ? { id: t.travelerId, name: t.travelerName } : null);
      if (window.AuthUI.reveal) window.AuthUI.reveal();
    }
    resolveReady(t);
    document.dispatchEvent(new CustomEvent('sosodobo:trip', { detail: t }));
  }

  function openTrip(id, fallbackList) {
    var req = prefetched && prefetched.id === id ? prefetched.promise : getJson('api/trips?id=' + id);
    prefetched = null;
    return req.then(function (r) {
      if (r.ok) { finish(r.data.trip); return; }
      if (r.data && r.data.code === 'join_required' && window.AuthUI) {
        window.AuthUI.showJoin({ back: '내 여행으로' });
        return;
      }
      if (r.data && r.data.code === 'login_required' && window.AuthUI) { window.AuthUI.showLogin(); return; }
      // 없는 여행이면 주소를 지우고 내 여행 중에서 다시 고름
      try { history.replaceState(null, '', location.pathname + location.hash); } catch (e) { /* 무시 */ }
      return (fallbackList ? Promise.resolve(fallbackList) : TC.loadTrips()).then(function (list) { choose(list, null); });
    });
  }

  function choose(list, wanted) {
    var t = window.TripCore.pickTrip(list, wanted, readLast(), kstToday());
    if (!t) {
      if (window.AuthUI && window.AuthUI.enabled) window.AuthUI.showStart();
      else if (window.TripUI) window.TripUI.openCreate({ first: true });
      return;
    }
    return openTrip(t.id, list);
  }

  function start(me) {
    var wanted = urlTrip();
    if (me && me.enabled && !me.user) {
      // 로그인 없이 링크 공개 여행 구경
      if (wanted) openTrip(wanted, []);
      return;
    }
    if (wanted) { openTrip(wanted); return; }
    TC.loadTrips().then(function (list) { choose(list, null); });
  }

  var go = function () {
    (window.AuthUI ? window.AuthUI.ready : Promise.resolve({ enabled: false })).then(start);
  };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', go);
  else go();
})();
