/**
 * 날짜별 일정 화면: DB 의 일정(코스 · 이동 · 주차 · 미리보기 사진 · 숙소)을 예전 남해 페이지와 같은 모양으로 그리고,
 * 고칠 수 있는 사람에게는 날짜마다 "✎ 일정 편집" 시트를 보여 줍니다.
 *
 * 필요 전역: TripContext, ItineraryCore, Carousel(있으면)
 */
(function () {
  'use strict';

  var I = window.ItineraryCore;
  var state = { data: null, trip: null, editingDay: null, view: 'day', item: null, busy: false, error: null };
  var els = {};

  function esc(s) {
    return String(s === null || s === undefined ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function api(method, query, body) {
    return fetch('api/trips?id=' + state.trip.id + '&' + query, {
      method: method,
      headers: body ? { 'Content-Type': 'application/json' } : undefined,
      body: body ? JSON.stringify(body) : undefined,
    }).then(function (res) {
      return res.json().catch(function () { return {}; }).then(function (d) {
        if (!res.ok) throw new Error(d.error || '요청 실패 (' + res.status + ')');
        return d;
      });
    });
  }
  function modeOf(key) { return I.MOVE_MODES.find(function (m) { return m.key === key; }) || I.MOVE_MODES[I.MOVE_MODES.length - 1]; }

  // ---------------------------------------------------------------------------
  // 보기 (예전 index.html 의 .timeline 모양 그대로)
  // ---------------------------------------------------------------------------
  function mapLinkHtml(url, provider, label) {
    if (!url) return '';
    return '<a href="' + esc(url) + '" target="_blank" rel="noopener">' + esc(label || (I.MAP_LABEL[provider || 'other'] + '에서 보기')) + ' →</a>';
  }

  function rowHtml(icon, title, text, links) {
    return '<div class="taxi"><div class="icon" aria-hidden="true">' + icon + '</div><div><b>' + esc(title) + '</b>' +
      (text ? '<span>' + esc(text) + '</span>' : '') + (links ? '<span class="it-links">' + links + '</span>' : '') + '</div></div>';
  }

  function parkingHtml(p) {
    return rowHtml('🅿️', '주차 위치', p.name + (p.memo ? ' (' + p.memo + ')' : ''), mapLinkHtml(p.mapUrl, p.mapProvider));
  }

  function moveHtml(m) {
    var title = [m.fromPlace, m.toPlace].filter(Boolean).join(' → ') || modeOf(m.mode).label + ' 이동';
    return rowHtml(modeOf(m.mode).icon, title, m.memo, mapLinkHtml(m.mapUrl, m.mapProvider) + (m.linkUrl ? mapLinkHtml(m.linkUrl, null, '참고 링크') : ''));
  }

  var CIRCLED = ['①', '②', '③', '④', '⑤', '⑥', '⑦', '⑧', '⑨', '⑩'];
  function courseHtml(c, idx, total) {
    var rows = [];
    if (c.fromPlace) rows.push(['출발', c.fromPlace]);
    if (c.toPlace) rows.push(['도착', c.toPlace]);
    if (c.distanceKm !== null && c.distanceKm !== undefined) rows.push(['총 거리', c.distanceKm.toFixed(1) + 'km']);
    if (c.durationText) rows.push(['걷는 시간', c.durationText]);
    if (c.difficulty) rows.push(['난이도', I.stars(c.difficulty)]);
    var links = mapLinkHtml(c.mapUrl, c.mapProvider) + (c.linkUrl ? mapLinkHtml(c.linkUrl, null, '코스 안내') : '');
    return '<div class="block"><h3>🚶 도보 코스' + (total > 1 ? ' ' + (CIRCLED[idx] || idx + 1) : '') + ' — ' + esc(c.name) + '</h3>' +
      '<div class="course-card' + (c.imageUrl ? '' : ' no-img') + '">' +
      (c.imageUrl ? '<img src="' + esc(c.imageUrl) + '" alt="' + esc(c.name) + ' 지도" loading="lazy">' : '') +
      '<div class="course-meta"><div class="name">' + esc(c.name.replace(/^\d+코스\s+/, '')) + (c.subtitle ? ' (' + esc(c.subtitle) + ')' : '') + '</div>' +
      (rows.length ? '<table>' + rows.map(function (r) { return '<tr><td>' + r[0] + '</td><td class="v">' + esc(r[1]) + '</td></tr>'; }).join('') + '</table>' : '') +
      (c.memo ? '<div class="note">' + esc(c.memo) + '</div>' : '') +
      (links ? '<div class="it-links">' + links + '</div>' : '') +
      '</div></div></div>';
  }

  function carouselHtml(day, heading) {
    var photos = day.photos;
    return '<div class="block"><h3>📸 ' + esc(heading) + ' 미리보기</h3><div class="carousel"><div class="carousel-track">' +
      photos.map(function (p) { return '<div class="slide"><img src="' + esc(p.url) + '" alt="' + esc(p.caption || '') + '" loading="lazy"></div>'; }).join('') +
      '</div>' + (photos.length > 1 ? '<button type="button" class="carousel-btn prev" aria-label="이전 사진">‹</button><button type="button" class="carousel-btn next" aria-label="다음 사진">›</button>' +
      '<div class="carousel-dots">' + photos.map(function (_, i) {
        return '<button type="button" class="dot' + (i === 0 ? ' active' : '') + '" aria-label="' + (i + 1) + '번 사진으로 이동" aria-current="' + (i === 0) + '"></button>';
      }).join('') + '</div>' : '') + '</div></div>';
  }

  function lodgingHtml(l) {
    var nightly = l.cost !== null && l.cost !== undefined ? I.shortWon(Math.round(l.cost / (l.nights || 1))) + ' / 박' : '';
    var guests = l.guestIds && l.guestIds.length;
    return '<div class="lodge-card' + (l.imageUrl ? '' : ' no-img') + '">' +
      (l.imageUrl ? '<img src="' + esc(l.imageUrl) + '" alt="' + esc(l.name) + '" loading="lazy">' : '') +
      '<div class="lodge-info"><div class="name">' + esc(l.name) + '</div>' +
      (nightly ? '<span class="price">' + esc(nightly) + '</span>' : '') +
      (l.memo ? '<p>' + esc(l.memo) + '</p>' : '') +
      (guests ? '<p>' + guests + '명이 나눠서 결제' + (l.nights > 1 ? ' · ' + l.nights + '박' : '') + '</p>' : '') +
      mapLinkHtml(l.mapUrl, l.mapProvider) + (l.mapUrl && l.linkUrl ? '<br>' : '') +
      (l.linkUrl ? mapLinkHtml(l.linkUrl, null, '숙소 소개글 보기') : '') +
      '</div></div>';
  }

  function lodgingsForDate(date) {
    return (state.data.lodgings || []).filter(function (l) { return I.lodgingNights(l.checkIn, l.nights).indexOf(date) >= 0; });
  }

  function dayHtml(day) {
    var g = I.groupItems(day.items);
    var free = day.planMode === 'free';
    var lodgings = lodgingsForDate(day.date);
    var empty = !I.dayHasContent(day) && !lodgings.length;
    var out = '<section class="day" data-day="' + day.dayNo + '">' +
      '<div class="it-day-head"><span class="day-label">DAY ' + day.dayNo + '</span><span class="it-date">' + esc(day.dateLabel) + '</span>' +
      (state.data.canEdit ? '<button type="button" class="it-edit" data-it="edit-day" data-day="' + day.dayNo + '">✎ 일정 편집</button>' : '') + '</div>' +
      (day.title ? '<h2>' + esc(day.title) + '</h2>' : '') +
      (day.summary ? '<p class="desc">' + esc(day.summary) + '</p>' : '');
    if (empty) {
      out += '<p class="desc it-empty">아직 일정이 비어 있어요.' + (state.data.canEdit ? ' <button type="button" class="it-fill" data-it="edit-day" data-day="' + day.dayNo + '">+ 일정 채우기</button>' : '') + '</p>';
    }
    if (free && day.freeNote) out += '<div class="block"><div class="it-free">🍃 ' + esc(day.freeNote) + '</div></div>';
    if (g.parking.length || g.movesBefore.length) {
      out += '<div class="block"><h3>🚗 주차 &amp; 이동</h3><div class="it-rows">' + g.parking.map(parkingHtml).join('') + g.movesBefore.map(moveHtml).join('') + '</div></div>';
    }
    if (!free) g.courses.forEach(function (c, i) { out += courseHtml(c, i, g.courses.length); });
    if (day.photos.length) out += carouselHtml(day, (!free && g.courses[0] ? g.courses[0].name.replace(/^\d+코스\s*/, '') : day.title) || 'DAY ' + day.dayNo);
    if (g.movesAfter.length) out += '<div class="block"><h3>🚕 이동</h3><div class="it-rows">' + g.movesAfter.map(moveHtml).join('') + '</div></div>';
    if (lodgings.length) out += '<div class="block"><h3>🏠 숙소</h3>' + lodgings.map(lodgingHtml).join('') + '</div>';
    return out + '</section>';
  }

  function render() {
    if (!els.box || !state.data) return;
    els.box.innerHTML = '<div class="timeline">' + state.data.days.map(dayHtml).join('') + '</div>';
    if (window.Carousel) els.box.querySelectorAll('.carousel').forEach(function (el) { window.Carousel.initCarousel(el); });
    shareNames();
  }

  /** 사진첩 · 슬라이드 영상이 쓰는 일차 이름 · 장소 목록을 일정에서 */
  function shareNames() {
    var places = window.TripPlaces || (window.TripPlaces = {});
    var names = {};
    var presets = [];
    var seen = {};
    state.data.days.forEach(function (d) {
      if (d.title) names[d.dayNo] = d.title;
      d.items.forEach(function (it) {
        [it.kind === 'parking' ? it.name : null, it.fromPlace, it.toPlace].forEach(function (n) {
          if (n && !seen[n]) { seen[n] = true; presets.push({ id: 'it-' + it.id + '-' + presets.length, day: d.dayNo, name: n, lat: null, lng: null }); }
        });
      });
    });
    (state.data.lodgings || []).forEach(function (l) {
      if (!seen[l.name]) { seen[l.name] = true; presets.push({ id: 'lodging-' + l.id, day: null, name: l.name, lat: null, lng: null }); }
    });
    places.DAY_NAMES = names;
    if (!(state.trip && state.trip.legacyKey)) places.PLACES = presets; // 남해는 좌표가 들어 있는 기존 목록 유지
  }

  function load() {
    return api('GET', 'part=itinerary').then(function (d) { state.data = d; render(); return d; })
      .catch(function (e) { if (els.box) els.box.innerHTML = '<p class="desc">⚠️ 일정을 불러오지 못했어요: ' + esc(e.message) + '</p>'; });
  }

  // ---------------------------------------------------------------------------
  // 편집 시트
  // ---------------------------------------------------------------------------
  var sheet = null;
  function openSheet() {
    if (!sheet) {
      sheet = document.createElement('div');
      sheet.className = 'tsheet-scrim';
      sheet.innerHTML = '<div class="tsheet it-sheet" role="dialog" aria-modal="true" aria-label="일정 편집"></div>';
      document.body.appendChild(sheet);
      document.body.classList.add('tsheet-open');
      sheet.addEventListener('click', onSheetClick);
      sheet.addEventListener('submit', onSheetSubmit);
      sheet.addEventListener('change', onSheetChange);
    }
    drawSheet();
  }
  function closeSheet() {
    if (sheet) { sheet.remove(); sheet = null; }
    document.body.classList.remove('tsheet-open');
    state.editingDay = null; state.view = 'day'; state.item = null; state.error = null;
  }
  function currentDay() { return state.data.days.find(function (d) { return d.dayNo === state.editingDay; }); }

  var KIND_LABEL = { course: '코스', move: '이동', parking: '주차' };

  function itemSummary(it) {
    if (it.kind === 'course') {
      return esc(it.name) + '<span>' + esc([it.distanceKm !== null && it.distanceKm !== undefined ? it.distanceKm + 'km' : '', it.durationText, it.difficulty ? I.stars(it.difficulty) : ''].filter(Boolean).join(' · ')) + '</span>';
    }
    if (it.kind === 'move') {
      return modeOf(it.mode).icon + ' ' + esc([it.fromPlace, it.toPlace].filter(Boolean).join(' → ') || modeOf(it.mode).label) +
        '<span>' + (it.timing === 'after' ? '코스 후' : '코스 전') + (it.memo ? ' · ' + esc(it.memo) : '') + '</span>';
    }
    return '🅿️ ' + esc(it.name) + (it.memo ? '<span>' + esc(it.memo) + '</span>' : '');
  }

  function listHtml(day, kind, list) {
    return '<section class="it-sec"><div class="it-sec-head"><h3>' + KIND_LABEL[kind] + '</h3>' +
      '<button type="button" class="it-add" data-it="add" data-kind="' + kind + '">+ ' + KIND_LABEL[kind] + ' 추가</button></div>' +
      (list.length ? list.map(function (it, i) {
        return '<div class="it-row"><div class="it-row-main">' + itemSummary(it) + '</div><div class="it-row-tools">' +
          '<button type="button" data-it="up" data-item="' + it.id + '" aria-label="위로"' + (i === 0 ? ' disabled' : '') + '>↑</button>' +
          '<button type="button" data-it="down" data-item="' + it.id + '" aria-label="아래로"' + (i === list.length - 1 ? ' disabled' : '') + '>↓</button>' +
          '<button type="button" data-it="edit-item" data-item="' + it.id + '" aria-label="고치기">✎</button>' +
          '<button type="button" data-it="del-item" data-item="' + it.id + '" aria-label="지우기">🗑</button></div></div>';
      }).join('') : '<p class="it-none">아직 없어요.</p>') + '</section>';
  }

  function dayFormHtml(day) {
    var free = day.planMode === 'free';
    return '<form class="tui-form" data-it-form="day" autocomplete="off">' +
      '<label><span>제목 <span class="tui-opt">(예: 동대만길)</span></span><input name="title" maxlength="' + I.LIMITS.dayTitleMax + '" value="' + esc(day.title) + '"></label>' +
      '<label><span>한줄 설명 <span class="tui-opt">(선택)</span></span><input name="summary" maxlength="' + I.LIMITS.daySummaryMax + '" value="' + esc(day.summary) + '" placeholder="예: 창선대교에서 출발해 15km를 걸어요."></label>' +
      '<fieldset class="tui-radios it-mode"><legend>이날 코스</legend>' +
      '<label><input type="radio" name="planMode" value="course"' + (free ? '' : ' checked') + '><span><b>코스 정하기</b>걷는 구간을 적어요.</span></label>' +
      '<label><input type="radio" name="planMode" value="free"' + (free ? ' checked' : '') + '><span><b>발 닿는대로</b>무계획 여행! 한줄로 남겨요.</span></label></fieldset>' +
      '<label data-it="free-note"' + (free ? '' : ' hidden') + '><span>발 닿는대로 한줄</span><input name="freeNote" maxlength="' + I.LIMITS.freeNoteMax + '" value="' + esc(day.freeNote) + '" placeholder="예: 바다 보이면 멈추기"></label>' +
      '<button type="submit" class="tui-btn primary">저장</button></form>';
  }

  function itemFormHtml(kind, it) {
    var v = it || {};
    var f = function (name, label, attrs, val) {
      return '<label><span>' + label + '</span><input name="' + name + '" ' + (attrs || '') + ' value="' + esc(val === undefined ? v[name] : val) + '"></label>';
    };
    var body = '';
    if (kind === 'course') {
      body = f('name', '코스 이름 <em>*</em>', 'maxlength="60" required placeholder="예: 3코스 동대만길"') +
        f('subtitle', '부제 <span class="tui-opt">(선택)</span>', 'maxlength="60" placeholder="예: 남파랑길 36코스"') +
        '<div class="tui-two">' + f('fromPlace', '출발', 'maxlength="60"') + f('toPlace', '도착', 'maxlength="60"') + '</div>' +
        '<div class="tui-two">' + f('distanceKm', '거리 (km)', 'inputmode="decimal" placeholder="15.0"', v.distanceKm === null || v.distanceKm === undefined ? '' : v.distanceKm) +
        f('durationText', '걷는 시간', 'maxlength="30" placeholder="5시간 30분 내외"') + '</div>' +
        '<label><span>난이도</span><select name="difficulty"><option value="">정하지 않음</option>' + [1, 2, 3, 4, 5].map(function (n) {
          return '<option value="' + n + '"' + (v.difficulty === n ? ' selected' : '') + '>' + I.stars(n) + '</option>';
        }).join('') + '</select></label>' +
        f('linkUrl', '코스 안내 링크 <span class="tui-opt">(선택)</span>', 'inputmode="url" placeholder="https://"') +
        f('mapUrl', '지도 링크 <span class="tui-opt">(카카오 · 네이버 · 구글)</span>', 'inputmode="url" placeholder="지도 앱의 공유 링크 붙여넣기"') +
        '<label><span>메모 <span class="tui-opt">(선택)</span></span><textarea name="memo" maxlength="300" rows="2">' + esc(v.memo) + '</textarea></label>';
    } else if (kind === 'move') {
      body = '<label><span>이동 수단</span><select name="mode">' + I.MOVE_MODES.map(function (m) {
        return '<option value="' + m.key + '"' + ((v.mode || 'taxi') === m.key ? ' selected' : '') + '>' + m.icon + ' ' + m.label + '</option>';
      }).join('') + '</select></label>' +
        '<fieldset class="tui-radios it-inline"><legend>언제</legend>' +
        '<label><input type="radio" name="timing" value="before"' + (v.timing === 'after' ? '' : ' checked') + '><span><b>코스 전</b></span></label>' +
        '<label><input type="radio" name="timing" value="after"' + (v.timing === 'after' ? ' checked' : '') + '><span><b>코스 후</b></span></label></fieldset>' +
        '<div class="tui-two">' + f('fromPlace', '출발', 'maxlength="60"') + f('toPlace', '도착', 'maxlength="60"') + '</div>' +
        '<label><span>메모 <span class="tui-opt">(시간 · 요금 · 버스 번호 등)</span></span><textarea name="memo" maxlength="300" rows="2" placeholder="예: 택시 약 11분 또는 버스 15분 (801번)">' + esc(v.memo) + '</textarea></label>' +
        f('mapUrl', '지도 링크 <span class="tui-opt">(선택)</span>', 'inputmode="url" placeholder="https://"');
    } else {
      body = f('name', '주차 장소 <em>*</em>', 'maxlength="60" required placeholder="예: 창선면행정복지센터 근처 무료공영주차장"') +
        f('mapUrl', '지도 링크 <span class="tui-opt">(카카오 · 네이버 · 구글)</span>', 'inputmode="url" placeholder="지도 앱의 공유 링크 붙여넣기"') +
        '<label><span>메모 <span class="tui-opt">(주소 · 요금 등)</span></span><textarea name="memo" maxlength="300" rows="2">' + esc(v.memo) + '</textarea></label>';
    }
    return '<form class="tui-form" data-it-form="item" data-kind="' + kind + '"' + (it ? ' data-item="' + it.id + '"' : '') + ' autocomplete="off" novalidate>' + body +
      '<p class="it-map-hint" data-it="map-hint" hidden></p>' +
      '<button type="submit" class="tui-btn primary">' + (it ? '저장' : '추가') + '</button></form>';
  }

  function drawSheet() {
    if (!sheet) return;
    var day = currentDay();
    var box = sheet.querySelector('.tsheet');
    var head = '<span class="tsheet-grab" aria-hidden="true"></span><button type="button" class="tsheet-x" data-it="close" aria-label="닫기">×</button>';
    var err = state.error ? '<p class="tui-err" role="alert">' + esc(state.error) + '</p>' : '';
    if (state.view === 'item') {
      var kind = state.item ? state.item.kind : state.addKind;
      box.innerHTML = head + '<button type="button" class="it-back" data-it="back">‹ DAY ' + day.dayNo + ' 편집</button>' +
        '<h2>' + KIND_LABEL[kind] + (state.item ? ' 고치기' : ' 추가') + '</h2>' + err + itemFormHtml(kind, state.item);
      updateMapHint();
      var first = box.querySelector('input:not([type=radio]), select');
      if (first) first.focus();
      return;
    }
    var g = I.groupItems(day.items);
    var lodgings = lodgingsForDate(day.date);
    box.innerHTML = head + '<h2>DAY ' + day.dayNo + ' · ' + esc(day.dateLabel) + '</h2>' + err + dayFormHtml(day) +
      (day.planMode === 'free' ? '' : listHtml(day, 'course', g.courses)) +
      listHtml(day, 'move', g.movesBefore.concat(g.movesAfter)) +
      listHtml(day, 'parking', g.parking) +
      '<section class="it-sec"><div class="it-sec-head"><h3>숙소</h3></div>' +
      (lodgings.length ? lodgings.map(function (l) { return '<div class="it-row"><div class="it-row-main">🏠 ' + esc(l.name) + '<span>' + esc(l.checkIn.slice(5).replace('-', '/')) + ' 체크인 · ' + l.nights + '박</span></div></div>'; }).join('') : '<p class="it-none">이날 밤 숙소가 없어요.</p>') +
      '<p class="it-none">숙소 추가 · 수정은 곧 추가돼요.</p></section>' +
      (day.photos.length ? '<p class="it-none">미리보기 사진 ' + day.photos.length + '장 · 사진 추가는 곧 추가돼요.</p>' : '');
  }

  function updateMapHint() {
    var form = sheet && sheet.querySelector('form[data-it-form="item"]');
    var hint = form && form.querySelector('[data-it="map-hint"]');
    if (!hint || !form.mapUrl) return;
    var p = I.detectMapProvider(form.mapUrl.value);
    hint.hidden = !p;
    if (p) hint.textContent = '📍 ' + I.MAP_LABEL[p] + ' 링크로 알아봤어요.';
  }

  function busyRun(promise) {
    state.busy = true;
    state.error = null;
    return promise.then(function (d) {
      state.data = Object.assign({}, state.data, d);
      render();
      return d;
    }).catch(function (e) {
      state.error = e.message;
    }).then(function (d) { state.busy = false; drawSheet(); return d; });
  }

  function onSheetClick(e) {
    if (e.target === sheet) { closeSheet(); return; }
    var b = e.target.closest('[data-it]');
    if (!b || state.busy) return;
    var a = b.getAttribute('data-it');
    var itemId = Number(b.getAttribute('data-item'));
    var day = currentDay();
    var find = function () { return day.items.find(function (x) { return x.id === itemId; }); };
    if (a === 'close') closeSheet();
    else if (a === 'back') { state.view = 'day'; state.item = null; state.error = null; drawSheet(); }
    else if (a === 'add') { state.view = 'item'; state.item = null; state.addKind = b.getAttribute('data-kind'); state.error = null; drawSheet(); }
    else if (a === 'edit-item') { state.view = 'item'; state.item = find(); state.error = null; drawSheet(); }
    else if (a === 'del-item') {
      var it = find();
      if (!confirm('「' + (it.name || [it.fromPlace, it.toPlace].filter(Boolean).join(' → ') || KIND_LABEL[it.kind]) + '」을(를) 지울까요?')) return;
      busyRun(api('DELETE', 'part=item&item=' + itemId));
    } else if (a === 'up' || a === 'down') {
      busyRun(api('POST', 'part=item-move&item=' + itemId, { dir: a === 'up' ? -1 : 1 }));
    }
  }

  function onSheetChange(e) {
    if (e.target.name === 'planMode') {
      var note = sheet.querySelector('[data-it="free-note"]');
      if (note) note.hidden = e.target.value !== 'free';
    }
  }

  function readItemForm(form) {
    var out = { kind: form.getAttribute('data-kind') };
    Array.prototype.forEach.call(form.elements, function (el) {
      if (!el.name) return;
      if (el.type === 'radio') { if (el.checked) out[el.name] = el.value; return; }
      out[el.name] = el.value;
    });
    return out;
  }

  function onSheetSubmit(e) {
    var form = e.target;
    e.preventDefault();
    if (state.busy) return;
    var day = currentDay();
    if (form.getAttribute('data-it-form') === 'day') {
      var body = {
        title: form.title.value, summary: form.summary.value,
        planMode: (form.querySelector('input[name="planMode"]:checked') || {}).value || 'course',
        freeNote: form.freeNote.value,
      };
      var check = I.validateDay(body);
      if (check.error) { state.error = check.error; drawSheet(); return; }
      busyRun(api('PATCH', 'part=day&day=' + day.dayNo, body));
      return;
    }
    var data = readItemForm(form);
    var editId = form.getAttribute('data-item');
    var v = I.validateItem(data.kind, data);
    if (v.error) { state.error = v.error; drawSheet(); restoreForm(data); return; }
    busyRun(editId ? api('PATCH', 'part=item&item=' + editId, data) : api('POST', 'part=item&day=' + day.dayNo, data)).then(function () {
      if (!state.error) { state.view = 'day'; state.item = null; drawSheet(); }
      else restoreForm(data);
    });
  }

  /** 오류로 시트를 다시 그려도 입력한 값은 그대로 */
  function restoreForm(data) {
    var form = sheet && sheet.querySelector('form[data-it-form="item"]');
    if (!form) return;
    Object.keys(data).forEach(function (k) {
      var el = form.elements[k];
      if (!el) return;
      if (el.length && el[0] && el[0].type === 'radio') Array.prototype.forEach.call(el, function (r) { r.checked = r.value === data[k]; });
      else el.value = data[k];
    });
    updateMapHint();
  }

  document.addEventListener('input', function (e) { if (sheet && e.target.name === 'mapUrl') updateMapHint(); });
  document.addEventListener('keydown', function (e) { if (e.key === 'Escape' && sheet) closeSheet(); });

  function bind() {
    els.box.addEventListener('click', function (e) {
      var b = e.target.closest('[data-it="edit-day"]');
      if (!b) return;
      state.editingDay = Number(b.getAttribute('data-day'));
      state.view = 'day';
      state.error = null;
      openSheet();
    });
  }

  /** 여행 기간을 줄일 때 사라질 날짜 중 일정이 있는 날 (trip-ui 가 경고에 씀) */
  function daysWithContentBeyond(newDays) {
    if (!state.data) return [];
    return state.data.days.filter(function (d) { return d.dayNo > newDays && I.dayHasContent(d); }).map(function (d) { return d.dayNo; });
  }

  function init(trip) {
    els.box = document.getElementById('trip-days');
    if (!els.box || !trip) return;
    state.trip = trip;
    bind();
    load();
  }

  window.ItineraryUI = { reload: load, daysWithContentBeyond: daysWithContentBeyond, state: state };

  var boot = function () { if (window.TripContext) window.TripContext.ready.then(init); };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})();
