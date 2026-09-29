/**
 * 티켓 · 예약 문서(항공권 · 인보이스 · 렌터카 · 관광 티켓 등)의 순수 로직.
 * 브라우저 window.DocsCore / 서버 검증 · 테스트에서 require.
 */
(function (root) {
  'use strict';

  var KINDS = [
    { key: 'flight', label: '항공권', icon: '✈️' },
    { key: 'lodging', label: '숙소', icon: '🏨' },
    { key: 'transport', label: '교통', icon: '🚆' },
    { key: 'car', label: '렌터카', icon: '🚗' },
    { key: 'tour', label: '관광 · 입장권', icon: '🎟' },
    { key: 'invoice', label: '인보이스 · 영수증', icon: '🧾' },
    { key: 'other', label: '기타', icon: '📎' },
  ];
  var LIMITS = { titleMax: 60, memoMax: 500, filesPerDoc: 5, fileNameMax: 120, imageMaxEdge: 2400, maxBytes: 15 * 1024 * 1024 };
  var FILE_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'application/pdf'];

  function clean(v) { return v === null || v === undefined ? '' : String(v).trim(); }
  function kindOf(key) { return KINDS.find(function (k) { return k.key === key; }) || KINDS[KINDS.length - 1]; }

  /** 날짜가 여행 몇 일차인지 (기간 밖이거나 없으면 null) */
  function dayOfDate(startDate, days, date) {
    if (!date) return null;
    var a = Date.parse(startDate + 'T00:00:00Z');
    var b = Date.parse(date + 'T00:00:00Z');
    var i = Number.isFinite(a) && Number.isFinite(b) ? Math.round((b - a) / 86400000) : NaN;
    return i >= 0 && i < days ? i + 1 : null;
  }

  /** 이 여행의 문서 저장 위치 (Vercel Blob · trips/<id>/docs/) 인지 */
  function isDocUrl(url, tripId) {
    var v = clean(url);
    if (!/^https:\/\//.test(v)) return false;
    var u;
    try { u = new URL(v); } catch (e) { return false; }
    return /\.blob\.vercel-storage\.com$/.test(u.hostname) &&
      new RegExp('^/trips/' + Number(tripId) + '/docs/[A-Za-z0-9._-]+$').test(u.pathname);
  }

  /** 문서 저장 경로 (브라우저에서 만들어 올림). ext 는 jpg · png · webp · pdf */
  function docPath(tripId, nowMs, rand, ext) {
    var e = String(ext || '').toLowerCase().replace(/[^a-z]/g, '');
    if (e === 'jpeg') e = 'jpg';
    if (['jpg', 'png', 'webp', 'pdf'].indexOf(e) < 0) e = 'bin';
    return 'trips/' + Number(tripId) + '/docs/' + nowMs + '-' + String(rand || '').replace(/[^A-Za-z0-9]/g, '') + '.' + e;
  }

  /** 올릴 수 있는 파일인지 → null 이면 괜찮음, 아니면 안내 문구 */
  function fileProblem(file) {
    var type = (file && file.type) || '';
    var name = (file && file.name) || '';
    var isImage = /^image\//.test(type) || /\.(jpe?g|png|webp|heic|heif)$/i.test(name);
    var isPdf = type === 'application/pdf' || /\.pdf$/i.test(name);
    if (!isImage && !isPdf) return '사진(JPG · PNG) 또는 PDF 만 올릴 수 있어요: ' + name;
    if (isPdf && file.size > LIMITS.maxBytes) return 'PDF 는 15MB 까지 올릴 수 있어요: ' + name;
    return null;
  }

  /**
   * 문서 검증. ctx = { tripId, travelerIds }, partial 이면 수정(들어온 항목만).
   * files: [{ url, name, contentType, size, width, height }]
   * → { value } | { error }
   */
  function validateDoc(input, ctx, opts) {
    var b = input || {};
    var c = ctx || {};
    var partial = !!(opts && opts.partial);
    var has = function (k) { return Object.prototype.hasOwnProperty.call(b, k); };
    var out = {};
    if (!partial || has('kind')) {
      if (!KINDS.some(function (k) { return k.key === b.kind; })) return { error: '종류를 골라 주세요.' };
      out.kind = b.kind;
    }
    if (!partial || has('title')) {
      var title = clean(b.title);
      if (!title) return { error: '제목을 입력해 주세요 (예: 김포 → 제주 대한항공).' };
      if (title.length > LIMITS.titleMax) return { error: '제목은 ' + LIMITS.titleMax + '자 이하로 입력해 주세요.' };
      out.title = title;
    }
    if (!partial || has('memo')) {
      var memo = clean(b.memo);
      if (memo.length > LIMITS.memoMax) return { error: '메모는 ' + LIMITS.memoMax + '자 이하로 입력해 주세요.' };
      out.memo = memo || null;
    }
    if (!partial || has('docDate')) {
      var d = clean(b.docDate);
      if (d && !(/^\d{4}-\d{2}-\d{2}$/.test(d) && new Date(Date.parse(d + 'T00:00:00Z')).toISOString().slice(0, 10) === d)) {
        return { error: '날짜가 올바르지 않아요.' };
      }
      out.docDate = d || null; // 여행 기간 밖(예: 출발 전날 비행기)도 괜찮음
    }
    if (!partial || has('travelerIds')) {
      var ids = (c.travelerIds || []).map(Number);
      var who = Array.isArray(b.travelerIds) ? b.travelerIds.map(Number) : [];
      who = who.filter(function (x, i) { return who.indexOf(x) === i; });
      if (who.some(function (x) { return ids.indexOf(x) < 0; })) return { error: '이 여행에 없는 사람이 들어 있어요.' };
      out.travelerIds = who; // 비어 있으면 "모두"
    }
    if (!partial || has('files')) {
      var files = Array.isArray(b.files) ? b.files : [];
      if (!files.length) return { error: '파일을 하나 이상 올려 주세요.' };
      if (files.length > LIMITS.filesPerDoc) return { error: '파일은 ' + LIMITS.filesPerDoc + '개까지 넣을 수 있어요.' };
      var list = [];
      for (var i = 0; i < files.length; i++) {
        var f = files[i] || {};
        if (!isDocUrl(f.url, c.tripId)) return { error: '올린 파일 주소가 올바르지 않아요.' };
        var type = FILE_TYPES.indexOf(f.contentType) >= 0 ? f.contentType : (/\.pdf$/i.test(f.url) ? 'application/pdf' : 'image/jpeg');
        var w = Number(f.width);
        var h = Number(f.height);
        list.push({
          url: clean(f.url), name: clean(f.name).slice(0, LIMITS.fileNameMax) || null, contentType: type,
          size: Number.isFinite(Number(f.size)) && f.size !== null ? Number(f.size) : null,
          width: Number.isInteger(w) && w > 0 ? w : null, height: Number.isInteger(h) && h > 0 ? h : null,
        });
      }
      out.files = list;
    }
    if (partial && !Object.keys(out).length) return { error: '바꿀 내용이 없어요.' };
    return { value: out };
  }

  /** 날짜순(날짜 없는 것은 뒤) · 같은 날은 만든 순 */
  function sortDocs(docs) {
    return (docs || []).slice().sort(function (a, b) {
      if (!a.docDate && b.docDate) return 1;
      if (a.docDate && !b.docDate) return -1;
      if (a.docDate !== b.docDate) return a.docDate < b.docDate ? -1 : 1;
      return a.id - b.id;
    });
  }

  /** 고치거나 지울 수 있는지: 올린 사람 또는 관리자 (me 가 없으면 = 로그인이 꺼져 있으면 누구나) */
  function canModifyDoc(doc, me) {
    if (!me) return true;
    return me.role === 'admin' || (!!doc && doc.uploaderId === me.travelerId);
  }

  var DocsCore = {
    KINDS: KINDS, LIMITS: LIMITS, FILE_TYPES: FILE_TYPES, kindOf: kindOf, dayOfDate: dayOfDate,
    isDocUrl: isDocUrl, docPath: docPath, fileProblem: fileProblem, validateDoc: validateDoc, sortDocs: sortDocs,
    canModifyDoc: canModifyDoc,
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = DocsCore;
  if (root) root.DocsCore = DocsCore;
})(typeof window !== 'undefined' ? window : null);
