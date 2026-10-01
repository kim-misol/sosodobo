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
  /** 이 여행 사람들 (정산 쪽 목록 → 없으면 사진 쪽 목록) */
  function people() {
    var s = window.SettleUI && window.SettleUI.state;
    if (s && s.travelers && s.travelers.length) return s.travelers;
    var p = window.PhotoUI && window.PhotoUI.state;
    return (p && p.travelers) || [];
  }
  function nameOf(id) {
    var t = people().find(function (x) { return x.id === id; });
    return t ? t.name : '?';
  }
  function won(n) { return Number(n).toLocaleString('ko-KR') + '원'; }
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
    return '<div class="block"><h3>🚶 여행 코스' + (total > 1 ? ' ' + (CIRCLED[idx] || idx + 1) : '') + ' — ' + esc(c.name) + '</h3>' +
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
      (guests ? '<p>' + guests + '명이 나눠서 결제' + (l.nights > 1 ? ' · ' + l.nights + '박' : '') +
        (I.perPersonCost(l.cost, guests) ? ' · 1인 ' + won(I.perPersonCost(l.cost, guests)) : '') + '</p>' : '') +
      mapLinkHtml(l.mapUrl, l.mapProvider) + (l.mapUrl && l.linkUrl ? '<br>' : '') +
      (l.linkUrl ? mapLinkHtml(l.linkUrl, null, '숙소 소개글 보기') : '') +
      '</div></div>';
  }

  /** 그날 밤 숙소 배정 경고 (겹친 사람 · 숙소 미정) */
  function coverageWarning(date) {
    var ids = people().map(function (t) { return t.id; });
    if (!ids.length) return '';
    var c = I.nightlyCoverage([date], state.data.lodgings || [], ids)[date];
    var out = [];
    if (c.doubled.length) out.push('두 숙소에 모두 들어 있어요: ' + c.doubled.map(nameOf).join(', '));
    if (c.missing.length) out.push('숙소 미정: ' + c.missing.map(nameOf).join(', '));
    return out.length ? '<p class="it-warn">⚠️ ' + esc(out.join(' · ')) + '</p>' : '';
  }
  function tripEnded() {
    var sc = window.ShellCore;
    return !!(sc && state.trip && sc.tripPhase(state.trip.startDate, state.trip.days, Date.now()) === 'after');
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
      (window.WeatherUI ? window.WeatherUI.dayLine(day.date) : '') +
      (day.title ? '<h2>' + esc(day.title) + '</h2>' : '') +
      (day.summary ? '<p class="desc">' + esc(day.summary) + '</p>' : '') +
      (window.RouteUI ? window.RouteUI.dayHtml(day, lodgings) : '');
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
    // 숙소 배정 경고는 여행이 끝나기 전까지만 일정에 보여 줌 (편집 화면에서는 항상)
    if (lodgings.length) out += '<div class="block"><h3>🏠 숙소</h3>' + lodgings.map(lodgingHtml).join('') + (tripEnded() ? '' : coverageWarning(day.date)) + '</div>';
    var docs = window.DocsUI ? window.DocsUI.forDate(day.date) : [];
    if (docs.length) {
      out += '<div class="block"><h3>🎫 티켓 · 예약</h3><div class="it-rows">' + docs.map(function (d) {
        var k = window.DocsCore.kindOf(d.kind);
        return '<button type="button" class="it-row it-doc" data-it="doc" data-doc="' + d.id + '"><span class="it-ico" aria-hidden="true">' + k.icon + '</span>' +
          '<div class="it-row-main">' + esc(d.title) + '<span>' + esc(k.label) + (d.files.length > 1 ? ' · 파일 ' + d.files.length + '개' : '') + '</span></div></button>';
      }).join('') + '</div></div>';
    }
    return out + '</section>';
  }

  function render() {
    if (!els.box || !state.data) return;
    els.box.innerHTML = '<div class="timeline">' + state.data.days.map(dayHtml).join('') + '</div>';
    if (window.Carousel) els.box.querySelectorAll('.carousel').forEach(function (el) { window.Carousel.initCarousel(el); });
    if (window.RouteUI) window.RouteUI.mount(els.box);
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
    state.editingDay = null; state.view = 'day'; state.item = null; state.lodging = null; state.error = null;
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

  // ---- 미리보기 사진 (하루 10장, 브라우저에서 줄여서 저장소에 올림) ----
  function photosSectionHtml(day) {
    var n = day.photos.length;
    var full = n >= I.PREVIEW.perDay;
    var up = state.uploading;
    return '<section class="it-sec"><div class="it-sec-head"><h3>미리보기 사진 <span class="m-muted">' + (n > I.PREVIEW.perDay ? n + '장' : n + '/' + I.PREVIEW.perDay) + '</span></h3>' +
      (full || up ? '' : '<label class="it-add it-upload">+ 사진 추가<input type="file" accept="image/*" multiple data-it="photo-file"></label>') + '</div>' +
      (up ? '<p class="it-per" role="status">올리는 중… ' + up.done + '/' + up.total + '</p>' : '') +
      (n ? '<div class="it-photos">' + day.photos.map(function (p, i) {
        var local = !/^https:/.test(p.url);
        return '<figure class="it-photo"><img src="' + esc(p.thumbUrl || p.url) + '" alt="' + esc(p.caption || '') + '" loading="lazy">' +
          '<input class="it-cap" data-photo="' + p.id + '" maxlength="' + I.PREVIEW.captionMax + '" value="' + esc(p.caption) + '" placeholder="설명 (선택)" aria-label="사진 설명">' +
          '<div class="it-row-tools">' +
          '<button type="button" data-it="photo-move" data-dir="-1" data-photo="' + p.id + '" aria-label="앞으로"' + (i === 0 ? ' disabled' : '') + '>←</button>' +
          '<button type="button" data-it="photo-move" data-dir="1" data-photo="' + p.id + '" aria-label="뒤로"' + (i === n - 1 ? ' disabled' : '') + '>→</button>' +
          '<button type="button" data-it="photo-del" data-photo="' + p.id + '" aria-label="지우기">🗑</button></div>' +
          (local ? '<span class="it-local" title="사이트에 들어 있는 사진">기본</span>' : '') + '</figure>';
      }).join('') + '</div>' : '<p class="it-none">가 보기 전에 볼 사진을 넣어 두면 일정에 넘겨 보는 사진으로 보여요.</p>') +
      (full ? '<p class="it-none">하루 ' + I.PREVIEW.perDay + '장까지 넣을 수 있어요. 더 넣으려면 몇 장을 지워 주세요.</p>' : '') +
      '<p class="it-none">사진은 긴 쪽 ' + I.PREVIEW.maxEdge + 'px 로 줄여서 올려요.</p></section>';
  }

  function loadImg(file) {
    return new Promise(function (resolve, reject) {
      var url = URL.createObjectURL(file);
      var img = new Image();
      img.onload = function () { resolve({ img: img, url: url }); };
      img.onerror = function () { URL.revokeObjectURL(url); reject(new Error('이 브라우저에서 열 수 없는 사진 형식이에요. (HEIC 라면 Safari 에서 올리거나 JPG 로 바꿔 주세요.)')); };
      img.src = url;
    });
  }
  function toJpeg(img, maxEdge, quality) {
    var size = window.PhotoCore.fitWithin(img.naturalWidth, img.naturalHeight, maxEdge);
    var c = document.createElement('canvas');
    c.width = size.width; c.height = size.height;
    c.getContext('2d').drawImage(img, 0, 0, size.width, size.height);
    return new Promise(function (resolve, reject) {
      c.toBlob(function (b) { if (b) resolve({ blob: b, width: size.width, height: size.height }); else reject(new Error('사진을 변환하지 못했어요.')); }, 'image/jpeg', quality);
    });
  }

  async function uploadPreviewFiles(fileList) {
    var day = currentDay();
    var room = I.PREVIEW.perDay - day.photos.length;
    var files = Array.prototype.slice.call(fileList || []).filter(function (f) {
      return /^image\//.test(f.type) || /\.(heic|heif|jpe?g|png|webp)$/i.test(f.name);
    });
    if (!files.length) { state.error = '사진 파일을 골라 주세요.'; drawSheet(); return; }
    var skipped = Math.max(0, files.length - room);
    files = files.slice(0, Math.max(0, room));
    if (!window.PhotoUI || !window.PhotoUI.uploadBlob) { state.error = '사진을 올릴 준비가 안 됐어요. 새로고침한 뒤 다시 시도해 주세요.'; drawSheet(); return; }
    state.busy = true;
    state.error = null;
    state.uploading = { done: 0, total: files.length };
    drawSheet();
    for (var i = 0; i < files.length; i++) {
      var loaded = null;
      try {
        loaded = await loadImg(files[i]);
        var full = await toJpeg(loaded.img, I.PREVIEW.maxEdge, 0.82);
        var thumb = await toJpeg(loaded.img, I.PREVIEW.thumbEdge, 0.75);
        var now = Date.now();
        var rand = Math.random().toString(36).slice(2, 10);
        var fullRes = await window.PhotoUI.uploadBlob(I.previewPath(state.trip.id, 'full', now, rand), full.blob, 'image/jpeg');
        var thumbRes = await window.PhotoUI.uploadBlob(I.previewPath(state.trip.id, 'thumb', now, rand), thumb.blob, 'image/jpeg');
        var d = await api('POST', 'part=day-photo&day=' + day.dayNo, { url: fullRes.url, thumbUrl: thumbRes.url, width: full.width, height: full.height });
        state.data = Object.assign({}, state.data, d);
        render();
        state.uploading.done += 1;
        drawSheet();
      } catch (err) {
        var msg = window.PhotoCore && window.PhotoCore.uploadErrorMessage ? window.PhotoCore.uploadErrorMessage(err && err.message) : { text: err.message, storageMissing: false };
        state.error = msg.storageMissing ? '사진 저장소(Vercel Blob)가 아직 연결되지 않아 올릴 수 없어요. 연결된 뒤 다시 추가해 주세요.' : msg.text;
        if (msg.storageMissing) break; // 저장소 문제면 나머지도 같은 이유로 실패
      } finally {
        if (loaded) URL.revokeObjectURL(loaded.url);
      }
    }
    if (!state.error && skipped) state.error = '하루 ' + I.PREVIEW.perDay + '장까지라 ' + skipped + '장은 넣지 않았어요.';
    state.uploading = null;
    state.busy = false;
    drawSheet();
  }

  function lodgingFormHtml(l, day) {
    var v = l || {};
    var edit = !!l;
    var checkIn = v.checkIn || day.date;
    var idx = state.data.days.findIndex(function (d) { return d.date === checkIn; });
    var maxNights = Math.max(1, state.data.days.length - Math.max(0, idx));
    var guests = edit ? v.guestIds : people().map(function (t) { return t.id; });
    var addExpense = edit ? !!v.expenseId : true;
    var me = window.TripContext && window.TripContext.trip && window.TripContext.trip.travelerId;
    var payer = v.payerId || me || (people()[0] && people()[0].id);
    var f = function (name, label, attrs, val) {
      return '<label><span>' + label + '</span><input name="' + name + '" ' + (attrs || '') + ' value="' + esc(val === undefined ? v[name] : val) + '"></label>';
    };
    return '<form class="tui-form" data-it-form="lodging"' + (edit ? ' data-lodging="' + v.id + '"' : '') + ' autocomplete="off" novalidate>' +
      f('name', '숙소 이름 <em>*</em>', 'maxlength="60" required placeholder="예: 파도가 머무는 정원"') +
      '<div class="tui-two"><label><span>체크인</span><select name="checkIn">' + state.data.days.map(function (d) {
        return '<option value="' + d.date + '"' + (d.date === checkIn ? ' selected' : '') + '>DAY ' + d.dayNo + ' · ' + esc(d.dateLabel) + '</option>';
      }).join('') + '</select></label>' +
      '<label><span>몇 박</span><select name="nights">' + Array.from({ length: maxNights }, function (_, i) {
        var n = i + 1;
        return '<option value="' + n + '"' + ((v.nights || 1) === n ? ' selected' : '') + '>' + n + '박</option>';
      }).join('') + '</select></label></div>' +
      f('cost', '총 비용 <span class="tui-opt">(선택)</span>', 'inputmode="text" placeholder="예: 300000 또는 30만"', v.cost === null || v.cost === undefined ? '' : v.cost) +
      '<fieldset class="tui-radios"><legend>함께 묵는 사람</legend><div class="it-guests">' + people().map(function (t) {
        return '<label><input type="checkbox" name="guest" value="' + t.id + '"' + (guests.indexOf(t.id) >= 0 ? ' checked' : '') + '>' + esc(t.name) + '</label>';
      }).join('') + '</div></fieldset>' +
      '<p class="it-per" data-it="per"></p>' +
      f('mapUrl', '지도 링크 <span class="tui-opt">(카카오 · 네이버 · 구글)</span>', 'inputmode="url" placeholder="지도 앱의 공유 링크 붙여넣기"') +
      '<p class="it-map-hint" data-it="map-hint" hidden></p>' +
      f('address', '주소 <span class="tui-opt">(선택)</span>', 'maxlength="120"') +
      f('linkUrl', '숙소 소개 · 예약 링크 <span class="tui-opt">(선택)</span>', 'inputmode="url" placeholder="https://"') +
      '<label><span>메모 <span class="tui-opt">(체크인 시간 · 시설 등)</span></span><textarea name="memo" maxlength="300" rows="2">' + esc(v.memo) + '</textarea></label>' +
      '<div class="it-expense"><label class="tui-toggle"><input type="checkbox" name="addExpense"' + (addExpense ? ' checked' : '') + '>' +
      '<span><b>숙소비를 지출에 추가</b>함께 묵는 사람끼리 나눠 내도록 정산에 넣어요. 숙소를 고치면 정산도 같이 바뀌어요.</span></label>' +
      '<label data-it="payer"' + (addExpense ? '' : ' hidden') + '><span>결제한 사람</span><select name="payerId">' + people().map(function (t) {
        return '<option value="' + t.id + '"' + (t.id === payer ? ' selected' : '') + '>' + esc(t.name) + '</option>';
      }).join('') + '</select></label></div>' +
      '<button type="submit" class="tui-btn primary">' + (edit ? '저장' : '추가') + '</button></form>';
  }

  function readLodgingForm(form) {
    return {
      name: form.name.value, checkIn: form.checkIn.value, nights: Number(form.nights.value), cost: form.cost.value,
      guestIds: Array.prototype.filter.call(form.querySelectorAll('input[name="guest"]'), function (c) { return c.checked; }).map(function (c) { return Number(c.value); }),
      mapUrl: form.mapUrl.value, address: form.address.value, linkUrl: form.linkUrl.value, memo: form.memo.value,
      addExpense: form.addExpense.checked, payerId: Number(form.payerId.value),
    };
  }

  /** 1인당 금액 · 결제한 사람 칸 · 박 수 선택지를 입력에 맞춰 */
  function updateLodgingForm() {
    var form = sheet && sheet.querySelector('form[data-it-form="lodging"]');
    if (!form) return;
    var b = readLodgingForm(form);
    var won0 = I.parseWon(b.cost);
    var per = I.perPersonCost(Number.isFinite(won0) ? won0 : null, b.guestIds.length);
    var perBox = form.querySelector('[data-it="per"]');
    perBox.textContent = per ? b.guestIds.length + '명이 나눠 내면 1인 ' + won(per) : '';
    form.querySelector('[data-it="payer"]').hidden = !b.addExpense;
    var idx = state.data.days.findIndex(function (d) { return d.date === b.checkIn; });
    var max = Math.max(1, state.data.days.length - Math.max(0, idx));
    if (form.nights.options.length !== max) {
      form.nights.innerHTML = Array.from({ length: max }, function (_, i) {
        return '<option value="' + (i + 1) + '"' + (Math.min(b.nights, max) === i + 1 ? ' selected' : '') + '>' + (i + 1) + '박</option>';
      }).join('');
    }
  }

  function drawSheet() {
    if (!sheet) return;
    var day = currentDay();
    var box = sheet.querySelector('.tsheet');
    var head = '<span class="tsheet-grab" aria-hidden="true"></span><button type="button" class="tsheet-x" data-it="close" aria-label="닫기">×</button>';
    var err = state.error ? '<p class="tui-err" role="alert">' + esc(state.error) + '</p>' : '';
    if (state.view === 'lodging') {
      box.innerHTML = head + '<button type="button" class="it-back" data-it="back">‹ DAY ' + day.dayNo + ' 편집</button>' +
        '<h2>' + (state.lodging ? '숙소 고치기' : '숙소 추가') + '</h2>' + err + lodgingFormHtml(state.lodging, day);
      updateLodgingForm();
      updateMapHint();
      var firstInput = box.querySelector('input[name="name"]');
      if (firstInput && !state.lodging) firstInput.focus();
      return;
    }
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
      '<section class="it-sec"><div class="it-sec-head"><h3>이날 밤 숙소</h3>' +
      '<button type="button" class="it-add" data-it="add-lodging">+ 숙소 추가</button></div>' +
      (lodgings.length ? lodgings.map(function (l) {
        var per = I.perPersonCost(l.cost, l.guestIds.length);
        return '<div class="it-row"><div class="it-row-main">🏠 ' + esc(l.name) + '<span>' +
          esc([l.checkIn.slice(5).replace('-', '/') + ' 체크인 · ' + l.nights + '박', l.cost !== null ? won(l.cost) : '', l.guestIds.length + '명' + (per ? ' · 1인 ' + won(per) : ''), l.expenseId ? '정산에 추가됨' : ''].filter(Boolean).join(' · ')) +
          '</span></div><div class="it-row-tools">' +
          '<button type="button" data-it="edit-lodging" data-lodging="' + l.id + '" aria-label="고치기">✎</button>' +
          '<button type="button" data-it="del-lodging" data-lodging="' + l.id + '" aria-label="지우기">🗑</button></div></div>';
      }).join('') : '<p class="it-none">이날 밤 숙소가 없어요.</p>') + coverageWarning(day.date) +
      '<p class="it-none">인원이 많으면 하룻밤에 숙소를 여러 곳 넣을 수 있어요.</p></section>' +
      photosSectionHtml(day);
  }

  function updateMapHint() {
    var form = sheet && sheet.querySelector('form[data-it-form="item"], form[data-it-form="lodging"]');
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
    else if (a === 'back') { state.view = 'day'; state.item = null; state.lodging = null; state.error = null; drawSheet(); }
    else if (a === 'photo-move') {
      busyRun(api('POST', 'part=day-photo-move&photo=' + b.getAttribute('data-photo'), { dir: Number(b.getAttribute('data-dir')) }));
    } else if (a === 'photo-del') {
      if (!confirm('이 미리보기 사진을 지울까요?')) return;
      busyRun(api('DELETE', 'part=day-photo&photo=' + b.getAttribute('data-photo')));
    }
    else if (a === 'add-lodging') { state.view = 'lodging'; state.lodging = null; state.error = null; drawSheet(); }
    else if (a === 'edit-lodging' || a === 'del-lodging') {
      var lid = Number(b.getAttribute('data-lodging'));
      var lod = (state.data.lodgings || []).find(function (x) { return x.id === lid; });
      if (!lod) return;
      if (a === 'edit-lodging') { state.view = 'lodging'; state.lodging = lod; state.error = null; drawSheet(); return; }
      if (!confirm('「' + lod.name + '」을(를) 지울까요?' + (lod.expenseId ? '\n정산에 넣은 숙소비 지출도 함께 지워져요.' : ''))) return;
      busyRun(api('DELETE', 'part=lodging&lodging=' + lid)).then(afterLodgingChange);
    }
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

  /** 숙소가 바뀌면 정산(지출 기록)도 다시 불러옴 */
  function afterLodgingChange() {
    if (!state.error && window.SettleUI && window.SettleUI.reload) window.SettleUI.reload();
  }

  function onSheetChange(e) {
    if (e.target.matches('[data-it="photo-file"]')) { uploadPreviewFiles(e.target.files); return; }
    if (e.target.matches('.it-cap') && !state.busy) {
      busyRun(api('PATCH', 'part=day-photo&photo=' + e.target.getAttribute('data-photo'), { caption: e.target.value }));
      return;
    }
    if (e.target.closest('form[data-it-form="lodging"]')) updateLodgingForm();
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
    if (form.getAttribute('data-it-form') === 'lodging') {
      var lb = readLodgingForm(form);
      var lv = I.validateLodging(lb, { startDate: state.trip.startDate, days: state.data.days.length, travelerIds: people().map(function (t) { return t.id; }) });
      if (lv.error) { state.error = lv.error; drawSheet(); restoreLodging(lb); return; }
      var editing = state.lodging;
      if (editing && editing.expenseId && !lb.addExpense && !confirm('"숙소비를 지출에 추가"를 끄면 정산에 넣은 숙소비 지출이 지워져요. 계속할까요?')) return;
      busyRun(editing ? api('PATCH', 'part=lodging&lodging=' + editing.id, lb) : api('POST', 'part=lodging', lb)).then(function () {
        if (!state.error) { state.view = 'day'; state.lodging = null; drawSheet(); afterLodgingChange(); }
        else restoreLodging(lb);
      });
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

  function restoreLodging(b) {
    var form = sheet && sheet.querySelector('form[data-it-form="lodging"]');
    if (!form) return;
    ['name', 'checkIn', 'cost', 'mapUrl', 'address', 'linkUrl', 'memo'].forEach(function (k) { if (form[k]) form[k].value = b[k] === undefined || b[k] === null ? '' : b[k]; });
    updateLodgingForm();
    form.nights.value = String(b.nights);
    Array.prototype.forEach.call(form.querySelectorAll('input[name="guest"]'), function (c) { c.checked = b.guestIds.indexOf(Number(c.value)) >= 0; });
    form.addExpense.checked = b.addExpense;
    if (b.payerId) form.payerId.value = String(b.payerId);
    updateLodgingForm();
    updateMapHint();
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

  document.addEventListener('input', function (e) {
    if (!sheet) return;
    if (e.target.name === 'mapUrl') updateMapHint();
    if (e.target.closest('form[data-it-form="lodging"]')) updateLodgingForm();
  });
  document.addEventListener('keydown', function (e) { if (e.key === 'Escape' && sheet) closeSheet(); });

  function bind() {
    // 사람 목록이 늦게 오면(정산 불러오기) 숙소 인원·경고를 다시 그림
    if (window.SettleUI && window.SettleUI.onChange) {
      var lastKey = '';
      window.SettleUI.onChange(function (st) {
        var key = (st.travelers || []).map(function (t) { return t.id; }).join(',');
        if (state.data && key !== lastKey && !st.loading) { lastKey = key; render(); }
      });
    }
    els.box.addEventListener('click', function (e) {
      var docBtn = e.target.closest('[data-it="doc"]');
      if (docBtn && window.DocsUI) { window.DocsUI.open(Number(docBtn.getAttribute('data-doc'))); return; }
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

  window.ItineraryUI = { reload: load, rerender: render, daysWithContentBeyond: daysWithContentBeyond, state: state };

  var boot = function () { if (window.TripContext) window.TripContext.ready.then(init); };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})();
