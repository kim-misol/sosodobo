/**
 * 티켓 · 예약 (항공권 · 숙소 · 교통 · 렌터카 · 관광 · 인보이스 …) 화면.
 * 홈에 날짜별 목록, 추가/고치기 시트, 사진 크게 보기(PDF 는 새 탭). 날짜가 있는 티켓은 일정의 그날에도 보여요.
 * 참여자만 봐요 (링크로 구경하는 사람에게는 섹션 자체를 숨김).
 *
 * 필요 전역: DocsCore, TripContext, PhotoUI(파일 올리기), PhotoCore(사진 줄이기)
 */
(function () {
  'use strict';

  var D = window.DocsCore;
  var state = { docs: [], me: null, loaded: false, trip: null, busy: false, error: null, editing: null, pending: [], kept: [] };
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
  function people() {
    var s = window.SettleUI && window.SettleUI.state;
    if (s && s.travelers && s.travelers.length) return s.travelers;
    var p = window.PhotoUI && window.PhotoUI.state;
    return (p && p.travelers) || [];
  }
  function nameOf(id) { var t = people().find(function (x) { return x.id === id; }); return t ? t.name : '?'; }
  function isPdf(f) { return f.contentType === 'application/pdf'; }

  function dateLabel(date) {
    if (!date) return '날짜 없음';
    var d = new Date(Date.parse(date + 'T00:00:00Z'));
    var label = (d.getUTCMonth() + 1) + '/' + d.getUTCDate() + ' (' + '일월화수목금토'[d.getUTCDay()] + ')';
    var day = D.dayOfDate(state.trip.startDate, state.trip.days, date);
    if (day) return label + ' · DAY ' + day;
    return label + (date < state.trip.startDate ? ' · 여행 전' : ' · 여행 후');
  }

  // ---------------------------------------------------------------------------
  // 목록
  // ---------------------------------------------------------------------------
  function fileChipsHtml(doc) {
    return '<div class="dc-files">' + doc.files.map(function (f, i) {
      if (isPdf(f)) {
        return '<a class="dc-pdf" href="' + esc(f.url) + '" target="_blank" rel="noopener">📄 ' + esc(f.name || 'PDF') + '</a>';
      }
      return '<button type="button" class="dc-thumb" data-dc="view" data-doc="' + doc.id + '" data-i="' + i + '" aria-label="' + esc(doc.title) + ' 사진 크게 보기">' +
        '<img src="' + esc(f.url) + '" alt="" loading="lazy"></button>';
    }).join('') + '</div>';
  }

  function docCardHtml(doc) {
    var k = D.kindOf(doc.kind);
    var who = doc.travelerIds.length ? doc.travelerIds.map(nameOf).join(', ') : '모두';
    var can = D.canModifyDoc(doc, state.me);
    return '<article class="dc-card" id="doc-' + doc.id + '"><div class="dc-head"><span class="dc-ico" aria-hidden="true">' + k.icon + '</span>' +
      '<div class="dc-t"><b>' + esc(doc.title) + '</b><span>' + esc(k.label) + ' · ' + esc(who) +
      (doc.uploaderId ? ' · ' + esc(nameOf(doc.uploaderId)) + ' 올림' : '') + '</span></div>' +
      (can ? '<div class="it-row-tools"><button type="button" data-dc="edit" data-doc="' + doc.id + '" aria-label="고치기">✎</button>' +
        '<button type="button" data-dc="del" data-doc="' + doc.id + '" aria-label="지우기">🗑</button></div>' : '') + '</div>' +
      (doc.memo ? '<p class="dc-memo">' + esc(doc.memo) + '</p>' : '') + fileChipsHtml(doc) + '</article>';
  }

  function render() {
    if (!els.box) return;
    var head = '<div class="dc-top"><p>항공권 · 인보이스 · 렌터카 · 관광 티켓을 모아 두면 여행 중에 바로 꺼내 볼 수 있어요. 참여한 사람만 봐요.</p>' +
      '<button type="button" class="st-btn" data-dc="add">＋ 추가</button></div>';
    if (!state.loaded) { els.box.innerHTML = head + '<p class="m-empty">불러오는 중…</p>'; return; }
    if (!state.docs.length) { els.box.innerHTML = head + '<p class="m-empty">아직 올린 티켓 · 예약이 없어요.</p>'; return; }
    var groups = [];
    state.docs.forEach(function (d) {
      var g = groups[groups.length - 1];
      if (!g || g.date !== d.docDate) groups.push(g = { date: d.docDate, docs: [] });
      g.docs.push(d);
    });
    els.box.innerHTML = head + groups.map(function (g) {
      return '<h3 class="dc-date">' + esc(dateLabel(g.date)) + '</h3>' + g.docs.map(docCardHtml).join('');
    }).join('');
  }

  function afterChange(d) {
    state.docs = d.docs || [];
    state.me = d.me || null;
    state.loaded = true;
    render();
    if (window.ItineraryUI && window.ItineraryUI.rerender) window.ItineraryUI.rerender(); // 일정의 그날에도 반영
  }

  function load() {
    return api('GET', 'part=docs').then(afterChange).catch(function (e) {
      state.loaded = true;
      if (els.box) els.box.innerHTML = '<p class="m-empty">⚠️ 티켓 · 예약을 불러오지 못했어요: ' + esc(e.message) + '</p>';
    });
  }

  // ---------------------------------------------------------------------------
  // 사진 크게 보기 (PDF 는 새 탭)
  // ---------------------------------------------------------------------------
  var viewer = null;
  function openViewer(doc, idx) {
    var images = doc.files.filter(function (f) { return !isPdf(f); });
    var start = Math.max(0, images.indexOf(doc.files[idx]));
    closeViewer();
    viewer = document.createElement('div');
    viewer.className = 'dc-viewer';
    viewer.setAttribute('role', 'dialog');
    viewer.setAttribute('aria-label', doc.title);
    var i = start;
    var draw = function () {
      var f = images[i];
      viewer.innerHTML = '<div class="dc-viewer-top"><button type="button" data-dv="close" aria-label="닫기">×</button><span>' + esc(doc.title) +
        (images.length > 1 ? ' · ' + (i + 1) + '/' + images.length : '') + '</span><a href="' + esc(f.url) + '" target="_blank" rel="noopener">원본</a></div>' +
        '<div class="dc-viewer-stage">' + (images.length > 1 ? '<button type="button" class="ph-lb-nav prev" data-dv="prev" aria-label="이전">‹</button>' : '') +
        '<img src="' + esc(f.url) + '" alt="' + esc(doc.title) + '">' +
        (images.length > 1 ? '<button type="button" class="ph-lb-nav next" data-dv="next" aria-label="다음">›</button>' : '') + '</div>';
    };
    draw();
    viewer.addEventListener('click', function (e) {
      var b = e.target.closest('[data-dv]');
      if (!b) { if (e.target === viewer) closeViewer(); return; }
      var a = b.getAttribute('data-dv');
      if (a === 'close') closeViewer();
      if (a === 'prev') { i = (i - 1 + images.length) % images.length; draw(); }
      if (a === 'next') { i = (i + 1) % images.length; draw(); }
    });
    document.body.appendChild(viewer);
    document.body.classList.add('tsheet-open');
  }
  function closeViewer() {
    if (viewer) { viewer.remove(); viewer = null; }
    if (!sheet) document.body.classList.remove('tsheet-open');
  }

  // ---------------------------------------------------------------------------
  // 추가 · 고치기 시트 — 파일은 "저장"을 누를 때 올려요 (취소하면 아무것도 안 올라감)
  // ---------------------------------------------------------------------------
  var sheet = null;
  function openSheet(doc) {
    state.editing = doc || null;
    state.kept = doc ? doc.files.slice() : [];
    state.pending = [];
    state.error = null;
    if (!sheet) {
      sheet = document.createElement('div');
      sheet.className = 'tsheet-scrim';
      sheet.innerHTML = '<div class="tsheet dc-sheet" role="dialog" aria-modal="true" aria-label="티켓 · 예약"></div>';
      document.body.appendChild(sheet);
      document.body.classList.add('tsheet-open');
      sheet.addEventListener('click', onSheetClick);
      sheet.addEventListener('change', onSheetChange);
      sheet.addEventListener('submit', onSubmit);
    }
    drawSheet();
  }
  function closeSheet() {
    if (sheet) { sheet.remove(); sheet = null; }
    state.pending.forEach(function (p) { if (p.preview) URL.revokeObjectURL(p.preview); });
    state.pending = [];
    state.editing = null;
    if (!viewer) document.body.classList.remove('tsheet-open');
  }

  function formValues() {
    var f = sheet && sheet.querySelector('form');
    if (!f) return null;
    return {
      kind: f.kind.value, title: f.title.value, docDate: f.docDate.value, memo: f.memo.value,
      travelerIds: Array.prototype.filter.call(f.querySelectorAll('input[name="who"]'), function (c) { return c.checked; }).map(function (c) { return Number(c.value); }),
    };
  }

  function drawSheet(values) {
    if (!sheet) return;
    var v = values || state.editing || { kind: 'flight', travelerIds: [] };
    var fileCount = state.kept.length + state.pending.length;
    sheet.querySelector('.tsheet').innerHTML = '<span class="tsheet-grab" aria-hidden="true"></span><button type="button" class="tsheet-x" data-dc="close" aria-label="닫기">×</button>' +
      '<h2>' + (state.editing ? '티켓 · 예약 고치기' : '티켓 · 예약 추가') + '</h2>' +
      (state.error ? '<p class="tui-err" role="alert">' + esc(state.error) + '</p>' : '') +
      '<form class="tui-form" autocomplete="off" novalidate>' +
      '<label><span>종류</span><select name="kind">' + D.KINDS.map(function (k) {
        return '<option value="' + k.key + '"' + (v.kind === k.key ? ' selected' : '') + '>' + k.icon + ' ' + k.label + '</option>';
      }).join('') + '</select></label>' +
      '<label><span>제목 <em>*</em></span><input name="title" maxlength="' + D.LIMITS.titleMax + '" value="' + esc(v.title) + '" placeholder="예: 김포 → 제주 대한항공 KE1203"></label>' +
      '<label><span>날짜 <span class="tui-opt">(선택 · 출발일 · 사용일)</span></span><input type="date" name="docDate" value="' + esc(v.docDate) + '"></label>' +
      '<fieldset class="tui-radios"><legend>누구 것 <span class="tui-opt">(아무도 안 고르면 모두)</span></legend><div class="it-guests">' +
      people().map(function (t) {
        return '<label><input type="checkbox" name="who" value="' + t.id + '"' + ((v.travelerIds || []).indexOf(t.id) >= 0 ? ' checked' : '') + '>' + esc(t.name) + '</label>';
      }).join('') + '</div></fieldset>' +
      '<label><span>메모 <span class="tui-opt">(예약번호 · 좌석 · 픽업 장소 등)</span></span><textarea name="memo" maxlength="' + D.LIMITS.memoMax + '" rows="3">' + esc(v.memo) + '</textarea></label>' +
      '<fieldset class="tui-radios"><legend>파일 <span class="tui-opt">(사진 · PDF, 최대 ' + D.LIMITS.filesPerDoc + '개)</span></legend>' +
      '<div class="dc-files dc-edit-files">' +
      state.kept.map(function (f, i) {
        return '<span class="dc-file-chip">' + (isPdf(f) ? '📄 ' + esc(f.name || 'PDF') : '<img src="' + esc(f.url) + '" alt="">') +
          '<button type="button" data-dc="drop-kept" data-i="' + i + '" aria-label="빼기">×</button></span>';
      }).join('') +
      state.pending.map(function (p, i) {
        return '<span class="dc-file-chip new">' + (p.pdf ? '📄 ' + esc(p.file.name) : '<img src="' + esc(p.preview) + '" alt="">') +
          '<button type="button" data-dc="drop-new" data-i="' + i + '" aria-label="빼기">×</button></span>';
      }).join('') +
      (fileCount < D.LIMITS.filesPerDoc ? '<label class="it-add it-upload dc-add-file">+ 파일<input type="file" accept="image/*,application/pdf,.pdf" multiple data-dc="files"></label>' : '') +
      '</div></fieldset>' +
      (state.busy ? '<p class="it-per" role="status">' + esc(state.busy) + '</p>' : '') +
      '<button type="submit" class="tui-btn primary"' + (state.busy ? ' disabled' : '') + '>' + (state.editing ? '저장' : '추가') + '</button></form>';
  }

  function onSheetClick(e) {
    if (e.target === sheet && !state.busy) { closeSheet(); return; }
    var b = e.target.closest('[data-dc]');
    if (!b || state.busy) return;
    var a = b.getAttribute('data-dc');
    var vals = formValues();
    if (a === 'close') closeSheet();
    if (a === 'drop-kept') { state.kept.splice(Number(b.getAttribute('data-i')), 1); drawSheet(vals); }
    if (a === 'drop-new') {
      var p = state.pending.splice(Number(b.getAttribute('data-i')), 1)[0];
      if (p && p.preview) URL.revokeObjectURL(p.preview);
      drawSheet(vals);
    }
  }

  function onSheetChange(e) {
    if (!e.target.matches('[data-dc="files"]')) return;
    var vals = formValues();
    var room = D.LIMITS.filesPerDoc - state.kept.length - state.pending.length;
    var problems = [];
    Array.prototype.slice.call(e.target.files || []).forEach(function (file) {
      var why = D.fileProblem(file);
      if (why) { problems.push(why); return; }
      if (room <= 0) { problems.push('파일은 ' + D.LIMITS.filesPerDoc + '개까지 넣을 수 있어요.'); return; }
      room -= 1;
      var pdf = file.type === 'application/pdf' || /\.pdf$/i.test(file.name);
      state.pending.push({ file: file, pdf: pdf, preview: pdf ? null : URL.createObjectURL(file) });
    });
    state.error = problems.length ? problems[0] : null;
    drawSheet(vals);
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
  function toJpeg(img) {
    var size = window.PhotoCore.fitWithin(img.naturalWidth, img.naturalHeight, D.LIMITS.imageMaxEdge);
    var c = document.createElement('canvas');
    c.width = size.width; c.height = size.height;
    c.getContext('2d').drawImage(img, 0, 0, size.width, size.height);
    return new Promise(function (resolve, reject) {
      c.toBlob(function (b) { if (b) resolve({ blob: b, width: size.width, height: size.height }); else reject(new Error('사진을 변환하지 못했어요.')); }, 'image/jpeg', 0.88);
    });
  }

  /** 새 파일을 저장소에 올리고 [{ url, name, contentType, size, width, height }] 로 */
  async function uploadPending() {
    var out = [];
    for (var i = 0; i < state.pending.length; i++) {
      var p = state.pending[i];
      state.busy = '파일 올리는 중… ' + (i + 1) + '/' + state.pending.length;
      drawSheet(formValues());
      var rand = Math.random().toString(36).slice(2, 10);
      var now = Date.now();
      if (p.pdf) {
        var r = await window.PhotoUI.uploadBlob(D.docPath(state.trip.id, now, rand, 'pdf'), p.file, 'application/pdf');
        out.push({ url: r.url, name: p.file.name, contentType: 'application/pdf', size: p.file.size });
      } else {
        var loaded = await loadImg(p.file);
        try {
          var j = await toJpeg(loaded.img);
          var r2 = await window.PhotoUI.uploadBlob(D.docPath(state.trip.id, now, rand, 'jpg'), j.blob, 'image/jpeg');
          out.push({ url: r2.url, name: p.file.name, contentType: 'image/jpeg', size: j.blob.size, width: j.width, height: j.height });
        } finally {
          URL.revokeObjectURL(loaded.url);
        }
      }
    }
    return out;
  }

  async function onSubmit(e) {
    e.preventDefault();
    if (state.busy) return;
    var vals = formValues();
    var check = D.validateDoc(Object.assign({}, vals, { files: [{ url: 'https://x.blob.vercel-storage.com/trips/' + state.trip.id + '/docs/check.jpg' }] }),
      { tripId: state.trip.id, travelerIds: people().map(function (t) { return t.id; }) });
    if (check.error) { state.error = check.error; drawSheet(vals); return; }
    if (!state.kept.length && !state.pending.length) { state.error = '파일을 하나 이상 올려 주세요.'; drawSheet(vals); return; }
    if (state.pending.length && !(window.PhotoUI && window.PhotoUI.uploadBlob)) { state.error = '파일을 올릴 준비가 안 됐어요. 새로고침한 뒤 다시 시도해 주세요.'; drawSheet(vals); return; }
    state.error = null;
    try {
      var uploaded = await uploadPending();
      state.busy = '저장하는 중…';
      drawSheet(vals);
      var body = Object.assign({}, vals, { files: state.kept.concat(uploaded) });
      if (!state.editing && window.PhotoUI && window.PhotoUI.state) body.uploaderId = window.PhotoUI.state.me;
      var d = state.editing ? await api('PATCH', 'part=doc&doc=' + state.editing.id, body) : await api('POST', 'part=doc', body);
      state.busy = false;
      closeSheet();
      afterChange(d);
    } catch (err) {
      var msg = window.PhotoCore && window.PhotoCore.uploadErrorMessage ? window.PhotoCore.uploadErrorMessage(err && err.message) : { text: err.message };
      state.busy = false;
      state.error = msg.storageMissing ? '파일 저장소(Vercel Blob)가 아직 연결되지 않아 올릴 수 없어요. 연결된 뒤 다시 저장해 주세요.' : msg.text;
      drawSheet(vals);
    }
  }

  // ---------------------------------------------------------------------------
  // 연결
  // ---------------------------------------------------------------------------
  function findDoc(id) { return state.docs.find(function (d) { return d.id === id; }); }

  function onBoxClick(e) {
    var b = e.target.closest('[data-dc]');
    if (!b) return;
    var a = b.getAttribute('data-dc');
    var doc = findDoc(Number(b.getAttribute('data-doc')));
    if (a === 'add') openSheet(null);
    if (a === 'edit' && doc) openSheet(doc);
    if (a === 'view' && doc) openViewer(doc, Number(b.getAttribute('data-i')));
    if (a === 'del' && doc) {
      if (!confirm('「' + doc.title + '」을(를) 지울까요? 올린 파일도 함께 지워져요.')) return;
      api('DELETE', 'part=doc&doc=' + doc.id).then(afterChange).catch(function (err) { alert(err.message); });
    }
  }

  /** 일정의 그날에 보여 줄 티켓 (itinerary-ui.js 가 씀) */
  function forDate(date) {
    return state.docs.filter(function (d) { return d.docDate === date; });
  }

  /** 다른 곳(일정)에서 티켓을 누르면: 사진이면 크게, 아니면 목록의 그 카드로 */
  function open(id) {
    var doc = findDoc(id);
    if (!doc) return;
    var firstImage = doc.files.findIndex(function (f) { return !isPdf(f); });
    if (firstImage >= 0) { openViewer(doc, firstImage); return; }
    if (doc.files[0]) window.open(doc.files[0].url, '_blank', 'noopener');
  }

  document.addEventListener('keydown', function (e) {
    if (e.key !== 'Escape') return;
    if (viewer) closeViewer();
    else if (sheet && !state.busy) closeSheet();
  });

  function init(trip) {
    els.box = document.getElementById('docs');
    if (!els.box || !trip || trip.isMember === false) return; // 구경하는 사람에게는 보이지 않음
    state.trip = trip;
    els.box.hidden = false;
    var intro = document.querySelector('.docs-intro');
    if (intro) intro.hidden = false;
    els.box.addEventListener('click', onBoxClick);
    render();
    load();
  }

  window.DocsUI = { forDate: forDate, open: open, reload: load, state: state };

  var boot = function () { if (window.TripContext) window.TripContext.ready.then(init); };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})();
