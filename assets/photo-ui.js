/**
 * 사진·영상 앨범 화면.
 *
 * 계산·검증은 테스트된 photo-core.js(window.PhotoCore)에 두고, 이 파일은
 * DOM 렌더링·이벤트·네트워크만 다룹니다. (settle-ui.js 와 같은 구조)
 *
 * 필요 전역: PhotoCore, TripPlaces, exifr(assets/vendor), VercelBlobClient(assets/vendor), Carousel
 */
(function () {
  'use strict';

  var P = window.PhotoCore;
  var API = 'api';
  var ME_KEY = 'sosodobo.photos.me';
  var POLL_MS = 30000;

  var $ = function (sel, root) { return (root || document).querySelector(sel); };

  function esc(s) {
    return String(s === null || s === undefined ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  // ---------------------------------------------------------------------------
  // 상태
  // ---------------------------------------------------------------------------
  var state = {
    me: null,            // 내 traveler id
    role: null,          // 이 여행에서 내 역할 (admin 이면 모든 사진 고치기 · 지우기)
    travelers: [],
    photos: [],
    filter: 'all',       // 'all' | 1 | 2 | 3 | 'etc'
    loading: true,
    error: null,
    pending: [],         // 업로드 대기 항목
    uploading: false,
    storageReady: null,  // 사진 저장소(Blob) 연결 여부: null=모름, true, false
    storageMode: null,   // 'token' | 'oidc' — 서버가 알려준 업로드 방식
    lightboxId: null,    // 라이트박스에 열린 사진 id
    infoOpen: false,     // 라이트박스 ⓘ 촬영 정보 패널
    editingMeta: false,  // 시간·위치 수정 폼 열림
    saving: false,
    // 모바일(폭 768px 미만) 전용
    mview: 'all',        // 사진첩 위쪽 탭: 'all' 모두 | 'group' 모아보기 | 'liked' 좋아요
    groupBy: 'person',   // 모아보기 기준: 'person' 올린 사람별 | 'date' 날짜별
    album: null,         // 모아보기에서 연 묶음: { type: 'person'|'date', key }
    sheet: null,         // 크게 보기 위 시트: null | 'comments' | 'info'
  };

  var mobileQuery = window.matchMedia ? window.matchMedia('(max-width: 767px)') : null;
  /** 폰 폭이면 앱 모양(하단 탭·위아래로 넘기는 크게 보기), 아니면 지금 PC 화면 그대로. */
  function isMobile() { return !!(mobileQuery && mobileQuery.matches); }

  var listeners = [];
  function notify() {
    listeners.forEach(function (fn) { try { fn(state); } catch (e) { console.error(e); } });
  }

  var els = {};

  // ---------------------------------------------------------------------------
  // 공통
  // ---------------------------------------------------------------------------
  async function api(path, options) {
    var res = await fetch(API + path, options);
    var data = null;
    try { data = await res.json(); } catch (e) { /* 본문 없음 */ }
    if (!res.ok) throw new Error((data && data.error) || ('요청 실패 (' + res.status + ')'));
    return data;
  }

  function jsonOpts(method, payload) {
    return { method: method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) };
  }

  function readMe() {
    try {
      var v = parseInt(window.localStorage.getItem(ME_KEY), 10);
      return Number.isInteger(v) ? v : null;
    } catch (e) { return null; }
  }

  function saveMe(id) {
    state.me = id;
    try {
      if (id === null) window.localStorage.removeItem(ME_KEY);
      else window.localStorage.setItem(ME_KEY, String(id));
    } catch (e) { /* 저장 불가(사생활 보호 모드 등) → 이번 방문 동안만 기억 */ }
  }

  function nameOf(id) {
    var t = state.travelers.find(function (x) { return x.id === id; });
    return t ? t.name : '알 수 없음';
  }

  function randId() {
    return Math.random().toString(36).slice(2, 10);
  }

  function formatWhen(iso) {
    return P.formatShortDateTimeKo(iso);
  }

  function tripPlaces() {
    return (window.TripPlaces && window.TripPlaces.PLACES) || [];
  }

  /** 1일차 날짜 'YYYY-MM-DD' (assets/places.js). 사진 날짜 ↔ n일차 연결에 씁니다. */
  function tripStart() {
    return (window.TripPlaces && window.TripPlaces.TRIP_START_DATE) || null;
  }

  /** '1일차' → '1일차 · 9/24' (첫날을 알 때만). */
  function dayLabelWithDate(day) {
    var date = P.formatDayDate(day, tripStart());
    return day + '일차' + (date ? ' · ' + date : '');
  }

  /** 지금 보고 있는 목록 (PC · 폰 같음): 좋아요 / 모아보기의 묶음 / 모두(일차 칩으로 거르기) */
  function visiblePhotos() {
    var sorted = P.sortByTakenAt(state.photos);
    if (state.mview === 'liked') return P.likedBy(state.photos, state.me);
    if (state.mview === 'group' && state.album) {
      if (state.album.type === 'person') {
        var known = state.travelers.some(function (t) { return t.id === state.album.key; });
        return sorted.filter(function (p) { return known ? p.uploaderId === state.album.key : !state.travelers.some(function (t) { return t.id === p.uploaderId; }); });
      }
      return P.filterByDay(sorted, state.album.key);
    }
    return P.filterByDay(sorted, state.filter);
  }

  function dayName(day) {
    var names = (window.TripPlaces && window.TripPlaces.DAY_NAMES) || {};
    return names[day] || '';
  }

  function photoById(id) {
    return state.photos.find(function (p) { return p.id === id; }) || null;
  }

  function showStatus(msg, kind) {
    if (!msg) { els.status.style.display = 'none'; return; }
    els.status.textContent = msg;
    els.status.className = 'st-status ' + (kind || 'loading');
    els.status.style.display = 'block';
  }

  // ---------------------------------------------------------------------------
  // 불러오기 (+ 화면이 보일 때만 주기적으로 새로고침)
  // ---------------------------------------------------------------------------
  async function load(opts) {
    var quiet = opts && opts.quiet;
    if (!quiet) { state.loading = true; render(); }
    try {
      var data = await api('/photos');
      state.photos = data.photos || [];
      state.travelers = data.travelers || [];
      state.role = data.me ? data.me.role : null;
      if (state.me !== null && !state.travelers.some(function (t) { return t.id === state.me; })) {
        saveMe(null); // 삭제된 여행자면 다시 고르게
      }
      state.error = null;
    } catch (err) {
      if (!quiet) state.error = err.message;
    } finally {
      state.loading = false;
      render();
      if (state.lightboxId !== null && !lightboxBusy()) renderLightbox();
      if (quiet && state.lightboxId !== null && comments[state.lightboxId]) loadComments(state.lightboxId);
    }
  }

  /** 라이트박스에서 무언가 입력 중이면 새로고침으로 다시 그리지 않습니다. */
  function lightboxBusy() {
    if (state.editingMeta || state.saving || editingCommentId !== null) return true;
    var active = document.activeElement;
    if (active && els.lightbox.contains(active) && active.matches('input, textarea, select')) return true;
    var typed = Array.prototype.some.call(els.lightbox.querySelectorAll('input[type="text"], textarea'), function (el) {
      return el.value.trim() !== '';
    });
    return typed;
  }

  /** 사진 저장소(Blob)가 연결돼 있는지 서버에 물어봅니다 (토큰 값은 받지 않음). */
  async function checkStorage() {
    try {
      var r = await api('/photo-upload');
      state.storageReady = !!(r && r.ready);
      state.storageMode = (r && r.mode) || null;
      state.storageMessage = (r && r.message) || null;
    } catch (e) {
      state.storageReady = null; // 확인 실패는 "모름" — 업로드를 막지 않음
    }
    render();
    return state.storageReady;
  }

  var sectionVisible = false;
  function startPolling() {
    if ('IntersectionObserver' in window) {
      new IntersectionObserver(function (entries) {
        sectionVisible = entries.some(function (e) { return e.isIntersecting; });
      }).observe(els.root);
    } else {
      sectionVisible = true;
    }
    setInterval(function () {
      var lightboxOpen = state.lightboxId !== null;
      if (document.hidden || state.uploading || (!sectionVisible && !lightboxOpen)) return;
      load({ quiet: true });
    }, POLL_MS);
    document.addEventListener('visibilitychange', function () {
      if (!document.hidden && sectionVisible) load({ quiet: true });
    });
  }

  // ---------------------------------------------------------------------------
  // 업로드 준비: EXIF 읽기 → 리사이즈 → 미리보기
  // ---------------------------------------------------------------------------
  async function readExif(file) {
    if (!window.exifr) return null;
    try {
      return await window.exifr.parse(file, {
        tiff: true, exif: true, gps: true,
        xmp: false, icc: false, iptc: false, jfif: false, ihdr: false,
      });
    } catch (e) {
      return null; // EXIF 가 없거나 읽을 수 없는 파일
    }
  }

  function loadImage(file) {
    return new Promise(function (resolve, reject) {
      var url = URL.createObjectURL(file);
      var img = new Image();
      img.onload = function () { resolve({ img: img, url: url }); };
      img.onerror = function () {
        URL.revokeObjectURL(url);
        reject(new Error('이 브라우저에서 열 수 없는 사진 형식이에요. (HEIC 라면 iPhone 설정 → 카메라 → 포맷 → "높은 호환성"으로 찍거나, Safari 에서 올려 주세요.)'));
      };
      img.src = url;
    });
  }

  function canvasToJpeg(source, srcW, srcH, maxEdge, quality) {
    var size = P.fitWithin(srcW, srcH, maxEdge);
    var canvas = document.createElement('canvas');
    canvas.width = size.width;
    canvas.height = size.height;
    var ctx = canvas.getContext('2d');
    ctx.drawImage(source, 0, 0, size.width, size.height);
    return new Promise(function (resolve, reject) {
      canvas.toBlob(function (blob) {
        if (blob) resolve({ blob: blob, width: size.width, height: size.height });
        else reject(new Error('사진을 변환하지 못했어요.'));
      }, 'image/jpeg', quality);
    });
  }

  async function prepareImage(item) {
    var raw = await readExif(item.file);
    var exif = P.extractExif(raw);
    var loaded = await loadImage(item.file);
    try {
      var w = loaded.img.naturalWidth;
      var h = loaded.img.naturalHeight;
      var full = await canvasToJpeg(loaded.img, w, h, P.LIMITS.photoMaxEdge, P.LIMITS.photoQuality);
      var thumb = await canvasToJpeg(loaded.img, w, h, P.LIMITS.thumbMaxEdge, P.LIMITS.thumbQuality);
      item.full = full.blob;
      item.thumb = thumb.blob;
      item.width = full.width;
      item.height = full.height;
    } finally {
      URL.revokeObjectURL(loaded.url);
    }
    item.previewUrl = URL.createObjectURL(item.thumb);
    applyTimeAndPlace(item, exif.exifTime, exif.lat, exif.lng);
    item.camera = exif.camera;
  }

  /** 촬영 시각·위치 기본값 채우기 (EXIF → 파일 시각 → 지금). */
  function applyTimeAndPlace(item, exifTime, lat, lng) {
    var picked = P.pickTakenAt({ exifTime: exifTime, fileModified: item.file.lastModified, uploadedAt: new Date() });
    item.takenAt = picked.takenAt;
    item.takenAtSource = picked.source;
    item.lat = lat;
    item.lng = lng;
    var near = P.nearestPlace(lat, lng, tripPlaces());
    item.placeName = near ? near.name : null;
    item.locationSource = lat !== null ? 'exif' : null;
    item.day = P.suggestDay(item.takenAt, tripStart());
    // 올리기 전에 고쳐도 '원래대로' 되돌릴 수 있게 파일에서 읽은 값을 따로 둡니다.
    var fileTime = picked.source === 'exif' || picked.source === 'file';
    item.original = { takenAt: fileTime ? picked.takenAt : null, takenAtSource: fileTime ? picked.source : null, lat: lat, lng: lng };
  }

  var preparers = { image: prepareImage, video: function (item) { return prepareVideo(item); } };

  async function addFiles(fileList) {
    var files = Array.prototype.slice.call(fileList || []);
    if (!files.length) return;
    var items = files.map(function (file) {
      return { key: randId(), file: file, kind: P.classifyFile(file), status: 'preparing', caption: '', error: null, progress: 0 };
    });
    state.pending = state.pending.concat(items);
    renderPending();
    for (var i = 0; i < items.length; i++) {
      var item = items[i];
      try {
        var prep = preparers[item.kind];
        if (!prep) throw new Error('사진이나 영상만 올릴 수 있어요.');
        await prep(item);
        item.status = 'ready';
      } catch (err) {
        item.status = 'error';
        item.error = err.message;
      }
      renderPending();
    }
  }

  function removePending(key) {
    state.pending = state.pending.filter(function (it) {
      if (it.key === key && it.previewUrl) URL.revokeObjectURL(it.previewUrl);
      return it.key !== key;
    });
    renderPending();
  }

  // ---------------------------------------------------------------------------
  // 업로드: Blob 직접 업로드 → /api/photos 등록
  // ---------------------------------------------------------------------------
  function uploadBlob(path, blob, contentType, onProgress) {
    // 저장소가 토큰 없이(OIDC) 연결돼 있으면 서버가 서명해 준 주소로 올립니다.
    var send = state.storageMode === 'oidc' ? window.VercelBlobClient.uploadPresigned : window.VercelBlobClient.upload;
    return send(path, blob, {
      access: 'public',
      handleUploadUrl: API + '/photo-upload' + (window.TripContext && window.TripContext.trip ? '?trip=' + window.TripContext.trip.id : ''),
      contentType: contentType,
      multipart: blob.size > 8 * 1024 * 1024,
      onUploadProgress: onProgress,
    });
  }

  async function uploadImage(item) {
    var now = Date.now();
    var rand = randId();
    var full = await uploadBlob(P.blobPath('photo', 'jpg', now, rand), item.full, 'image/jpeg', function (e) {
      item.progress = Math.round(e.percentage * 0.9);
      renderPendingProgress(item);
    });
    var thumb = await uploadBlob(P.blobPath('thumb', 'jpg', now, rand), item.thumb, 'image/jpeg');
    return { url: full.url, thumbUrl: thumb.url };
  }

  var uploaders = { image: uploadImage, video: function (item) { return uploadVideo(item); } };

  async function uploadAll() {
    if (state.uploading) return;
    if (!Number.isInteger(state.me)) {
      alert('먼저 "나는 누구?"에서 내 이름을 골라 주세요.');
      return;
    }
    if (!window.VercelBlobClient) {
      alert('업로드 도구를 불러오지 못했어요. 새로고침 후 다시 시도해 주세요.');
      return;
    }
    var ready = state.pending.filter(function (it) { return it.status === 'ready'; });
    if (!ready.length) return;
    if (state.storageReady !== true) await checkStorage();
    if (state.storageReady === false) {
      ready.forEach(function (it) { it.uploadError = P.STORAGE_MISSING_TEXT; });
      renderPending();
      render();
      return;
    }
    state.uploading = true;
    renderPending();
    for (var i = 0; i < ready.length; i++) {
      var item = ready[i];
      item.status = 'uploading';
      item.uploadError = null;
      renderPending();
      try {
        var caption = P.validateCaption(item.caption);
        if (caption.error) throw new Error(caption.error);
        var files = await uploaders[item.kind](item);
        var saved = await api('/photos', jsonOpts('POST', {
          uploaderId: state.me,
          mediaType: item.kind,
          url: files.url,
          thumbUrl: files.thumbUrl,
          width: item.width,
          height: item.height,
          durationSec: item.durationSec || null,
          caption: caption.value,
          day: item.day,
          takenAt: item.takenAt,
          takenAtSource: item.takenAtSource,
          lat: item.lat,
          lng: item.lng,
          placeName: item.placeName,
          locationSource: item.locationSource,
          original: item.original,
          camera: item.camera,
        }));
        state.photos.push(saved);
        removePending(item.key);
      } catch (err) {
        // 준비해 둔 파일은 그대로 두고 "다시 올리기"로 재시도할 수 있게 합니다.
        var msg = P.uploadErrorMessage(err && err.message);
        item.status = 'ready';
        item.progress = 0;
        item.uploadError = msg.text;
        if (msg.storageMissing) {
          // 저장소 문제는 나머지도 똑같이 실패하므로 여기서 멈춥니다.
          state.storageReady = false;
          ready.slice(i + 1).forEach(function (it) { it.uploadError = msg.text; });
          renderPending();
          render();
          break;
        }
      }
      renderPending();
      render();
    }
    state.uploading = false;
    renderPending();
    load({ quiet: true });
  }

  // ---------------------------------------------------------------------------
  // 영상: 길이 확인 → 첫 부분 프레임으로 썸네일 → 원본 그대로 업로드
  // ---------------------------------------------------------------------------
  function waitFor(target, eventName, ms) {
    return new Promise(function (resolve, reject) {
      var timer = setTimeout(function () { cleanup(); reject(new Error('timeout')); }, ms);
      function ok() { cleanup(); resolve(); }
      function fail() { cleanup(); reject(new Error('error')); }
      function cleanup() {
        clearTimeout(timer);
        target.removeEventListener(eventName, ok);
        target.removeEventListener('error', fail);
      }
      target.addEventListener(eventName, ok);
      target.addEventListener('error', fail);
    });
  }

  /** 영상의 지금 프레임이 거의 검은색인지 (작게 그려서 확인). */
  function frameIsBlack(video) {
    try {
      var c = document.createElement('canvas');
      c.width = 24;
      c.height = 24;
      var ctx = c.getContext('2d');
      ctx.drawImage(video, 0, 0, 24, 24);
      return P.isMostlyBlack(ctx.getImageData(0, 0, 24, 24).data);
    } catch (e) {
      return false;
    }
  }

  /** 썸네일을 못 뽑는 브라우저(일부 iOS)용 대체 이미지. */
  function placeholderThumb() {
    var canvas = document.createElement('canvas');
    canvas.width = 480;
    canvas.height = 360;
    var ctx = canvas.getContext('2d');
    ctx.fillStyle = '#36405A';
    ctx.fillRect(0, 0, 480, 360);
    ctx.fillStyle = '#FDFBF5';
    ctx.beginPath();
    ctx.moveTo(205, 140); ctx.lineTo(205, 220); ctx.lineTo(275, 180); ctx.closePath();
    ctx.fill();
    return new Promise(function (resolve) {
      canvas.toBlob(function (b) { resolve({ blob: b, width: 480, height: 360 }); }, 'image/jpeg', 0.8);
    });
  }

  async function prepareVideo(item) {
    var url = URL.createObjectURL(item.file);
    var video = document.createElement('video');
    video.muted = true;
    video.playsInline = true;
    video.preload = 'auto';
    video.src = url;
    try {
      try {
        await waitFor(video, 'loadedmetadata', 15000);
      } catch (e) {
        throw new Error('이 브라우저에서 열 수 없는 영상 형식이에요.');
      }
      item.durationSec = video.duration;
      var check = P.validateVideo({ durationSec: video.duration, size: item.file.size });
      if (check.error) throw new Error(check.error);
      item.width = video.videoWidth || null;
      item.height = video.videoHeight || null;

      var thumb = null;
      try {
        // 앞부분 프레임이 검게 나오면(일부 아이폰 영상) 가운데 지점에서 한 번 더 떠 봅니다.
        var tries = [P.videoThumbTime(video.duration), video.duration / 2];
        for (var ti = 0; ti < tries.length && !thumb; ti++) {
          video.currentTime = tries[ti];
          await waitFor(video, 'seeked', 8000);
          if (!frameIsBlack(video)) {
            thumb = await canvasToJpeg(video, video.videoWidth, video.videoHeight, P.LIMITS.thumbMaxEdge, P.LIMITS.thumbQuality);
          }
        }
      } catch (e) {
        thumb = null;
      }
      if (!thumb) thumb = await placeholderThumb();
      item.thumb = thumb.blob;
      item.previewUrl = URL.createObjectURL(item.thumb);
    } finally {
      video.removeAttribute('src');
      video.load();
      URL.revokeObjectURL(url);
    }
    // 영상 파일의 촬영 시각·위치는 브라우저에서 믿을 만하게 읽기 어려워 파일 시각으로 추정합니다.
    applyTimeAndPlace(item, null, null, null);
    item.camera = null;
  }

  async function uploadVideo(item) {
    var now = Date.now();
    var rand = randId();
    var info = P.videoFileInfo(item.file);
    var main = await uploadBlob(P.blobPath('video', info.ext, now, rand), item.file, info.contentType, function (e) {
      item.progress = Math.round(e.percentage * 0.95);
      renderPendingProgress(item);
    });
    var thumb = await uploadBlob(P.blobPath('thumb', 'jpg', now, rand), item.thumb, 'image/jpeg');
    return { url: main.url, thumbUrl: thumb.url };
  }

  // ---------------------------------------------------------------------------
  // 삭제
  // ---------------------------------------------------------------------------
  async function deletePhoto(id) {
    if (!confirm('앨범에서 삭제할까요? 되돌릴 수 없어요.')) return;
    try {
      await api('/photos?id=' + id + '&travelerId=' + state.me, { method: 'DELETE' });
      state.photos = state.photos.filter(function (p) { return p.id !== id; });
      closeLightbox();
      render();
    } catch (err) {
      alert(err.message);
    }
  }

  // ---------------------------------------------------------------------------
  // 렌더링: 나는 누구 / 필터 / 격자
  // ---------------------------------------------------------------------------
  function renderMe() {
    if (state.lockedMe) {
      els.me.innerHTML = '<span class="ph-hint">👤 <b>' + esc(nameOf(state.me)) + '</b>(으)로 올리고 좋아요·댓글을 남겨요</span>';
      return;
    }
    if (!state.travelers.length) {
      els.me.innerHTML = '<span class="ph-hint">먼저 아래 <a href="#settle">지출·정산</a>의 여행자에 이름을 등록해 주세요.</span>';
      return;
    }
    var opts = ['<option value="">나는 누구?</option>'].concat(state.travelers.map(function (t) {
      return '<option value="' + t.id + '"' + (t.id === state.me ? ' selected' : '') + '>나는 ' + esc(t.name) + '</option>';
    }));
    els.me.innerHTML = '<select id="ph-me-select" class="ph-me-select" aria-label="나는 누구?">' + opts.join('') + '</select>';
  }

  /** 전체 · 1일차 … N일차 · 기타 (N = 여행 일수) */
  function filters() {
    var out = [{ key: 'all', label: '전체' }];
    for (var d = 1; d <= P.LIMITS.tripDays; d++) out.push({ key: d, label: d + '일차' });
    out.push({ key: 'etc', label: '기타' });
    return out;
  }

  function renderTabs() {
    els.tabs.hidden = state.mview !== 'all'; // 일차 칩은 "모두" 탭에서만
    els.tabs.innerHTML = filters().map(function (f) {
      var count = P.filterByDay(state.photos, f.key).length;
      if (f.key === 'etc' && count === 0) return '';
      var active = String(state.filter) === String(f.key);
      var label = typeof f.key === 'number' ? dayLabelWithDate(f.key) : f.label;
      return '<button type="button" class="ph-tab' + (active ? ' active' : '') + '" data-filter="' + f.key + '" aria-pressed="' + active + '">' +
        esc(label) + ' <span class="n">' + count + '</span></button>';
    }).join('');
  }

  function cellBadges(p) {
    var out = [];
    if (p.mediaType === 'video') out.push('<span class="ph-badge play">▶ ' + P.formatDuration(p.durationSec || 0) + '</span>');
    if (p.likeCount) out.push('<span class="ph-badge">♥ ' + p.likeCount + '</span>');
    if (p.commentCount) out.push('<span class="ph-badge">💬 ' + p.commentCount + '</span>');
    return out.length ? '<span class="ph-badges">' + out.join('') + '</span>' : '';
  }

  /** 사진 목록 그리기 (PC · 폰 같은 화면: 위쪽 탭 · 모두 · 모아보기 · 좋아요) */
  function renderGrid() {
    renderMobile();
  }


  function render() {
    if (state.loading && !state.photos.length) showStatus('사진을 불러오는 중…', 'loading');
    else if (state.error) showStatus('⚠️ ' + state.error, 'error');
    else if (state.storageReady === false) showStatus('⚠️ ' + (state.storageMessage || P.STORAGE_MISSING_TEXT), 'error');
    else showStatus(null);
    renderMe();
    renderTabs();
    renderGrid();
    notify();
  }

  // ---------------------------------------------------------------------------
  // 렌더링: 사진첩 (위쪽 탭 · 모두 · 모아보기 · 좋아요) — PC · 폰 공통
  // ---------------------------------------------------------------------------
  var ICONS = {
    all: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true"><rect x="4" y="4" width="7" height="7" rx="1.5"/><rect x="13" y="4" width="7" height="7" rx="1.5"/><rect x="4" y="13" width="7" height="7" rx="1.5"/><rect x="13" y="13" width="7" height="7" rx="1.5"/></svg>',
    group: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round" aria-hidden="true"><rect x="3.5" y="7" width="13" height="12.5" rx="2.5"/><path d="M7.5 4.5h10a3 3 0 0 1 3 3V16"/></svg>',
    heart: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round" aria-hidden="true"><path d="M12 19.5s-7.5-4.4-7.5-10A4.2 4.2 0 0 1 12 7a4.2 4.2 0 0 1 7.5 2.5c0 5.6-7.5 10-7.5 10z"/></svg>',
    comment: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round" aria-hidden="true"><path d="M4.5 11.5a7.5 6.5 0 1 1 3.4 5.5L4.5 19l.9-3.4a6 6 0 0 1-.9-4.1z"/></svg>',
    info: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" aria-hidden="true"><circle cx="12" cy="12" r="8.5"/><path d="M12 11v5.5M12 7.8v.1"/></svg>',
  };

  function cellHtml(p) {
    var alt = (p.caption || '여행 사진') + ' — ' + nameOf(p.uploaderId);
    return '<button type="button" class="ph-cell" data-id="' + p.id + '">' +
      '<img src="' + esc(p.thumbUrl) + '" alt="' + esc(alt) + '" loading="lazy">' + cellBadges(p) + '</button>';
  }

  function renderMobileTabs() {
    var liked = P.likedBy(state.photos, state.me).length;
    els.mtabs.innerHTML = [['all', '모두', ICONS.all], ['group', '모아보기', ICONS.group], ['liked', '좋아요', ICONS.heart]].map(function (t) {
      var on = state.mview === t[0];
      return '<button type="button" role="tab" data-mview="' + t[0] + '" aria-selected="' + on + '">' + t[2] +
        '<span>' + t[1] + (t[0] === 'liked' && liked ? ' ' + liked : '') + '</span></button>';
    }).join('');
  }

  function dayHeading(day, count) {
    if (day === 'etc') return '일차 없음 <span class="ph-muted">' + count + '장</span>';
    var date = P.formatDayDate(day, tripStart());
    return 'DAY ' + day + (dayName(day) ? ' · ' + esc(dayName(day)) : '') +
      ' <span class="ph-muted">' + (date ? date + ' · ' : '') + count + '장</span>';
  }

  function renderMobile() {
    renderMobileTabs();
    var html;
    if (state.loading && !state.photos.length) {
      html = '';
    } else if (!state.photos.length) {
      html = '<p class="ph-empty">아직 올라온 사진이 없어요. ' + (isMobile() ? '가운데 📷 버튼' : '"＋ 올리기"') + '로 첫 사진을 올려 주세요!</p>';
    } else if (state.mview === 'liked') {
      html = mobileLikedHtml();
    } else if (state.mview === 'group') {
      html = state.album ? mobileAlbumHtml() : mobileGroupsHtml();
    } else {
      html = mobileAllHtml();
    }
    els.grid.innerHTML = html;
  }

  function mobileAllHtml() {
    var videos = state.photos.filter(function (p) { return p.mediaType === 'video'; }).length;
    var out = '<div class="ph-m-head"><span>사진 ' + (state.photos.length - videos) + ' · 영상 ' + videos + '</span>' +
      '<button type="button" class="ph-m-link" data-m-action="reel">🎬 슬라이드 영상</button></div>';
    var groups = P.groupByDay(state.photos).filter(function (g) {
      return g.photos.length && (state.filter === 'all' || String(g.day) === String(state.filter));
    });
    if (!groups.length) out += '<p class="ph-empty">이 일차에 올라온 사진이 아직 없어요.</p>';
    groups.forEach(function (g) {
      out += '<h3 class="ph-m-sep">' + dayHeading(g.day, g.photos.length) + '</h3>' +
        '<div class="ph-m-grid">' + g.photos.map(cellHtml).join('') + '</div>';
    });
    return out;
  }

  function stripHtml(photos, type, key) {
    var shown = photos.slice(0, 4);
    return '<button type="button" class="ph-m-strip" data-album="' + type + ':' + key + '" aria-label="모두 보기">' +
      shown.map(function (p, i) {
        var more = i === 3 && photos.length > 4 ? '<span class="ph-m-more">+' + (photos.length - 3) + '</span>' : '';
        return '<span class="ph-m-thumb"><img src="' + esc(p.thumbUrl) + '" alt="" loading="lazy">' + more + '</span>';
      }).join('') + '</button>';
  }

  function mobileGroupsHtml() {
    var out = '<div class="ph-m-seg" role="group" aria-label="모아보기 기준">' +
      '<button type="button" data-groupby="person" aria-pressed="' + (state.groupBy === 'person') + '">올린 사람별</button>' +
      '<button type="button" data-groupby="date" aria-pressed="' + (state.groupBy === 'date') + '">날짜별</button></div>';
    if (state.groupBy === 'person') {
      P.groupByUploader(state.photos, state.travelers).forEach(function (g) {
        out += '<section class="ph-m-album"><div class="ph-m-album-head">' + avatarHtml(g.id, g.name) +
          '<div class="t"><b>' + esc(g.name) + (g.id !== null && g.id === state.me ? ' <span class="ph-m-chip">나</span>' : '') + '</b>' +
          '<span class="ph-muted">' + (g.photos.length ? '사진 ' + g.photos.length + '장' : '아직 올린 사진이 없어요') + '</span></div>' +
          (g.photos.length ? '<button type="button" class="ph-m-link" data-album="person:' + g.id + '">모두 ›</button>' : '') + '</div>' +
          (g.photos.length ? stripHtml(g.photos, 'person', g.id) : '') + '</section>';
      });
    } else {
      P.groupByDay(state.photos).forEach(function (g) {
        out += '<section class="ph-m-album"><div class="ph-m-album-head"><span class="ph-m-avatar day">' + (g.day === 'etc' ? '?' : 'D' + g.day) + '</span>' +
          '<div class="t"><b>' + (g.day === 'etc' ? '일차 없음' : 'DAY ' + g.day + (dayName(g.day) ? ' · ' + esc(dayName(g.day)) : '')) + '</b>' +
          '<span class="ph-muted">' + (g.day === 'etc' ? '' : P.formatDayDate(g.day, tripStart()) + ' · ') + '사진 ' + g.photos.length + '장</span></div>' +
          (g.photos.length ? '<button type="button" class="ph-m-link" data-album="date:' + g.day + '">모두 ›</button>' : '') + '</div>' +
          (g.photos.length ? stripHtml(g.photos, 'date', g.day) : '') + '</section>';
      });
    }
    return out;
  }

  function albumTitle() {
    var a = state.album;
    if (a.type === 'person') return a.key === null ? '알 수 없음' : nameOf(a.key);
    return a.key === 'etc' ? '일차 없음' : 'DAY ' + a.key + (dayName(a.key) ? ' · ' + dayName(a.key) : '');
  }

  function mobileAlbumHtml() {
    var list = visiblePhotos();
    return '<div class="ph-m-head"><button type="button" class="ph-m-back" data-album-back>‹ 모아보기</button>' +
      '<span><b>' + esc(albumTitle()) + '</b> · ' + list.length + '장</span></div>' +
      (list.length ? '<div class="ph-m-grid">' + list.map(cellHtml).join('') + '</div>' : '<p class="ph-empty">사진이 없어요.</p>');
  }

  function mobileLikedHtml() {
    if (!Number.isInteger(state.me)) {
      return '<p class="ph-empty">내 좋아요를 보려면 ' + (isMobile() ? '<b>프로필</b> 탭에서' : '위에서') + ' "나는 누구?"를 먼저 골라 주세요.</p>';
    }
    var list = P.likedBy(state.photos, state.me);
    if (!list.length) {
      return '<div class="ph-m-empty"><span class="big">♡</span><b>내가 좋아요한 사진이 없어요</b>사진을 크게 보고 ♡를 누르면 여기에 모여요.</div>';
    }
    return '<div class="ph-m-head"><span>내가 좋아요한 사진</span><span>' + list.length + '장</span></div>' +
      '<div class="ph-m-grid">' + list.map(cellHtml).join('') + '</div>';
  }

  var AVATAR_COLORS = ['#FFB997', '#D4CCF2', '#B5DFCB', '#DDEFE8', '#FFE4D6', '#EEEAFB', '#CFE3D9'];
  function avatarHtml(id, name) {
    var color = id === null || id === undefined ? '#EEF1EC' : AVATAR_COLORS[Math.abs(id) % AVATAR_COLORS.length];
    return '<span class="ph-m-avatar" style="background:' + color + '">' + esc(String(name || '?').slice(0, 1)) + '</span>';
  }

  // ---------------------------------------------------------------------------
  // 렌더링: 업로드 대기 목록
  // ---------------------------------------------------------------------------
  function dayOptions(selected) {
    var opts = [{ v: '', label: '일차 없음' }];
    for (var d = 1; d <= P.LIMITS.tripDays; d++) opts.push({ v: d, label: dayLabelWithDate(d) });
    return opts.map(function (o) {
      var sel = String(o.v) === String(selected === null || selected === undefined ? '' : selected) ? ' selected' : '';
      return '<option value="' + o.v + '"' + sel + '>' + esc(o.label) + '</option>';
    }).join('');
  }

  function pendingMeta(it) {
    var bits = [];
    if (it.kind === 'video' && it.durationSec) bits.push('🎞 ' + P.formatDuration(it.durationSec));
    if (it.takenAt) {
      var timeNote = it.takenAtSource === 'manual' ? '(직접 입력)' : it.takenAtSource === 'exif' ? '' : '(추정)';
      bits.push('📅 ' + esc(formatWhen(it.takenAt)) + (timeNote ? ' <span class="ph-muted">' + timeNote + '</span>' : ''));
    }
    if (it.placeName) bits.push('📍 ' + esc(it.placeName));
    else if (it.lat !== null && it.lat !== undefined) bits.push('📍 위치 정보 있음');
    else bits.push('<span class="ph-muted">📍 위치 정보 없음</span>');
    return bits.join(' · ');
  }

  /** 올리기 전 시간·장소 고치기 (접었다 펼치기). 시각을 바꾸면 일차도 그 날짜로 맞춰집니다. */
  function pendingEditHtml(it) {
    if (!it.editing) {
      return '<button type="button" class="ph-linkbtn ph-pend-editbtn" data-edit="' + it.key + '">✎ 시간·장소 고치기</button>';
    }
    return '<div class="ph-pend-edit">' +
      '<label><span>촬영 시각 <span class="ph-muted">(한국 시간)</span></span>' +
      '<input type="datetime-local" data-field="takenAt" data-key="' + it.key + '" value="' + esc(P.toKstInputValue(it.takenAt)) + '"></label>' +
      '<label><span>장소</span><select data-field="place" data-key="' + it.key + '">' + placeOptionsHtml(it, it.placeCustom ? 'custom' : null) + '</select></label>' +
      '<input type="text" data-field="placeName" data-key="' + it.key + '" maxlength="' + P.LIMITS.placeNameMax +
      '" placeholder="장소 이름 (예: 지족해협 죽방렴)"' + (it.placeCustom ? '' : ' hidden') + ' value="' +
      esc(it.placeCustom && it.locationSource === 'manual' ? it.placeName || '' : '') + '">' +
      '<button type="button" class="ph-linkbtn" data-edit="' + it.key + '">접기</button>' +
      '</div>';
  }

  function renderPending() {
    if (!state.pending.length) {
      els.pending.innerHTML = '';
      els.pending.hidden = true;
      return;
    }
    els.pending.hidden = false;
    var readyCount = state.pending.filter(function (it) { return it.status === 'ready'; }).length;
    var retrying = state.pending.some(function (it) { return it.status === 'ready' && it.uploadError; });
    var rows = state.pending.map(function (it) {
      var thumb = it.previewUrl
        ? '<img src="' + esc(it.previewUrl) + '" alt="">'
        : '<span class="ph-pend-ph">' + (it.status === 'error' ? '⚠️' : '⏳') + '</span>';
      var body;
      if (it.status === 'preparing') {
        body = '<div class="ph-pend-name">' + esc(it.file.name) + '</div><div class="ph-muted">준비 중…</div>';
      } else if (it.status === 'error') {
        body = '<div class="ph-pend-name">' + esc(it.file.name) + '</div><div class="ph-err">' + esc(it.error) + '</div>';
      } else {
        var disabled = it.status === 'uploading' ? ' disabled' : '';
        body = '<div class="ph-pend-meta">' + pendingMeta(it) + '</div>' +
          '<div class="ph-pend-fields">' +
          '<select data-field="day" data-key="' + it.key + '" aria-label="일차"' + disabled + '>' + dayOptions(it.day) + '</select>' +
          '<input type="text" data-field="caption" data-key="' + it.key + '" maxlength="' + P.LIMITS.captionMax +
          '" placeholder="한 줄 캡션 (선택)" value="' + esc(it.caption) + '"' + disabled + '>' +
          '</div>' +
          (it.status === 'uploading' ? '' : pendingEditHtml(it)) +
          (it.uploadError && it.status !== 'uploading' ? '<div class="ph-err" style="margin-top:6px">⚠️ ' + esc(it.uploadError) + '</div>' : '') +
          (it.status === 'uploading'
            ? '<div class="ph-progress"><span data-progress="' + it.key + '" style="width:' + it.progress + '%"></span></div>'
            : '');
      }
      var remove = it.status === 'uploading' ? '' :
        '<button type="button" class="ph-x" data-remove="' + it.key + '" aria-label="목록에서 빼기">×</button>';
      return '<div class="ph-pend-row">' + '<div class="ph-pend-thumb">' + thumb + '</div>' +
        '<div class="ph-pend-body">' + body + '</div>' + remove + '</div>';
    }).join('');
    els.pending.innerHTML =
      '<div class="ph-pend-head"><b>올릴 사진·영상 ' + state.pending.length + '개</b>' +
      (state.me === null ? ' <span class="ph-err">— "나는 누구?"를 먼저 골라 주세요</span> ' + pendingMeSelectHtml() : '') + '</div>' +
      rows +
      '<div class="ph-pend-actions">' +
      '<button type="button" class="st-btn" data-action="upload"' + (state.uploading || !readyCount ? ' disabled' : '') + '>' +
      (state.uploading ? '올리는 중…' : readyCount + '개 ' + (retrying ? '다시 올리기' : '올리기')) + '</button>' +
      '<button type="button" class="st-linkbtn" data-action="clear"' + (state.uploading ? ' disabled' : '') + '>모두 취소</button>' +
      '</div>';
  }

  function pendingMeSelectHtml() {
    if (state.lockedMe || !state.travelers.length) return '';
    return '<select data-pend-me aria-label="나는 누구?"><option value="">나는 누구?</option>' + state.travelers.map(function (t) {
      return '<option value="' + t.id + '">나는 ' + esc(t.name) + '</option>';
    }).join('') + '</select>';
  }

  function renderPendingProgress(item) {
    var bar = els.pending.querySelector('[data-progress="' + item.key + '"]');
    if (bar) bar.style.width = item.progress + '%';
  }

  // ---------------------------------------------------------------------------
  // 라이트박스
  // ---------------------------------------------------------------------------
  function openLightbox(id) {
    state.lightboxId = id;
    els.lightbox.hidden = false;
    document.body.classList.add('ph-noscroll');
    if (isMobile()) openFeed(id);
    else renderLightbox();
    els.lightbox.focus();
  }

  // ---------------------------------------------------------------------------
  // 모바일 크게 보기: 위아래로 넘기는 세로 피드 + 오른쪽 ♡·💬·ⓘ, 정보·댓글은 아래 시트
  // ---------------------------------------------------------------------------
  var feed = null; // { ids: [], observer }

  function slideMediaHtml(p) {
    if (p.mediaType === 'video') {
      return '<video src="' + esc(p.url) + '" poster="' + esc(p.thumbUrl) + '" controls playsinline preload="none"></video>';
    }
    return '<img src="' + esc(p.url) + '" alt="' + esc(p.caption || '여행 사진') + '" loading="lazy">';
  }

  function railHtml(p) {
    var on = P.hasLiked(p, state.me);
    var cmt = comments[p.id] && comments[p.id].loaded ? comments[p.id].list.length : (p.commentCount || 0);
    return '<button type="button" data-action="like" aria-pressed="' + on + '" aria-label="좋아요">' + ICONS.heart + '<span>' + (p.likeCount || 0) + '</span></button>' +
      '<button type="button" data-action="sheet-comments" aria-label="댓글">' + ICONS.comment + '<span>' + cmt + '</span></button>' +
      '<button type="button" data-action="sheet-info" aria-label="사진 정보">' + ICONS.info + '<span>정보</span></button>';
  }

  function slideMetaHtml(p) {
    var where = p.placeName ? ' · 📍 ' + esc(p.placeName) : '';
    var day = p.day ? ' · DAY ' + p.day : '';
    return avatarHtml(p.uploaderId, nameOf(p.uploaderId)) + '<div><b>' + esc(nameOf(p.uploaderId)) + '</b>' +
      '<span>' + esc(formatWhen(p.takenAt)) + day + where + '</span>' +
      (p.caption ? '<p>' + esc(p.caption) + '</p>' : '') + '</div>';
  }

  function slideHtml(p) {
    return '<section class="ph-slide" data-id="' + p.id + '">' +
      '<div class="ph-slide-media">' + slideMediaHtml(p) + '</div>' +
      '<div class="ph-slide-meta" data-slot="meta">' + slideMetaHtml(p) + '</div>' +
      '<div class="ph-rail" data-slot="rail">' + railHtml(p) + '</div></section>';
  }

  function openFeed(id) {
    var list = visiblePhotos();
    if (!list.some(function (p) { return p.id === id; })) list = P.sortByTakenAt(state.photos);
    feed = { ids: list.map(function (p) { return p.id; }), observer: null };
    state.sheet = null;
    els.lightbox.classList.add('feed');
    els.lightbox.innerHTML =
      '<div class="ph-feed-top"><button type="button" class="ph-lb-close" data-action="close" aria-label="닫기">×</button>' +
      '<span class="ph-lb-count" data-slot="count"></span><span class="ph-feed-spacer"></span></div>' +
      '<div class="ph-feed" data-slot="feed">' + list.map(slideHtml).join('') + '</div>' +
      '<div data-slot="sheet"></div>';
    var box = els.lightbox.querySelector('[data-slot="feed"]');
    var idx = feed.ids.indexOf(id);
    box.scrollTop = box.clientHeight * Math.max(0, idx);
    updateFeedCount();
    if ('IntersectionObserver' in window) {
      feed.observer = new IntersectionObserver(function (entries) {
        entries.forEach(function (en) {
          var v = en.target.querySelector('video');
          if (!en.isIntersecting && v && !v.paused) v.pause();
          if (en.isIntersecting && en.intersectionRatio >= 0.6 && !state.sheet) {
            state.lightboxId = Number(en.target.getAttribute('data-id'));
            state.editingMeta = false;
            updateFeedCount();
          }
        });
      }, { root: box, threshold: [0, 0.6] });
      Array.prototype.forEach.call(box.children, function (el) { feed.observer.observe(el); });
    }
  }

  function updateFeedCount() {
    var el = els.lightbox.querySelector('[data-slot="count"]');
    if (!el || !feed) return;
    el.textContent = (feed.ids.indexOf(state.lightboxId) + 1) + ' / ' + feed.ids.length;
  }

  function closeFeed() {
    if (feed && feed.observer) feed.observer.disconnect();
    feed = null;
    state.sheet = null;
    els.lightbox.classList.remove('feed');
  }

  /** 피드 전체를 다시 만들지 않고 (스크롤 위치 유지) 지금 사진의 버튼 숫자와 시트만 새로 그립니다. */
  function renderFeedParts() {
    var p = photoById(state.lightboxId);
    if (!p) { closeLightbox(); return; }
    var slide = els.lightbox.querySelector('.ph-slide[data-id="' + p.id + '"]');
    if (slide) {
      slide.querySelector('[data-slot="rail"]').innerHTML = railHtml(p);
      slide.querySelector('[data-slot="meta"]').innerHTML = slideMetaHtml(p);
    }
    renderSheet();
  }

  function renderSheet() {
    var box = els.lightbox.querySelector('[data-slot="sheet"]');
    if (!box) return;
    var p = photoById(state.lightboxId);
    if (!state.sheet || !p) { box.innerHTML = ''; return; }
    var mine = P.canManagePhoto(p, state.me, state.role);
    var body;
    if (state.sheet === 'comments') {
      body = commentsSectionHtml(p);
    } else {
      body = '<div class="ph-sheet-title">사진 정보</div>' +
        (p.likeCount ? '<div class="ph-likers">♥ ' + esc(P.likeSummary(p.likedBy, nameOf)) + '</div>' : '') +
        (p.caption ? '<p class="ph-lb-caption">' + esc(p.caption) + '</p>' : '') +
        infoPanelHtml(p, mine) +
        (state.editingMeta ? '' : '<div class="ph-lb-actions">' +
          '<a class="ph-act" href="' + esc(p.url) + '?download=1" download>⬇ 다운로드</a>' +
          (mine ? '<button type="button" class="ph-act danger" data-action="delete">🗑 삭제</button>' : '') + '</div>');
    }
    box.innerHTML = '<div class="ph-sheet-scrim" data-action="sheet-close"><div class="ph-sheet" role="dialog" aria-modal="true" aria-label="' +
      (state.sheet === 'comments' ? '댓글' : '사진 정보') + '"><span class="ph-sheet-grab" aria-hidden="true"></span>' + body + '</div></div>';
    if (state.sheet === 'comments') ensureComments(p.id);
  }

  function closeLightbox() {
    if (state.lightboxId === null) return;
    closeFeed();
    state.lightboxId = null;
    state.editingMeta = false;
    editingCommentId = null;
    var v = els.lightbox.querySelector('video');
    if (v) v.pause();
    els.lightbox.hidden = true;
    els.lightbox.innerHTML = '';
    document.body.classList.remove('ph-noscroll');
  }

  function step(delta) {
    if (feed) {
      var box = els.lightbox.querySelector('[data-slot="feed"]');
      if (box) box.scrollBy({ top: delta * box.clientHeight, behavior: 'smooth' });
      return;
    }
    var list = visiblePhotos();
    var idx = list.findIndex(function (p) { return p.id === state.lightboxId; });
    if (idx < 0 || list.length < 2) return;
    var next = delta > 0 ? window.Carousel.nextIndex(idx, list.length) : window.Carousel.prevIndex(idx, list.length);
    state.lightboxId = list[next].id;
    state.editingMeta = false;
    editingCommentId = null;
    renderLightbox();
  }

  function mediaHtml(p) {
    if (p.mediaType === 'video') {
      return '<video src="' + esc(p.url) + '" poster="' + esc(p.thumbUrl) + '" controls playsinline preload="metadata"></video>';
    }
    return '<img src="' + esc(p.url) + '" alt="' + esc(p.caption || '여행 사진') + '">';
  }

  /** 라이트박스 하단 정보 영역. 2단계 이후 기능이 여기에 확장됩니다. */
  var lightboxExtras = [];

  function renderLightbox() {
    if (feed) { renderFeedParts(); return; }
    var p = photoById(state.lightboxId);
    if (!p) { closeLightbox(); return; }
    var list = visiblePhotos();
    var idx = list.findIndex(function (x) { return x.id === p.id; });
    var mine = P.canManagePhoto(p, state.me, state.role);
    var where = p.placeName ? ' · 📍 ' + esc(p.placeName) : '';
    var dayLabel = p.day ? ' · ' + p.day + '일차' : '';

    var extras = lightboxExtras.map(function (fn) { return fn(p, mine); }).join('');

    els.lightbox.innerHTML =
      '<div class="ph-lb-top">' +
      '<span class="ph-lb-count">' + (idx + 1) + ' / ' + list.length + '</span>' +
      '<button type="button" class="ph-lb-close" data-action="close" aria-label="닫기">×</button>' +
      '</div>' +
      '<div class="ph-lb-stage">' +
      (list.length > 1 ? '<button type="button" class="ph-lb-nav prev" data-action="prev" aria-label="이전">‹</button>' : '') +
      '<div class="ph-lb-media">' + mediaHtml(p) + '</div>' +
      (list.length > 1 ? '<button type="button" class="ph-lb-nav next" data-action="next" aria-label="다음">›</button>' : '') +
      '</div>' +
      '<div class="ph-lb-panel">' +
      '<div class="ph-lb-who"><b>' + esc(nameOf(p.uploaderId)) + '</b>' +
      '<span class="ph-muted"> · ' + esc(formatWhen(p.takenAt)) + dayLabel + where + '</span></div>' +
      (p.caption ? '<p class="ph-lb-caption">' + esc(p.caption) + '</p>' : '') +
      '<div class="ph-lb-actions" data-slot="actions">' +
      likeButtonHtml(p) +
      '<button type="button" class="ph-act' + (state.infoOpen ? ' on' : '') + '" data-action="info" aria-expanded="' + state.infoOpen + '">ⓘ 정보</button>' +
      '<a class="ph-act" href="' + esc(p.url) + '?download=1" download>⬇ 다운로드</a>' +
      (mine ? '<button type="button" class="ph-act danger" data-action="delete">🗑 삭제</button>' : '') +
      '</div>' +
      (p.likeCount ? '<div class="ph-likers">' + esc(P.likeSummary(p.likedBy, nameOf)) + '</div>' : '') +
      (state.infoOpen ? infoPanelHtml(p, mine) : '') +
      commentsSectionHtml(p) +
      extras +
      '</div>';
    ensureComments(p.id);
  }

  // ---------------------------------------------------------------------------
  // 좋아요 (누르는 즉시 화면에 반영 → 서버 응답으로 맞추고, 실패하면 되돌림)
  // ---------------------------------------------------------------------------
  function likeButtonHtml(p) {
    var on = P.hasLiked(p, state.me);
    return '<button type="button" class="ph-act like' + (on ? ' on' : '') + '" data-action="like" aria-pressed="' + on + '">' +
      (on ? '♥' : '♡') + ' 좋아요' + (p.likeCount ? ' ' + p.likeCount : '') + '</button>';
  }

  var likeInFlight = {};

  function replacePhoto(updated) {
    state.photos = state.photos.map(function (x) { return x.id === updated.id ? updated : x; });
  }

  async function toggleLike(id) {
    if (!Number.isInteger(state.me)) { alert('먼저 "나는 누구?"에서 내 이름을 골라 주세요.'); return; }
    if (likeInFlight[id]) return;
    var before = photoById(id);
    if (!before) return;
    var wasLiked = P.hasLiked(before, state.me);
    replacePhoto(P.toggleLike(before, state.me));
    renderLightbox();
    renderGrid();
    likeInFlight[id] = true;
    try {
      var result = wasLiked
        ? await api('/photo-likes?photoId=' + id + '&travelerId=' + state.me, { method: 'DELETE' })
        : await api('/photo-likes', jsonOpts('POST', { photoId: id, travelerId: state.me }));
      var cur = photoById(id);
      if (cur) replacePhoto(Object.assign({}, cur, { likeCount: result.likeCount, likedBy: result.likedBy }));
    } catch (err) {
      var cur2 = photoById(id);
      if (cur2) replacePhoto(Object.assign({}, cur2, { likeCount: before.likeCount, likedBy: before.likedBy }));
      alert('좋아요를 저장하지 못했어요: ' + err.message);
    } finally {
      likeInFlight[id] = false;
      if (state.lightboxId === id && !lightboxBusy()) renderLightbox();
      renderGrid();
    }
  }

  // ---------------------------------------------------------------------------
  // 댓글 (라이트박스를 열 때 불러오고, 목록 부분만 따로 다시 그려 입력 중인 글을 지키기)
  // ---------------------------------------------------------------------------
  var comments = {};          // photoId → { list: [], loaded: bool, error: string|null }
  var editingCommentId = null;
  var commentBusy = false;

  function commentItemHtml(c) {
    var mine = Number.isInteger(state.me) && P.canModify(c, state.me, 'authorId');
    if (editingCommentId === c.id) {
      return '<li class="ph-cmt editing" data-comment="' + c.id + '">' +
        '<form class="ph-cmt-edit-form" data-id="' + c.id + '" autocomplete="off">' +
        '<textarea name="content" rows="2" maxlength="' + P.LIMITS.commentMax + '">' + esc(c.content) + '</textarea>' +
        '<div class="ph-lb-actions"><button type="submit" class="ph-act on"' + (commentBusy ? ' disabled' : '') + '>저장</button>' +
        '<button type="button" class="ph-act" data-action="comment-edit-cancel">취소</button></div>' +
        '</form></li>';
    }
    return '<li class="ph-cmt" data-comment="' + c.id + '">' +
      '<div class="ph-cmt-head"><b>' + esc(nameOf(c.authorId)) + '</b>' +
      '<span class="ph-muted"> · ' + esc(P.formatRelativeTime(c.createdAt)) +
      (P.isCommentEdited(c) ? ' · 수정됨' : '') + '</span>' +
      (mine ? '<span class="ph-cmt-tools">' +
        '<button type="button" class="ph-linkbtn" data-action="comment-edit" data-id="' + c.id + '">수정</button>' +
        '<button type="button" class="ph-linkbtn" data-action="comment-delete" data-id="' + c.id + '">삭제</button>' +
        '</span>' : '') +
      '</div><div class="ph-cmt-body">' + esc(c.content) + '</div></li>';
  }

  function commentListHtml(photoId) {
    var c = comments[photoId];
    if (!c || !c.loaded) return '<li class="ph-muted ph-cmt-empty">' + (c && c.error ? '⚠️ ' + esc(c.error) : '댓글 불러오는 중…') + '</li>';
    if (!c.list.length) return '<li class="ph-muted ph-cmt-empty">첫 댓글을 남겨 보세요.</li>';
    return c.list.map(commentItemHtml).join('');
  }

  function commentsSectionHtml(p) {
    var count = comments[p.id] && comments[p.id].loaded ? comments[p.id].list.length : p.commentCount;
    return '<div class="ph-comments" data-slot="comments">' +
      '<div class="ph-cmt-title">💬 댓글 <span data-slot="comment-count">' + (count || 0) + '</span></div>' +
      '<ul class="ph-cmt-list" data-slot="comment-list">' + commentListHtml(p.id) + '</ul>' +
      '<form class="ph-cmt-form" autocomplete="off">' +
      '<input type="text" name="content" maxlength="' + P.LIMITS.commentMax + '" placeholder="' +
      (Number.isInteger(state.me) ? nameOf(state.me) + '(으)로 댓글 달기' : '"나는 누구?"를 먼저 골라 주세요') + '"' +
      (Number.isInteger(state.me) ? '' : ' disabled') + '>' +
      '<button type="submit" class="ph-act on"' + (Number.isInteger(state.me) ? '' : ' disabled') + '>등록</button>' +
      '</form></div>';
  }

  /** 목록·개수만 다시 그림 (입력창은 그대로). */
  function refreshCommentList(photoId) {
    if (state.lightboxId !== photoId || editingCommentId !== null) return;
    var list = els.lightbox.querySelector('[data-slot="comment-list"]');
    var count = els.lightbox.querySelector('[data-slot="comment-count"]');
    if (list) list.innerHTML = commentListHtml(photoId);
    if (count && comments[photoId] && comments[photoId].loaded) count.textContent = comments[photoId].list.length;
    if (feed) {
      var rail = els.lightbox.querySelector('.ph-slide[data-id="' + photoId + '"] [data-slot="rail"]');
      var p = photoById(photoId);
      if (rail && p) rail.innerHTML = railHtml(p);
    }
  }

  function syncCommentCount(photoId) {
    var c = comments[photoId];
    var p = photoById(photoId);
    if (!c || !c.loaded || !p || p.commentCount === c.list.length) return;
    replacePhoto(Object.assign({}, p, { commentCount: c.list.length }));
    renderGrid();
  }

  async function loadComments(photoId) {
    var entry = comments[photoId] || (comments[photoId] = { list: [], loaded: false, error: null });
    try {
      var data = await api('/photo-comments?photoId=' + photoId);
      entry.list = data.comments || [];
      entry.loaded = true;
      entry.error = null;
    } catch (err) {
      if (!entry.loaded) entry.error = err.message;
    }
    refreshCommentList(photoId);
    syncCommentCount(photoId);
  }

  function ensureComments(photoId) {
    if (!comments[photoId]) loadComments(photoId);
  }

  async function addComment(form) {
    var photoId = state.lightboxId;
    var check = P.validateComment(form.content.value);
    if (check.error) { alert(check.error); return; }
    if (commentBusy) return;
    commentBusy = true;
    form.querySelector('button[type="submit"]').disabled = true;
    try {
      var created = await api('/photo-comments', jsonOpts('POST', { photoId: photoId, travelerId: state.me, content: check.value }));
      var entry = comments[photoId] || (comments[photoId] = { list: [], loaded: true, error: null });
      entry.list.push(created);
      entry.loaded = true;
      form.content.value = '';
      refreshCommentList(photoId);
      syncCommentCount(photoId);
    } catch (err) {
      alert('댓글을 저장하지 못했어요: ' + err.message);
    } finally {
      commentBusy = false;
      var btn = form.querySelector('button[type="submit"]');
      if (btn) btn.disabled = false;
    }
  }

  async function saveCommentEdit(form) {
    var id = Number(form.getAttribute('data-id'));
    var photoId = state.lightboxId;
    var check = P.validateComment(form.content.value);
    if (check.error) { alert(check.error); return; }
    commentBusy = true;
    try {
      var updated = await api('/photo-comments?id=' + id, jsonOpts('PATCH', { travelerId: state.me, content: check.value }));
      var entry = comments[photoId];
      if (entry) entry.list = entry.list.map(function (c) { return c.id === id ? updated : c; });
      editingCommentId = null;
    } catch (err) {
      alert('댓글을 수정하지 못했어요: ' + err.message);
    } finally {
      commentBusy = false;
      refreshCommentList(photoId);
    }
  }

  async function deleteComment(id) {
    if (!confirm('이 댓글을 삭제할까요?')) return;
    var photoId = state.lightboxId;
    try {
      await api('/photo-comments?id=' + id + '&travelerId=' + state.me, { method: 'DELETE' });
      var entry = comments[photoId];
      if (entry) entry.list = entry.list.filter(function (c) { return c.id !== id; });
      refreshCommentList(photoId);
      syncCommentCount(photoId);
    } catch (err) {
      alert('댓글을 삭제하지 못했어요: ' + err.message);
    }
  }

  // ---------------------------------------------------------------------------
  // ⓘ 촬영 정보 패널
  // ---------------------------------------------------------------------------
  function infoRow(icon, label, valueHtml) {
    return '<div class="ph-info-row"><span class="ph-info-ico" aria-hidden="true">' + icon + '</span>' +
      '<span class="ph-info-label">' + label + '</span><span class="ph-info-val">' + valueHtml + '</span></div>';
  }

  var editedTag = '<span class="ph-tag">✎ 수정됨</span>';

  /** 고치기 · 지우기는 내가 올린 사진만, 여행 관리자는 모든 사진 (서버에서도 같은 규칙) */
  function canEditMeta(p) {
    return Number.isInteger(state.me) && P.canManagePhoto(p, state.me, state.role);
  }

  function infoPanelHtml(p, mine) {
    if (canEditMeta(p) && state.editingMeta) return editFormHtml(p, mine);
    var edited = P.isEdited(p);
    var rows = [];

    var when = P.formatDateTimeKo(p.takenAt);
    var note = p.takenAtSource !== 'manual' ? P.takenAtNote(p.takenAtSource) : '';
    rows.push(infoRow('📅', '촬영', when
      ? esc(when) + (note ? ' <span class="ph-muted">(' + esc(note) + ')</span>' : '') + (edited.time ? ' ' + editedTag : '')
      : '<span class="ph-muted">알 수 없음</span>'));

    var hasCoords = p.lat !== null && p.lat !== undefined;
    if (hasCoords || p.placeName) {
      var place = [];
      if (p.placeName) place.push('<b>' + esc(p.placeName) + '</b>');
      if (hasCoords) place.push('<span class="ph-muted">' + esc(P.formatCoords(p.lat, p.lng)) + '</span>');
      var links = P.mapLinks(p.lat, p.lng, p.placeName);
      if (links) {
        place.push('<span class="ph-maplinks"><a href="' + esc(links.kakao) + '" target="_blank" rel="noopener">카카오맵</a>' +
          '<a href="' + esc(links.google) + '" target="_blank" rel="noopener">구글 지도</a></span>');
      }
      rows.push(infoRow('📍', '위치', place.join('<br>') + (edited.location ? ' ' + editedTag : '')));
    } else {
      rows.push(infoRow('📍', '위치', '<span class="ph-muted">위치 정보 없음</span>'));
    }

    P.summarizeCamera(p.camera).forEach(function (line) {
      var icon = { device: '📷', lens: '🔭', exposure: '⚙️', flash: '⚡' }[line.key] || '•';
      rows.push(infoRow(icon, line.label, esc(line.text)));
    });

    if (p.mediaType === 'video' && p.durationSec) {
      rows.push(infoRow('🎞', '길이', P.formatDuration(p.durationSec)));
    }
    if (p.width && p.height) {
      rows.push(infoRow('🖼', '크기', p.width + '×' + p.height + ' <span class="ph-muted">(앨범 저장본)</span>'));
    }

    var editBtn = canEditMeta(p) && lightboxActions['edit-meta']
      ? '<button type="button" class="ph-act" data-action="edit-meta">✎ 수정</button>' : '';
    return '<div class="ph-info" data-slot="info">' + rows.join('') +
      (editBtn ? '<div class="ph-lb-actions">' + editBtn + '</div>' : '') + '</div>';
  }

  var touchX = null;
  function bindLightbox() {
    els.lightbox.addEventListener('click', function (e) {
      var t = e.target.closest('[data-action]');
      if (!t) {
        if (e.target === els.lightbox) closeLightbox();
        return;
      }
      var a = t.getAttribute('data-action');
      var slide = t.closest('.ph-slide');
      if (slide) state.lightboxId = Number(slide.getAttribute('data-id'));
      // 시트 바깥(어두운 부분)을 눌렀을 때만 닫기
      if (a === 'sheet-close' && e.target !== t && !e.target.closest('.ph-sheet-x')) return;
      if (a === 'close') closeLightbox();
      else if (a === 'prev') step(-1);
      else if (a === 'next') step(1);
      else if (a === 'delete') deletePhoto(state.lightboxId);
      else if (lightboxActions[a]) lightboxActions[a](t, e);
    });
    // 버튼을 누르면 라이트박스 내용이 다시 그려져 포커스가 사라지므로 문서 전체에서 키를 받습니다.
    document.addEventListener('keydown', function (e) {
      if (state.lightboxId === null) return;
      if (e.target.matches && e.target.matches('input, textarea, select')) {
        // 입력창에서 Esc: 쓰던 글이 없으면 닫고, 있으면 글을 지키려고 포커스만 뺍니다.
        if (e.key === 'Escape') {
          if (String(e.target.value || '').trim() || state.editingMeta || editingCommentId !== null) e.target.blur();
          else closeLightbox();
        }
        return;
      }
      if (e.key === 'Escape') {
        if (state.sheet) lightboxActions['sheet-close']();
        else closeLightbox();
      }
      else if (e.key === 'ArrowLeft' || (feed && e.key === 'ArrowUp')) { if (feed) e.preventDefault(); step(-1); }
      else if (e.key === 'ArrowRight' || (feed && e.key === 'ArrowDown')) { if (feed) e.preventDefault(); step(1); }
    });
    els.lightbox.addEventListener('submit', function (e) {
      var f = e.target;
      if (f.matches('.ph-edit')) { e.preventDefault(); submitEdit(f); }
      else if (f.matches('.ph-cmt-form')) { e.preventDefault(); addComment(f); }
      else if (f.matches('.ph-cmt-edit-form')) { e.preventDefault(); saveCommentEdit(f); }
    });
    // 촬영 시각을 바꾸면 그 날짜의 일차로 바로 맞춰 줍니다 (여행 기간 밖이면 그대로, 직접 바꿔도 돼요).
    els.lightbox.addEventListener('input', function (e) {
      if (e.target.name !== 'takenAt' || !e.target.closest('.ph-edit')) return;
      var day = P.suggestDay(P.fromKstInputValue(e.target.value), tripStart());
      if (day !== null) e.target.form.day.value = String(day);
    });
    els.lightbox.addEventListener('change', function (e) {
      if (e.target.name === 'place' && e.target.closest('.ph-edit')) {
        var custom = e.target.form.placeName;
        custom.hidden = e.target.value !== 'custom';
        if (!custom.hidden) custom.focus();
      }
    });
    els.lightbox.addEventListener('touchstart', function (e) {
      if (!e.target.closest('.ph-lb-stage')) return;
      touchX = e.touches[0].clientX;
    }, { passive: true });
    els.lightbox.addEventListener('touchend', function (e) {
      if (touchX === null) return;
      var dx = e.changedTouches[0].clientX - touchX;
      touchX = null;
      if (Math.abs(dx) > 50) step(dx < 0 ? 1 : -1);
    });
  }

  // ---------------------------------------------------------------------------
  // 시간·위치·일차 수정 (여행자 누구나, 캡션은 올린 사람만)
  // ---------------------------------------------------------------------------
  function placeOptionsHtml(p, selected) {
    var current = p.placeName || (p.lat !== null && p.lat !== undefined ? P.formatCoords(p.lat, p.lng) : '위치 없음');
    var groups = {};
    tripPlaces().forEach(function (pl) {
      var key = pl.day ? pl.day + '일차' : '기타';
      (groups[key] = groups[key] || []).push(pl);
    });
    var html = '<option value="keep">그대로 두기 — ' + esc(current) + '</option>';
    Object.keys(groups).forEach(function (g) {
      html += '<optgroup label="' + esc(g) + ' 장소">' + groups[g].map(function (pl) {
        return '<option value="preset:' + esc(pl.id) + '">' + esc(pl.name) + '</option>';
      }).join('') + '</optgroup>';
    });
    html += '<option value="custom"' + (selected === 'custom' ? ' selected' : '') + '>직접 입력…</option>';
    html += '<option value="clear">위치 지우기</option>';
    return html;
  }

  function editFormHtml(p, mine) {
    var edited = P.isEdited(p);
    var o = p.original || {};
    var canResetTime = edited.time && !!o.takenAt;
    var canResetLoc = edited.location;
    return '<form class="ph-edit" data-slot="edit" autocomplete="off">' +
      (P.canModify(p, state.me) ? '' : '<p class="ph-muted ph-edit-note">' + esc(nameOf(p.uploaderId)) + '님이 올린 사진이에요. 여행 관리자라서 고칠 수 있어요.</p>') +
      '<label class="ph-edit-label"><span>촬영 시각 <span class="ph-muted">(한국 시간)</span></span>' +
      '<input type="datetime-local" name="takenAt" value="' + esc(P.toKstInputValue(p.takenAt)) + '"></label>' +
      (canResetTime ? '<button type="button" class="ph-linkbtn" data-action="reset-time">↺ 원래 시각으로 (' +
        esc(P.formatShortDateTimeKo(o.takenAt)) + ')</button>' : '') +
      '<label class="ph-edit-label">일차<select name="day">' + dayOptions(p.day) + '</select></label>' +
      '<label class="ph-edit-label">장소<select name="place">' + placeOptionsHtml(p) + '</select></label>' +
      '<input type="text" name="placeName" class="ph-edit-custom" maxlength="' + P.LIMITS.placeNameMax +
      '" placeholder="장소 이름 (예: 지족해협 죽방렴)" hidden>' +
      (canResetLoc ? '<button type="button" class="ph-linkbtn" data-action="reset-location">↺ 원래 위치로' +
        (o.lat !== null && o.lat !== undefined ? '' : ' (위치 없음)') + '</button>' : '') +
      ('<label class="ph-edit-label">캡션<input type="text" name="caption" maxlength="' + P.LIMITS.captionMax +
      '" value="' + esc(p.caption || '') + '" placeholder="한 줄 캡션 (선택)"></label>') +
      '<div class="ph-lb-actions">' +
      '<button type="submit" class="ph-act on"' + (state.saving ? ' disabled' : '') + '>' + (state.saving ? '저장 중…' : '저장') + '</button>' +
      '<button type="button" class="ph-act" data-action="edit-cancel">취소</button>' +
      '</div></form>';
  }

  async function patchPhoto(id, body) {
    state.saving = true;
    try {
      var updated = await api('/photos?id=' + id, jsonOpts('PATCH', Object.assign({ travelerId: state.me }, body)));
      state.photos = state.photos.map(function (x) {
        return x.id === id ? Object.assign({}, updated, { likeCount: x.likeCount, likedBy: x.likedBy, commentCount: x.commentCount }) : x;
      });
      state.editingMeta = false;
      return true;
    } catch (err) {
      alert(err.message);
      return false;
    } finally {
      state.saving = false;
      render();
      renderLightbox();
    }
  }

  function submitEdit(form) {
    var p = photoById(state.lightboxId);
    if (!p) return;
    var body = {};
    var t = P.fromKstInputValue(form.takenAt.value);
    if (t === undefined || t === null) { alert('촬영 시각을 올바르게 입력해 주세요.'); return; }
    if (t !== p.takenAt) body.takenAt = t;
    body.day = form.day.value === '' ? null : Number(form.day.value);
    if (form.caption) { // 캡션 칸은 올린 사람에게만 보여요
      var caption = P.validateCaption(form.caption.value);
      if (caption.error) { alert(caption.error); return; }
      body.caption = caption.value;
    }

    var choiceVal = form.place.value;
    var choice = choiceVal.indexOf('preset:') === 0 ? { type: 'preset', id: choiceVal.slice(7) }
      : choiceVal === 'custom' ? { type: 'custom', name: form.placeName.value }
        : { type: choiceVal };
    if (choice.type === 'custom' && !String(choice.name).trim()) { alert('장소 이름을 입력해 주세요.'); return; }
    var loc = P.locationChoice(choice, p, tripPlaces());
    if (loc) Object.assign(body, loc);
    patchPhoto(p.id, body);
  }

  /** 라이트박스 버튼 동작 (data-action 이름 → 함수). */
  var lightboxActions = {
    'comment-edit': function (t) {
      editingCommentId = Number(t.getAttribute('data-id'));
      var list = els.lightbox.querySelector('[data-slot="comment-list"]');
      if (list) list.innerHTML = commentListHtml(state.lightboxId);
      var ta = els.lightbox.querySelector('.ph-cmt-edit-form textarea');
      if (ta) { ta.focus(); ta.setSelectionRange(ta.value.length, ta.value.length); }
    },
    'comment-edit-cancel': function () {
      editingCommentId = null;
      var list = els.lightbox.querySelector('[data-slot="comment-list"]');
      if (list) list.innerHTML = commentListHtml(state.lightboxId);
    },
    'comment-delete': function (t) {
      deleteComment(Number(t.getAttribute('data-id')));
    },
    like: function () {
      toggleLike(state.lightboxId);
    },
    'sheet-comments': function () {
      state.sheet = 'comments';
      state.editingMeta = false;
      renderSheet();
    },
    'sheet-info': function () {
      state.sheet = 'info';
      state.editingMeta = false;
      renderSheet();
    },
    'sheet-close': function () {
      state.sheet = null;
      state.editingMeta = false;
      editingCommentId = null;
      renderSheet();
    },
    info: function () {
      state.infoOpen = !state.infoOpen;
      if (!state.infoOpen) state.editingMeta = false;
      renderLightbox();
    },
    'edit-meta': function () {
      state.editingMeta = true;
      renderLightbox();
    },
    'edit-cancel': function () {
      state.editingMeta = false;
      renderLightbox();
    },
    'reset-time': function () {
      if (!confirm('촬영 시각을 파일에서 읽은 원래 값으로 되돌릴까요?')) return;
      patchPhoto(state.lightboxId, { reset: ['time'] });
    },
    'reset-location': function () {
      if (!confirm('위치를 파일에서 읽은 원래 값으로 되돌릴까요?')) return;
      var p = photoById(state.lightboxId);
      var o = (p && p.original) || {};
      var near = P.nearestPlace(o.lat, o.lng, tripPlaces());
      patchPhoto(state.lightboxId, { reset: ['location'], placeName: near ? near.name : null });
    },
  };

  // ---------------------------------------------------------------------------
  // 이벤트 연결
  // ---------------------------------------------------------------------------
  function bind() {
    els.me.addEventListener('change', function (e) {
      if (e.target.id !== 'ph-me-select') return;
      var v = parseInt(e.target.value, 10);
      setMe(Number.isInteger(v) ? v : null);
    });

    els.file.addEventListener('change', function () {
      addFiles(els.file.files);
      els.file.value = '';
    });

    els.tabs.addEventListener('click', function (e) {
      var b = e.target.closest('[data-filter]');
      if (!b) return;
      var f = b.getAttribute('data-filter');
      state.filter = /^\d+$/.test(f) ? Number(f) : f;
      render();
    });

    els.grid.addEventListener('click', function (e) {
      var cell = e.target.closest('.ph-cell');
      if (cell) { openLightbox(Number(cell.getAttribute('data-id'))); return; }
      var album = e.target.closest('[data-album]');
      if (album) {
        var parts = album.getAttribute('data-album').split(':');
        var key = parts[1] === 'null' ? null : parts[1] === 'etc' ? 'etc' : Number(parts[1]);
        state.album = { type: parts[0], key: key };
        render();
        els.root.scrollIntoView({ block: 'start' });
        return;
      }
      if (e.target.closest('[data-album-back]')) { state.album = null; render(); return; }
      var gb = e.target.closest('[data-groupby]');
      if (gb) { state.groupBy = gb.getAttribute('data-groupby'); render(); return; }
      if (e.target.closest('[data-m-action="reel"]')) { var rb = document.getElementById('ph-reel-btn'); if (rb) rb.click(); }
    });

    els.mtabs.addEventListener('click', function (e) {
      var b = e.target.closest('[data-mview]');
      if (!b) return;
      state.mview = b.getAttribute('data-mview');
      state.album = null;
      render();
    });

    if (mobileQuery) {
      var onQuery = function () {
        if (state.lightboxId !== null) closeLightbox();
        render();
      };
      if (mobileQuery.addEventListener) mobileQuery.addEventListener('change', onQuery);
      else if (mobileQuery.addListener) mobileQuery.addListener(onQuery);
    }

    els.pending.addEventListener('click', function (e) {
      var rm = e.target.closest('[data-remove]');
      if (rm) { removePending(rm.getAttribute('data-remove')); return; }
      var ed = e.target.closest('[data-edit]');
      if (ed) {
        var target = state.pending.find(function (x) { return x.key === ed.getAttribute('data-edit'); });
        if (target) { target.editing = !target.editing; renderPending(); }
        return;
      }
      var act = e.target.closest('[data-action]');
      if (!act) return;
      if (act.getAttribute('data-action') === 'upload') uploadAll();
      if (act.getAttribute('data-action') === 'clear') {
        state.pending.forEach(function (it) { if (it.previewUrl) URL.revokeObjectURL(it.previewUrl); });
        state.pending = [];
        renderPending();
      }
    });

    // 입력값은 다시 그리지 않고 상태에만 반영 (타이핑 중 포커스 유지)
    els.pending.addEventListener('input', function (e) {
      var key = e.target.getAttribute('data-key');
      var field = e.target.getAttribute('data-field');
      var it = state.pending.find(function (x) { return x.key === key; });
      if (!it || !field) return;
      if (field === 'caption') it.caption = e.target.value;
      if (field === 'day') it.day = e.target.value === '' ? null : Number(e.target.value);
      if (field === 'placeName') {
        var loc = P.locationChoice({ type: 'custom', name: e.target.value }, it, tripPlaces());
        if (loc) Object.assign(it, loc);
      }
    });
    els.pending.addEventListener('change', function (e) {
      if (e.target.hasAttribute('data-pend-me')) {
        var me = parseInt(e.target.value, 10);
        setMe(Number.isInteger(me) ? me : null);
        return;
      }
      var field = e.target.getAttribute('data-field');
      var it = state.pending.find(function (x) { return x.key === e.target.getAttribute('data-key'); });
      if (!it) return;
      if (field === 'day') it.day = e.target.value === '' ? null : Number(e.target.value);
      if (field === 'takenAt') {
        var t = P.fromKstInputValue(e.target.value);
        if (!t) return; // 지우는 중이거나 잘못된 값이면 그대로 둡니다
        it.takenAt = t;
        it.takenAtSource = 'manual';
        var day = P.suggestDay(t, tripStart());
        if (day !== null) it.day = day;
        renderPending();
      }
      if (field === 'place') {
        var v = e.target.value;
        it.placeCustom = v === 'custom';
        var choice = v.indexOf('preset:') === 0 ? { type: 'preset', id: v.slice(7) } : { type: v };
        var loc = P.locationChoice(choice, it, tripPlaces());
        if (loc) Object.assign(it, loc);
        renderPending();
        if (it.placeCustom) {
          var input = els.pending.querySelector('[data-field="placeName"][data-key="' + it.key + '"]');
          if (input) input.focus();
        }
      }
    });

    bindLightbox();
  }

  /** 나는 누구 바꾸기 (PC 드롭다운 · 업로드 목록 · 모바일 프로필 탭이 함께 씀). */
  function setMe(id) {
    if (state.lockedMe) return; // 로그인했으면 로그인한 사람으로 고정
    saveMe(id);
    render();
    renderPending();
    if (state.lightboxId !== null) renderLightbox();
  }

  function init() {
    els.root = $('#photos');
    if (!els.root) return;
    els.status = $('#ph-status', els.root);
    els.me = $('#ph-me', els.root);
    els.file = $('#ph-file', els.root);
    els.pending = $('#ph-pending', els.root);
    els.tabs = $('#ph-tabs', els.root);
    els.grid = $('#ph-grid', els.root);
    els.mtabs = $('#ph-mtabs', els.root);
    els.lightbox = $('#ph-lightbox');
    state.me = readMe();
    // 로그인이 켜져 있으면 "나는 누구" 대신 로그인한 사람으로 고정 (auth-ui.js)
    var lockToMember = function (m) {
      if (!m || !m.traveler) return;
      state.lockedMe = true;
      saveMe(m.traveler.id);
      render();
      renderPending();
    };
    if (window.AuthUI && window.AuthUI.member) lockToMember(window.AuthUI.member);
    document.addEventListener('sosodobo:auth', function (e) { lockToMember(e.detail); });
    bind();
    load();
    checkStorage();
    startPolling();
  }

  // 이후 단계(촬영 정보, 좋아요, 댓글, 영상, 슬라이드)에서 확장할 수 있도록 내부를 노출합니다.
  window.PhotoUI = {
    state: state,
    els: els,
    api: api,
    jsonOpts: jsonOpts,
    esc: esc,
    nameOf: nameOf,
    formatWhen: formatWhen,
    photoById: photoById,
    visiblePhotos: visiblePhotos,
    render: render,
    renderLightbox: renderLightbox,
    renderPending: renderPending,
    load: load,
    lightboxExtras: lightboxExtras,
    lightboxActions: lightboxActions,
    preparers: preparers,
    uploaders: uploaders,
    uploadBlob: uploadBlob,
    applyTimeAndPlace: applyTimeAndPlace,
    randId: randId,
    setMe: setMe,
    isMobile: isMobile,
    pickFiles: function () { els.file.click(); },
    onChange: function (fn) { listeners.push(fn); },
  };

  // 여행을 정한 뒤에 불러오기 시작 (trip-context.js). 없으면 바로.
  var boot = function () { if (window.TripContext) window.TripContext.ready.then(init); else init(); };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})();
