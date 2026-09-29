/**
 * 여행 바꾸기 · 새 여행 만들기 · 여행 수정 · 관리(참여 코드 · 삭제 · 나가기) 시트.
 * 폰에서는 아래에서 올라오는 시트, PC 에서는 가운데 창으로 보여요.
 *
 * 필요 전역: TripContext, TripCore, ShellCore(있으면), AuthUI(있으면)
 */
(function () {
  'use strict';

  var TC = function () { return window.TripContext; };
  var Core = function () { return window.TripCore; };

  function esc(s) {
    return String(s === null || s === undefined ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function kstToday() { return new Date(Date.now() + 9 * 3600 * 1000).toISOString().slice(0, 10); }
  function rangeLabel(t) { return window.ShellCore ? window.ShellCore.dateRangeLabel(t.startDate, t.days) : t.startDate + ' ~ ' + t.endDate; }
  function authOn() { return !!(window.AuthUI && window.AuthUI.enabled); }

  function api(method, path, body) {
    return fetch(path, {
      method: method,
      headers: body ? { 'Content-Type': 'application/json' } : undefined,
      body: body ? JSON.stringify(body) : undefined,
    }).then(function (res) {
      return res.json().catch(function () { return {}; }).then(function (data) {
        if (!res.ok) throw new Error(data.error || '요청 실패 (' + res.status + ')');
        return data;
      });
    });
  }

  // ---------------------------------------------------------------------------
  // 시트 틀
  // ---------------------------------------------------------------------------
  var sheet = null;
  function open(html, label) {
    close();
    sheet = document.createElement('div');
    sheet.className = 'tsheet-scrim';
    sheet.innerHTML = '<div class="tsheet" role="dialog" aria-modal="true" aria-label="' + esc(label) + '">' +
      '<span class="tsheet-grab" aria-hidden="true"></span><button type="button" class="tsheet-x" data-tui="close" aria-label="닫기">×</button>' + html + '</div>';
    document.body.appendChild(sheet);
    document.body.classList.add('tsheet-open');
    var first = sheet.querySelector('input:not([type=radio]):not([type=checkbox]), button:not(.tsheet-x)');
    if (first) first.focus();
  }
  function close() {
    if (sheet) { sheet.remove(); sheet = null; }
    document.body.classList.remove('tsheet-open');
  }

  // ---------------------------------------------------------------------------
  // 여행 목록 (다가오는 / 지난 여행)
  // ---------------------------------------------------------------------------
  function statusChip(t) {
    var st = window.ShellCore ? window.ShellCore.tripStatus(t.startDate, t.days, Date.now()) : { phase: 'after' };
    if (st.phase === 'before') return '<span class="tui-chip accent">' + (st.days ? 'D-' + st.days : '출발 전') + '</span>';
    if (st.phase === 'during') return '<span class="tui-chip accent">여행 중 · ' + st.day + '일차</span>';
    return '<span class="tui-chip line">' + (t.endDate.slice(5).replace('-', '/').replace(/^0/, '')) + ' 끝남</span>';
  }

  function tripRowHtml(t, mode) {
    var cur = TC() && TC().trip && TC().trip.id === t.id;
    var meta = [rangeLabel(t)];
    if (t.memberCount !== undefined) meta.push(t.memberCount + '명');
    if (t.photoCount !== undefined) meta.push('사진 ' + t.photoCount);
    return '<div class="tui-trip">' +
      '<button type="button" class="tui-trip-main" data-tui="go" data-id="' + t.id + '">' +
      '<span class="tui-cover" aria-hidden="true"></span><span class="t"><b>' + esc(t.title) +
      (cur ? ' <span class="tui-chip">보는 중</span>' : '') + (t.role === 'admin' && authOn() ? ' <span class="tui-chip line">관리자</span>' : '') + '</b>' +
      '<span>' + esc(meta.join(' · ')) + '</span><span>' + statusChip(t) + (t.visibility === 'link' ? ' <span class="tui-chip line">🔗 링크 공개</span>' : '') + '</span></span></button>' +
      (mode === 'manage' ? '<button type="button" class="tui-more" data-tui="manage" data-id="' + t.id + '" aria-label="' + esc(t.title) + ' 관리">⋯</button>' : '') +
      '</div>';
  }

  /** 다가오는 / 지난 여행으로 나눈 목록 HTML (프로필 탭에서도 씀) */
  function tripListHtml(list, mode) {
    var g = Core().splitTrips(list || [], kstToday());
    var part = function (title, arr) {
      return arr.length ? '<p class="tui-label">' + title + ' · ' + arr.length + '</p><div>' + arr.map(function (t) { return tripRowHtml(t, mode); }).join('') + '</div>' : '';
    };
    return (part('다가오는 여행', g.upcoming) + part('지난 여행', g.past)) || '<p class="tui-empty">아직 여행이 없어요.</p>';
  }

  function openSwitcher() {
    open('<h2>여행 바꾸기</h2><div data-tui="list"><p class="tui-empty">불러오는 중…</p></div>' +
      '<div class="tui-actions"><button type="button" class="tui-btn primary" data-tui="create">＋ 새 여행 만들기</button>' +
      (authOn() ? '<button type="button" class="tui-btn" data-tui="join">참여 코드로 참여</button>' : '') + '</div>', '여행 바꾸기');
    TC().loadTrips(true).then(function (list) {
      var box = sheet && sheet.querySelector('[data-tui="list"]');
      if (box) box.innerHTML = tripListHtml(list, 'manage');
    });
  }

  // ---------------------------------------------------------------------------
  // 만들기 · 수정 폼
  // ---------------------------------------------------------------------------
  /** 여행 기본 정보 폼. trip 이 있으면 수정, 없으면 새 여행. (로그인 화면에서도 씀) */
  function formHtml(trip) {
    var t = trip || {};
    var edit = !!trip;
    var vis = t.visibility || 'private';
    return '<form class="tui-form" data-trip-form="' + (edit ? 'edit' : 'create') + '"' + (edit ? ' data-id="' + t.id + '"' : '') + ' autocomplete="off" novalidate>' +
      '<label>여행 이름 <em>*</em><input name="title" maxlength="40" required value="' + esc(t.title) + '" placeholder="예: 제주 올레 7코스"></label>' +
      '<div class="tui-two"><label>시작일 <em>*</em><input type="date" name="startDate" required value="' + esc(t.startDate) + '"></label>' +
      '<label>마지막 날 <em>*</em><input type="date" name="endDate" required value="' + esc(t.endDate) + '"></label></div>' +
      '<label>지역 <em>*</em><input name="region" maxlength="40" required value="' + esc(t.region) + '" placeholder="예: 제주 서귀포"></label>' +
      '<label>한줄 설명 <span class="tui-opt">(선택)</span><input name="summary" maxlength="80" value="' + esc(t.summary) + '" placeholder="예: 바다 따라 천천히 걷기"></label>' +
      (!edit && !authOn() ? '<label>내 이름 <span class="tui-opt">(선택)</span><input name="myName" maxlength="40" placeholder="이 여행에서 부를 이름"></label>' : '') +
      '<fieldset class="tui-radios"><legend>공개 설정</legend>' +
      '<label><input type="radio" name="visibility" value="private"' + (vis === 'private' ? ' checked' : '') + '><span><b>비공개</b>참여한 사람만 볼 수 있어요.</span></label>' +
      '<label><input type="radio" name="visibility" value="link"' + (vis === 'link' ? ' checked' : '') + '><span><b>링크 공개</b>링크가 있으면 누구나 일정·숙소·사진을 볼 수 있어요. 지출·정산·준비물은 참여자만.</span></label>' +
      '</fieldset>' +
      (edit ? '<label class="tui-toggle"><input type="checkbox" name="membersCanEdit"' + (t.membersCanEdit !== false ? ' checked' : '') + '><span><b>참여자 모두 일정 수정</b>끄면 일정·숙소는 관리자만 고칠 수 있어요.</span></label>' : '') +
      '<p class="tui-err" data-tui="err" role="alert" hidden></p>' +
      '<button type="submit" class="tui-btn primary">' + (edit ? '저장' : '만들기') + '</button></form>';
  }

  function readForm(form) {
    var val = function (n) { return form[n] ? form[n].value : undefined; };
    var body = {
      title: val('title'), startDate: val('startDate'), endDate: val('endDate'), region: val('region'), summary: val('summary'),
      visibility: (form.querySelector('input[name="visibility"]:checked') || {}).value || 'private',
    };
    if (form.myName) body.myName = form.myName.value;
    if (form.membersCanEdit) body.membersCanEdit = form.membersCanEdit.checked;
    return body;
  }

  function submitForm(form) {
    var err = form.querySelector('[data-tui="err"]');
    var btn = form.querySelector('button[type="submit"]');
    var body = readForm(form);
    var check = Core().validateTrip(body, { partial: false });
    if (check.error) { err.textContent = check.error; err.hidden = false; return; }
    err.hidden = true;
    btn.disabled = true;
    var edit = form.getAttribute('data-trip-form') === 'edit';
    var req = edit ? api('PATCH', 'api/trips?id=' + form.getAttribute('data-id'), body) : api('POST', 'api/trips', body);
    req.then(function (d) {
      if (edit && d.photosWithoutDay) alert('기간이 줄어서 사진 ' + d.photosWithoutDay + '장이 "일차 없음"이 됐어요.');
      if (edit && TC().trip && TC().trip.id === d.trip.id) location.reload(); // 보던 화면(탭) 그대로
      else TC().switchTo(d.trip.id);
    }).catch(function (e) {
      err.textContent = e.message; err.hidden = false; btn.disabled = false;
    });
  }

  function openCreate(opts) {
    open('<h2>새 여행 만들기</h2><p class="tui-sub">만들면 DAY 1 ~ 마지막 날이 생기고, 만든 사람이 관리자가 돼요.</p>' + formHtml(null), '새 여행 만들기');
    if (opts && opts.first && sheet) sheet.querySelector('[data-tui="close"]').hidden = true;
  }

  // ---------------------------------------------------------------------------
  // 관리 (⋯)
  // ---------------------------------------------------------------------------
  function findTrip(id) {
    var list = (TC() && TC().trips) || [];
    var t = list.find(function (x) { return x.id === id; });
    if (!t && TC().trip && TC().trip.id === id) t = TC().trip;
    return t;
  }

  function openManage(id) {
    var t = findTrip(id);
    if (!t) return;
    var admin = !authOn() || t.role === 'admin';
    open('<h2>' + esc(t.title) + '</h2><p class="tui-sub">' + esc(rangeLabel(t)) + ' · ' + esc(t.region) + '</p>' +
      '<div class="tui-menu">' +
      '<button type="button" data-tui="go" data-id="' + t.id + '">👀 이 여행 보기</button>' +
      (admin ? '<button type="button" data-tui="edit" data-id="' + t.id + '">✏️ 이름 · 날짜 · 공개 설정 수정</button>' : '') +
      (admin && authOn() ? '<button type="button" data-tui="code" data-id="' + t.id + '">🎟 참여 코드 보기</button>' : '') +
      (admin ? '<button type="button" class="danger" data-tui="delete" data-id="' + t.id + '">🗑 여행 삭제</button>'
        : '<button type="button" class="danger" data-tui="leave" data-id="' + t.id + '">🚪 이 여행에서 나가기</button>') +
      '</div>', '여행 관리');
  }

  function openEdit(id) {
    api('GET', 'api/trips?id=' + id).then(function (d) {
      open('<h2>여행 수정</h2>' + formHtml(d.trip), '여행 수정');
    }).catch(function (e) { alert(e.message); });
  }

  function openCode(id) {
    api('GET', 'api/trips?id=' + id).then(function (d) {
      var code = d.trip.joinCode || '';
      open('<h2>참여 코드</h2><p class="tui-sub">함께 가는 사람에게 이 코드를 알려 주세요. 로그인 → 코드 입력 → "이 여행에서 나는 누구" 고르기로 참여해요.</p>' +
        '<div class="tui-code"><output data-tui="code-value">' + esc(code) + '</output>' +
        '<button type="button" class="tui-btn" data-tui="copy">복사</button></div>' +
        '<div class="tui-actions"><button type="button" class="tui-btn" data-tui="new-code" data-id="' + id + '">새 코드 만들기</button></div>' +
        '<p class="tui-sub">새 코드를 만들면 예전 코드로는 더 이상 참여할 수 없어요 (이미 참여한 사람은 그대로).</p>', '참여 코드');
    }).catch(function (e) { alert(e.message); });
  }

  function openDelete(id) {
    var t = findTrip(id);
    open('<h2>「' + esc(t.title) + '」을 삭제할까요?</h2>' +
      '<p class="tui-sub">사람 · 지출 · 준비물 · 사진이 모두 지워지고 되돌릴 수 없어요. 함께 가는 사람들에게서도 사라져요.</p>' +
      '<form class="tui-form" data-tui-delete="' + id + '" autocomplete="off"><label>확인을 위해 여행 이름을 입력해 주세요<input name="confirm" placeholder="' + esc(t.title) + '"></label>' +
      '<p class="tui-err" data-tui="err" role="alert" hidden></p>' +
      '<button type="submit" class="tui-btn danger">삭제</button></form>', '여행 삭제');
  }

  // ---------------------------------------------------------------------------
  // 이벤트 (문서 전체에서 받음: 로그인 화면 안의 폼도 같이)
  // ---------------------------------------------------------------------------
  document.addEventListener('submit', function (e) {
    var f = e.target;
    if (f.matches('[data-trip-form]')) { e.preventDefault(); submitForm(f); return; }
    if (f.matches('[data-tui-delete]')) {
      e.preventDefault();
      var id = Number(f.getAttribute('data-tui-delete'));
      var t = findTrip(id);
      var err = f.querySelector('[data-tui="err"]');
      if (f.confirm.value.trim() !== t.title) { err.textContent = '여행 이름이 달라요. 「' + t.title + '」을 그대로 입력해 주세요.'; err.hidden = false; return; }
      f.querySelector('button').disabled = true;
      api('DELETE', 'api/trips?id=' + id).then(function () {
        try { localStorage.removeItem('sosodobo.trip'); } catch (x) { /* 무시 */ }
        location.href = location.pathname;
      }).catch(function (x) { err.textContent = x.message; err.hidden = false; f.querySelector('button').disabled = false; });
    }
  });

  document.addEventListener('click', function (e) {
    if (sheet && e.target === sheet) { close(); return; }
    if (e.target.closest('#nav-trip')) { openSwitcher(); return; }
    var b = e.target.closest('[data-tui]');
    if (!b) return;
    var a = b.getAttribute('data-tui');
    var id = Number(b.getAttribute('data-id'));
    if (a === 'close') close();
    else if (a === 'go') { if (TC().trip && TC().trip.id === id) close(); else TC().switchTo(id); }
    else if (a === 'create') openCreate();
    else if (a === 'join') { close(); if (window.AuthUI) window.AuthUI.showJoin({ back: '내 여행으로' }); }
    else if (a === 'manage') openManage(id);
    else if (a === 'edit') openEdit(id);
    else if (a === 'code') openCode(id);
    else if (a === 'delete') openDelete(id);
    else if (a === 'leave') {
      if (!confirm('이 여행에서 나갈까요? 내가 남긴 기록은 그대로 남고, 다시 참여하려면 참여 코드가 필요해요.')) return;
      api('POST', 'api/trips?id=' + id + '&part=leave').then(function () {
        try { localStorage.removeItem('sosodobo.trip'); } catch (x) { /* 무시 */ }
        location.href = location.pathname;
      }).catch(function (x) { alert(x.message); });
    } else if (a === 'copy') {
      var v = sheet.querySelector('[data-tui="code-value"]').textContent;
      var done = function () { b.textContent = '복사됨 ✓'; };
      if (navigator.clipboard) navigator.clipboard.writeText(v).then(done).catch(function () { window.prompt('코드를 복사해 주세요', v); });
      else window.prompt('코드를 복사해 주세요', v);
    } else if (a === 'new-code') {
      if (!confirm('새 코드를 만들까요? 예전 코드로는 더 이상 참여할 수 없어요.')) return;
      api('POST', 'api/trips?id=' + id + '&part=join-code').then(function (d) {
        sheet.querySelector('[data-tui="code-value"]').textContent = d.joinCode;
      }).catch(function (x) { alert(x.message); });
    }
  });
  document.addEventListener('keydown', function (e) { if (e.key === 'Escape' && sheet) close(); });

  window.TripUI = {
    openSwitcher: openSwitcher,
    openCreate: openCreate,
    openManage: openManage,
    formHtml: formHtml,
    tripListHtml: tripListHtml,
    close: close,
  };
})();
