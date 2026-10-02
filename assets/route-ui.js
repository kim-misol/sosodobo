/**
 * 일정 지도 루트: 날짜 카드 안에 "🗺 지도에서 루트 보기" → 펼치면 번호 핀 + 점선 + 번호 목록.
 * - 지도 라이브러리(Leaflet)와 좌표는 처음 펼칠 때만 불러와요 (api/trips?part=route).
 * - 못 찾은 곳 · 먼 곳은 안내하고, 일정을 고칠 수 있는 사람은 "위치 고치기" (링크 붙여넣기 · 검색해서 고르기).
 * itinerary-ui.js 가 RouteUI.dayHtml(day, lodgings) 로 자리를 만들고, 그린 뒤 RouteUI.mount(box) 를 불러요.
 *
 * 필요 전역: RouteCore, TripContext
 */
(function () {
  'use strict';

  var R = window.RouteCore;
  var state = { trip: null, data: null, loading: null, open: {}, maps: {}, fix: null };
  var TILE = 'https://tile.openstreetmap.org/{z}/{x}/{y}.png';
  var ATTR = '© <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap</a>';

  function esc(s) {
    return String(s === null || s === undefined ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function openKey() { return 'sosodobo.route.open.' + (state.trip ? state.trip.id : ''); }
  function loadOpen() {
    try { state.open = JSON.parse(localStorage.getItem(openKey()) || '{}') || {}; } catch (e) { state.open = {}; }
  }
  function saveOpen() {
    try { localStorage.setItem(openKey(), JSON.stringify(state.open)); } catch (e) { /* 괜찮음 */ }
  }

  // ---------------------------------------------------------------------------
  // Leaflet 은 처음 펼칠 때만
  // ---------------------------------------------------------------------------
  var leafletReady = null;
  function loadLeaflet() {
    if (window.L) return Promise.resolve(window.L);
    if (leafletReady) return leafletReady;
    leafletReady = new Promise(function (resolve, reject) {
      var css = document.createElement('link');
      css.rel = 'stylesheet';
      css.href = 'assets/vendor/leaflet/leaflet.css';
      document.head.appendChild(css);
      var s = document.createElement('script');
      s.src = 'assets/vendor/leaflet/leaflet.js';
      s.onload = function () { resolve(window.L); };
      s.onerror = function () { leafletReady = null; reject(new Error('지도를 불러오지 못했어요.')); };
      document.head.appendChild(s);
    });
    return leafletReady;
  }

  function fetchRoutes() {
    if (state.loading) return state.loading;
    state.loading = fetch('api/trips?id=' + state.trip.id + '&part=route', { credentials: 'same-origin' })
      .then(function (res) { return res.json().then(function (d) { if (!res.ok) throw new Error(d.error || '루트를 불러오지 못했어요.'); return d; }); })
      .then(function (d) {
        state.data = d;
        state.loading = null;
        if (d.pending) setTimeout(function () { refresh(); }, 1500); // 아직 못 찾아 본 장소가 남았으면 이어서
        return d;
      })
      .catch(function (e) { state.loading = null; throw e; });
    return state.loading;
  }

  function refresh() {
    state.data = null;
    return fetchRoutes().then(function () { mountAll(); }).catch(function () { /* 다음에 다시 */ });
  }

  // ---------------------------------------------------------------------------
  // 날짜 카드 안 자리
  // ---------------------------------------------------------------------------
  /** itinerary-ui 가 날짜 카드에 넣는 자리 (장소가 없으면 빈 문자열) */
  function dayHtml(day, lodgings) {
    if (!R) return '';
    var pts = R.dayPoints(day, lodgings);
    if (!pts.length) return '';
    return '<div class="rt" data-rt-day="' + day.dayNo + '" data-rt-count="' + pts.length + '" data-rt-sig="' + esc(pts.map(function (p) { return p.key; }).join('|')) + '">' +
      collapsedHtml(day.dayNo, pts.length) + '</div>';
  }

  function collapsedHtml(dayNo, n) {
    return '<button type="button" class="rt-toggle" data-rt="open" data-day="' + dayNo + '">🗺 지도에서 루트 보기 <span>장소 ' + n + '곳</span></button>';
  }

  function routeFor(dayNo) {
    if (!state.data) return null;
    return (state.data.days || []).find(function (d) { return d.dayNo === dayNo; }) || null;
  }

  function pinHtml(p, n, width) {
    var k = R.KINDS[p.kind] || R.KINDS.move;
    return '<span class="rt-pin" style="background:' + k.color + (width ? ';width:' + width + 'px;border-radius:14px' : '') + '">' + n + '</span>';
  }

  function expandedHtml(dayNo, route) {
    var ok = route.points.filter(function (p) { return p.status === 'ok'; });
    var once = function (list) { var seen = {}; return list.filter(function (p) { if (seen[p.key]) return false; seen[p.key] = true; return true; }); };
    var missing = once(route.points.filter(function (p) { return p.status === 'missing' || p.status === 'pending'; }));
    var far = once(route.points.filter(function (p) { return p.status === 'far'; }));
    var waiting = missing.some(function (p) { return p.status === 'pending'; });
    var canEdit = !!(state.data && state.data.canEdit);
    var n = 0;
    var list = route.points.map(function (p) {
      if (p.status !== 'ok') return '';
      n++;
      var k = R.KINDS[p.kind] || R.KINDS.move;
      return '<li class="rt-stop" data-rt="focus" data-day="' + dayNo + '" data-key="' + esc(p.key) + '">' + pinHtml(p, n) +
        '<div class="rt-stop-t"><b>' + esc(p.name) + '</b><span><span class="rt-kind" style="background:' + k.soft + '">' + esc(p.role) + '</span>' +
        (p.src && p.src.length ? ' ' + esc(p.src.join(' · ')) : '') + '</span></div>' +
        '<div class="rt-stop-tools">' +
        '<a href="' + esc(R.placeUrl(p)) + '" target="_blank" rel="noopener" class="rt-mini" aria-label="' + esc(p.name) + ' 지도 앱에서 열기">↗</a>' +
        (canEdit ? '<button type="button" class="rt-mini" data-rt="fix" data-key="' + esc(p.key) + '" data-name="' + esc(p.name) + '" aria-label="' + esc(p.name) + ' 위치 고치기">✎</button>' : '') +
        '</div></li>';
    }).join('');
    var notes = '';
    if (missing.length) {
      notes += '<p class="rt-note">' + (waiting ? '⏳ 위치를 찾는 중이에요… ' : '') + '📍 지도에서 못 찾은 곳 ' + missing.length + '개 · ' + missing.map(function (p) {
        return canEdit ? '<button type="button" class="rt-link" data-rt="fix" data-key="' + esc(p.key) + '" data-name="' + esc(p.name) + '">' + esc(p.name) + ' 위치 고치기</button>' : esc(p.name);
      }).join(' · ') + '</p>';
    }
    if (far.length) {
      notes += '<p class="rt-note muted">✈️ 여행 지역에서 멀어 지도에서 뺀 곳 · ' + far.map(function (p) {
        return canEdit ? '<button type="button" class="rt-link" data-rt="fix" data-key="' + esc(p.key) + '" data-name="' + esc(p.name) + '">' + esc(p.name) + '</button>' : esc(p.name);
      }).join(' · ') + '</p>';
    }
    var dir = R.googleDirectionsUrl(ok);
    return '<div class="rt-open">' +
      '<div class="rt-map-wrap"><div class="rt-map" data-rt-map="' + dayNo + '" role="img" aria-label="' + dayNo + '일차 루트 지도"></div>' +
      '<button type="button" class="rt-full-btn" data-rt="full" data-day="' + dayNo + '" aria-label="지도 크게 보기">⤢</button>' +
      (ok.length ? '' : '<p class="rt-empty">지도에 찍을 수 있는 장소가 아직 없어요.</p>') + '</div>' +
      (list ? '<ol class="rt-list">' + list + '</ol>' : '') + notes +
      '<div class="rt-actions">' +
      (dir ? '<a class="rt-act" href="' + esc(dir) + '" target="_blank" rel="noopener">구글 지도로 전체 길찾기</a>' : '') +
      '<button type="button" class="rt-act" data-rt="close" data-day="' + dayNo + '">지도 접기</button></div></div>';
  }

  // ---------------------------------------------------------------------------
  // 지도 그리기
  // ---------------------------------------------------------------------------
  function drawMap(dayNo, route) {
    var el = document.querySelector('[data-rt-map="' + dayNo + '"]');
    if (!el || !window.L) return;
    var L = window.L;
    if (state.maps[dayNo]) { try { state.maps[dayNo].map.remove(); } catch (e) { /* 이미 없음 */ } }
    var touch = window.matchMedia && window.matchMedia('(pointer: coarse)').matches;
    var map = L.map(el, { zoomControl: !touch, attributionControl: true, scrollWheelZoom: false, dragging: !touch, tap: false });
    L.tileLayer(TILE, { attribution: ATTR, maxZoom: 19 }).addTo(map);
    map.attributionControl.setPrefix(false);
    var ok = route.points.filter(function (p) { return p.status === 'ok'; });
    var markers = {};
    // 같은 장소가 하루에 두 번 나오면 핀 하나에 "2·4" 처럼
    var nums = {};
    ok.forEach(function (p, i) { (nums[p.key] = nums[p.key] || []).push(i + 1); });
    ok.forEach(function (p) {
      if (markers[p.key]) return;
      var label = nums[p.key].join('·');
      var w = 28 + Math.max(0, label.length - 1) * 7;
      var icon = L.divIcon({ className: 'rt-marker', html: pinHtml(p, label, w > 28 ? w : 0), iconSize: [w, 28], iconAnchor: [w / 2, 14] });
      markers[p.key] = L.marker([p.lat, p.lng], { icon: icon, title: p.name, keyboard: false }).addTo(map)
        .bindTooltip(esc(p.name), { direction: 'top', offset: [0, -14] });
    });
    if (ok.length > 1) {
      L.polyline(ok.map(function (p) { return [p.lat, p.lng]; }), { color: '#36405A', weight: 3, dashArray: '2 8', lineCap: 'round', opacity: 0.9 }).addTo(map);
    }
    if (ok.length === 1) map.setView([ok[0].lat, ok[0].lng], 14);
    else if (ok.length) map.fitBounds(L.latLngBounds(ok.map(function (p) { return [p.lat, p.lng]; })), { padding: [32, 32], maxZoom: 15 });
    else if (state.data && state.data.center) map.setView([state.data.center.lat, state.data.center.lng], 10);
    else map.setView([36.3, 127.8], 6);
    state.maps[dayNo] = { map: map, markers: markers, touch: touch };
  }

  function renderOpen(box, dayNo) {
    var route = routeFor(dayNo);
    if (!route) {
      box.innerHTML = '<div class="rt-open"><p class="rt-empty">🗺 지도 불러오는 중…</p></div>';
      Promise.all([loadLeaflet(), state.data ? null : fetchRoutes()]).then(function () {
        if (state.open[dayNo]) renderOpen(box, dayNo);
      }).catch(function (e) {
        box.innerHTML = '<div class="rt-open"><p class="rt-note">⚠️ ' + esc(e.message) + '</p>' +
          '<button type="button" class="rt-act" data-rt="close" data-day="' + dayNo + '">닫기</button></div>';
      });
      return;
    }
    if (!window.L) { loadLeaflet().then(function () { renderOpen(box, dayNo); }); return; }
    box.innerHTML = expandedHtml(dayNo, route);
    drawMap(dayNo, route);
  }

  /** itinerary-ui 가 날짜 카드를 다시 그린 뒤: 펼쳐 둔 날은 다시 펼치기 */
  function mountAll(root) {
    var scope = root || document;
    var stale = false;
    scope.querySelectorAll('.rt[data-rt-day]').forEach(function (box) {
      var dayNo = Number(box.getAttribute('data-rt-day'));
      var route = routeFor(dayNo);
      // 일정을 고쳐서 장소가 바뀌었으면 다시 받아요
      if (route && route.points.map(function (p) { return p.key; }).join('|') !== box.getAttribute('data-rt-sig')) stale = true;
      if (state.open[dayNo]) renderOpen(box, dayNo);
      else box.innerHTML = collapsedHtml(dayNo, Number(box.getAttribute('data-rt-count')));
    });
    if (stale && !state.loading) refresh();
  }

  // ---------------------------------------------------------------------------
  // 위치 고치기
  // ---------------------------------------------------------------------------
  var sheet = null;
  function openFix(name) {
    closeFix();
    state.fix = { name: name, results: null, error: null, busy: false };
    sheet = document.createElement('div');
    sheet.className = 'tsheet-scrim';
    sheet.innerHTML = '<div class="tsheet rt-sheet" role="dialog" aria-modal="true" aria-label="위치 고치기"></div>';
    document.body.appendChild(sheet);
    document.body.classList.add('tsheet-open');
    sheet.addEventListener('click', onFixClick);
    sheet.addEventListener('submit', onFixSubmit);
    drawFix();
    search(name);
  }
  function closeFix() {
    if (sheet) { sheet.remove(); sheet = null; }
    document.body.classList.remove('tsheet-open');
    state.fix = null;
  }
  function drawFix() {
    if (!sheet || !state.fix) return;
    var f = state.fix;
    sheet.querySelector('.tsheet').innerHTML = '<span class="tsheet-grab" aria-hidden="true"></span>' +
      '<button type="button" class="tsheet-x" data-rtf="close" aria-label="닫기">×</button>' +
      '<h2>위치 고치기</h2><p class="tui-sub" style="margin:0">' + esc(f.name) + '</p>' +
      (f.error ? '<p class="tui-err" role="alert">' + esc(f.error) + '</p>' : '') +
      '<form class="tui-form" data-rtf-form="link" autocomplete="off">' +
      '<label><span>지도 링크 붙여넣기 <span class="tui-opt">(카카오맵 · 네이버 지도 · 구글 지도)</span></span>' +
      '<input name="url" inputmode="url" placeholder="https://naver.me/… · https://maps.app.goo.gl/…"></label>' +
      '<button type="submit" class="tui-btn primary"' + (f.busy ? ' disabled' : '') + '>이 링크 위치로 저장</button></form>' +
      '<form class="tui-form rt-search" data-rtf-form="search" autocomplete="off">' +
      '<label><span>또는 검색해서 고르기</span><input name="q" value="' + esc(f.query || f.name) + '"></label>' +
      '<button type="submit" class="tui-btn">검색</button></form>' +
      (f.results === null ? '<p class="tui-sub">검색하는 중…</p>' : !f.results.length ? '<p class="tui-sub">검색 결과가 없어요. 다른 이름으로 찾아보거나 지도 링크를 붙여 넣어 주세요.</p>' :
        '<ul class="rt-results">' + f.results.map(function (r, i) {
          return '<li><button type="button" data-rtf="pick" data-i="' + i + '"><b>' + esc(r.name) + '</b><span>' +
            esc([r.category, r.address].filter(Boolean).join(' · ')) + (r.km !== null && r.km !== undefined ? ' · 여행 지역에서 ' + r.km + 'km' : '') +
            ' · ' + (r.source === 'kakao' ? '카카오' : 'OpenStreetMap') + '</span></button></li>';
        }).join('') + '</ul>') +
      '<button type="button" class="rt-link" data-rtf="auto">자동으로 다시 찾기</button>';
  }
  function api(method, query, body) {
    return fetch('api/trips?id=' + state.trip.id + '&' + query, {
      method: method, credentials: 'same-origin',
      headers: body ? { 'Content-Type': 'application/json' } : undefined, body: body ? JSON.stringify(body) : undefined,
    }).then(function (res) { return res.json().catch(function () { return {}; }).then(function (d) { if (!res.ok) throw new Error(d.error || '요청 실패 (' + res.status + ')'); return d; }); });
  }
  function search(q) {
    if (!state.fix) return;
    state.fix.query = q;
    state.fix.results = null;
    drawFix();
    api('GET', 'part=place-search&q=' + encodeURIComponent(q)).then(function (d) {
      if (!state.fix) return;
      state.fix.results = d.results || [];
      drawFix();
    }).catch(function (e) { if (state.fix) { state.fix.results = []; state.fix.error = e.message; drawFix(); } });
  }
  function saved() {
    closeFix();
    refresh();
  }
  function onFixClick(e) {
    if (e.target === sheet) { closeFix(); return; }
    var b = e.target.closest('[data-rtf]');
    if (!b || !state.fix || state.fix.busy) return;
    var a = b.getAttribute('data-rtf');
    if (a === 'close') closeFix();
    if (a === 'pick') {
      var r = state.fix.results[Number(b.getAttribute('data-i'))];
      state.fix.busy = true;
      api('PATCH', 'part=place', { name: state.fix.name, lat: r.lat, lng: r.lng }).then(saved)
        .catch(function (err) { state.fix.busy = false; state.fix.error = err.message; drawFix(); });
    }
    if (a === 'auto') {
      state.fix.busy = true;
      api('DELETE', 'part=place&name=' + encodeURIComponent(state.fix.name)).then(saved)
        .catch(function (err) { state.fix.busy = false; state.fix.error = err.message; drawFix(); });
    }
  }
  function onFixSubmit(e) {
    e.preventDefault();
    if (!state.fix || state.fix.busy) return;
    var f = e.target;
    if (f.getAttribute('data-rtf-form') === 'search') { search(f.q.value.trim() || state.fix.name); return; }
    var url = f.url.value.trim();
    if (!url) { state.fix.error = '지도 앱에서 "공유 → 링크 복사"한 주소를 붙여 넣어 주세요.'; drawFix(); return; }
    state.fix.busy = true;
    state.fix.error = null;
    drawFix();
    api('PATCH', 'part=place', { name: state.fix.name, url: url }).then(saved)
      .catch(function (err) { state.fix.busy = false; state.fix.error = err.message; drawFix(); });
  }

  // ---------------------------------------------------------------------------
  // 연결
  // ---------------------------------------------------------------------------
  document.addEventListener('click', function (e) {
    var b = e.target.closest('[data-rt]');
    if (!b || !state.trip) return;
    var a = b.getAttribute('data-rt');
    var dayNo = Number(b.getAttribute('data-day'));
    var box = b.closest('.rt');
    if (a === 'open' && box) { state.open[dayNo] = true; saveOpen(); renderOpen(box, dayNo); }
    if (a === 'close' && box) {
      delete state.open[dayNo]; saveOpen();
      if (state.maps[dayNo]) { try { state.maps[dayNo].map.remove(); } catch (x) { /* 괜찮음 */ } delete state.maps[dayNo]; }
      box.innerHTML = collapsedHtml(dayNo, Number(box.getAttribute('data-rt-count')));
    }
    if (a === 'full' && box) {
      var wrap = box.querySelector('.rt-map-wrap');
      var full = !wrap.classList.contains('rt-full');
      wrap.classList.toggle('rt-full', full);
      document.body.classList.toggle('rt-full-open', full);
      b.textContent = full ? '×' : '⤢';
      b.setAttribute('aria-label', full ? '지도 작게 보기' : '지도 크게 보기');
      var m = state.maps[dayNo];
      if (m) {
        if (m.touch) { if (full) m.map.dragging.enable(); else m.map.dragging.disable(); }
        setTimeout(function () { m.map.invalidateSize(); }, 60);
      }
    }
    if (a === 'focus' && !e.target.closest('a, button')) {
      var mm = state.maps[Number(b.getAttribute('data-day'))];
      var mk = mm && mm.markers[b.getAttribute('data-key')];
      if (mk) { mm.map.setView(mk.getLatLng(), Math.max(mm.map.getZoom(), 14), { animate: true }); mk.openTooltip(); }
    }
    if (a === 'fix') { e.preventDefault(); openFix(b.getAttribute('data-name')); }
  });
  // PC: 목록에 마우스를 올리면 핀 강조
  document.addEventListener('mouseover', function (e) {
    var li = e.target.closest && e.target.closest('.rt-stop');
    document.querySelectorAll('.rt-marker.hot').forEach(function (x) { x.classList.remove('hot'); });
    if (!li) return;
    var mm = state.maps[Number(li.getAttribute('data-day'))];
    var mk = mm && mm.markers[li.getAttribute('data-key')];
    if (mk && mk.getElement()) { mk.getElement().classList.add('hot'); mk.openTooltip(); }
  });
  document.addEventListener('keydown', function (e) {
    if (e.key !== 'Escape') return;
    if (sheet) closeFix();
    var full = document.querySelector('.rt-map-wrap.rt-full .rt-full-btn');
    if (full) full.click();
  });

  function init(trip) {
    if (!trip) return;
    state.trip = trip;
    loadOpen();
    mountAll();
  }

  window.RouteUI = { dayHtml: dayHtml, mount: mountAll, refresh: refresh, state: state };

  var boot = function () { if (window.TripContext) window.TripContext.ready.then(init); };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})();
