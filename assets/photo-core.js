/**
 * 사진·영상 앨범의 순수 로직 (DOM·네트워크 없음).
 *
 * 브라우저에서는 <script src="assets/photo-core.js"> 로 불러와 window.PhotoCore 로 쓰고,
 * Node(테스트, 서버 입력 검증 api/_photo-validate.js)에서는 require 로 씁니다.
 * 화면 코드(photo-ui.js)는 이 함수들을 호출만 하도록 얇게 유지합니다.
 */
(function (root) {
  'use strict';

  var LIMITS = {
    photoMaxEdge: 2048,     // 보기용 이미지 긴 변
    thumbMaxEdge: 480,      // 썸네일 긴 변
    photoQuality: 0.85,
    thumbQuality: 0.8,
    videoMaxSec: 60,        // 영상 1개 최대 길이
    videoMaxBytes: 200 * 1024 * 1024,
    captionMax: 100,
    commentMax: 300,
    placeNameMax: 50,
    tripDays: 3,
  };

  var DAY_MS = 24 * 60 * 60 * 1000;
  var KST_OFFSET_MS = 9 * 60 * 60 * 1000;
  // 카메라 시계가 초기화돼 1970년 등으로 찍힌 값은 믿지 않습니다.
  var MIN_PLAUSIBLE_MS = Date.UTC(2000, 0, 1);

  var IMAGE_EXT = /\.(jpe?g|png|webp|heic|heif|gif|avif)$/i;
  var VIDEO_EXT = /\.(mp4|mov|m4v|webm|3gp)$/i;

  // ---------------------------------------------------------------------------
  // 업로드 준비
  // ---------------------------------------------------------------------------

  /** 비율을 유지하며 긴 변이 maxEdge 이하가 되는 크기. 작은 이미지는 키우지 않습니다. */
  function fitWithin(width, height, maxEdge) {
    if (!(width > 0) || !(height > 0) || !(maxEdge > 0)) {
      throw new RangeError('width, height, maxEdge must be positive numbers');
    }
    var scale = Math.min(1, maxEdge / Math.max(width, height));
    return {
      width: Math.max(1, Math.round(width * scale)),
      height: Math.max(1, Math.round(height * scale)),
    };
  }

  /** 'image' | 'video' | null. MIME 타입이 비어 있으면(일부 HEIC/MOV) 확장자로 판단. */
  function classifyFile(file) {
    if (!file) return null;
    var type = String(file.type || '').toLowerCase();
    if (type.indexOf('image/') === 0) return 'image';
    if (type.indexOf('video/') === 0) return 'video';
    var name = String(file.name || '');
    if (IMAGE_EXT.test(name)) return 'image';
    if (VIDEO_EXT.test(name)) return 'video';
    return null;
  }

  function toValidMs(value) {
    if (value === null || value === undefined || value === '') return null;
    var ms = value instanceof Date ? value.getTime()
      : typeof value === 'number' ? value
        : Date.parse(value);
    if (!Number.isFinite(ms) || ms < MIN_PLAUSIBLE_MS) return null;
    return ms;
  }

  /**
   * 촬영 시각 결정: EXIF 촬영 시각 → 파일 수정 시각 → 업로드 시각.
   * 어디서 온 값인지(source)를 함께 돌려줘 "추정값" 표시에 씁니다.
   */
  function pickTakenAt(input) {
    var o = input || {};
    var candidates = [
      ['exif', o.exifTime],
      ['file', o.fileModified],
      ['upload', o.uploadedAt],
    ];
    for (var i = 0; i < candidates.length; i++) {
      var ms = toValidMs(candidates[i][1]);
      if (ms !== null) return { takenAt: new Date(ms).toISOString(), source: candidates[i][0] };
    }
    return { takenAt: null, source: null };
  }

  /** 한국 시간 기준 'YYYY-MM-DD'. */
  function kstDateString(ms) {
    return new Date(ms + KST_OFFSET_MS).toISOString().slice(0, 10);
  }

  /** 촬영 시각 → 여행 n일차 (1..tripDays). 여행 기간 밖이거나 첫날을 모르면 null. */
  function suggestDay(takenAt, tripStartDate, tripDays) {
    var days = tripDays || LIMITS.tripDays;
    var ms = toValidMs(takenAt);
    if (ms === null || !tripStartDate) return null;
    var start = Date.parse(tripStartDate + 'T00:00:00Z');
    if (!Number.isFinite(start)) return null;
    var diff = Math.round((Date.parse(kstDateString(ms) + 'T00:00:00Z') - start) / DAY_MS);
    var day = diff + 1;
    return day >= 1 && day <= days ? day : null;
  }

  // ---------------------------------------------------------------------------
  // 목록
  // ---------------------------------------------------------------------------

  /** 촬영 시각 순(없으면 맨 뒤), 같으면 id 순. 원본 배열은 바꾸지 않습니다. */
  function sortByTakenAt(list) {
    return (list || []).slice().sort(function (a, b) {
      var ta = toValidMs(a.takenAt);
      var tb = toValidMs(b.takenAt);
      if (ta === null && tb !== null) return 1;
      if (tb === null && ta !== null) return -1;
      if (ta !== null && tb !== null && ta !== tb) return ta - tb;
      if (ta === null && tb === null) {
        var ca = toValidMs(a.createdAt) || 0;
        var cb = toValidMs(b.createdAt) || 0;
        if (ca !== cb) return ca - cb;
      }
      return (a.id || 0) - (b.id || 0);
    });
  }

  /** day: 'all' | 1..3 (숫자/문자열) | 'etc'(일차 미지정). */
  function filterByDay(list, day) {
    var arr = list || [];
    if (day === 'all' || day === undefined || day === null) return arr.slice();
    if (day === 'etc') return arr.filter(function (x) { return x.day === null || x.day === undefined; });
    var n = Number(day);
    return arr.filter(function (x) { return x.day === n; });
  }

  /**
   * 본인 항목인지. 작성자가 삭제돼(null) 주인이 없는 항목은 누구나 정리할 수 있게 둡니다.
   * ownerKey: 사진은 'uploaderId', 댓글은 'authorId'.
   */
  function canModify(item, travelerId, ownerKey) {
    if (!item || !Number.isInteger(travelerId)) return false;
    var owner = item[ownerKey || 'uploaderId'];
    if (owner === null || owner === undefined) return true;
    return owner === travelerId;
  }

  function validateText(text, max, emptyValue, label) {
    var clean = text === null || text === undefined ? '' : String(text).trim();
    if (!clean) return emptyValue;
    if (clean.length > max) return { error: label + '은(는) ' + max + '자 이하로 입력해 주세요.' };
    return { value: clean };
  }

  /** 캡션은 선택 사항: 비어 있으면 { value: null }. */
  function validateCaption(text) {
    return validateText(text, LIMITS.captionMax, { value: null }, '캡션');
  }

  // ---------------------------------------------------------------------------
  // EXIF (exifr 가 읽은 원본값 → 저장용 필드)
  // ---------------------------------------------------------------------------

  function finiteOrNull(v) {
    if (v === null || v === undefined || v === '') return null;
    var n = Number(v);
    return Number.isFinite(n) ? n : null;
  }

  function flashFired(value) {
    if (value === null || value === undefined) return null;
    if (typeof value === 'boolean') return value;
    if (typeof value === 'number') return (value & 1) === 1; // EXIF Flash 비트 0 = 발광
    var s = String(value);
    if (/did not fire|no flash|off/i.test(s)) return false;
    if (/fired/i.test(s)) return true;
    return null;
  }

  /**
   * exifr.parse() 결과에서 필요한 값만 뽑습니다.
   * → { exifTime: Date|null, lat, lng, camera: {...}|null }
   */
  function extractExif(raw) {
    var r = raw || {};
    var time = r.DateTimeOriginal || r.CreateDate || null;
    var exifTime = time instanceof Date && Number.isFinite(time.getTime()) ? time : null;

    var lat = finiteOrNull(r.latitude);
    var lng = finiteOrNull(r.longitude);
    if (lat === null || lng === null || (lat === 0 && lng === 0)) {
      lat = null;
      lng = null;
    }

    var camera = {};
    var strings = { make: r.Make, model: r.Model, lens: r.LensModel };
    Object.keys(strings).forEach(function (k) {
      if (typeof strings[k] === 'string' && strings[k].trim()) camera[k] = strings[k].trim();
    });
    var numbers = {
      focalLength: r.FocalLength,
      focal35: r.FocalLengthIn35mmFormat,
      iso: r.ISO,
      exposureTime: r.ExposureTime,
      fNumber: r.FNumber,
      // exifr 는 EXIF 태그 ExposureBiasValue 를 ExposureCompensation 이라는 이름으로 돌려줍니다.
      exposureBias: r.ExposureCompensation !== undefined ? r.ExposureCompensation : r.ExposureBiasValue,
    };
    Object.keys(numbers).forEach(function (k) {
      var n = finiteOrNull(numbers[k]);
      if (n !== null) camera[k] = n;
    });
    var flash = flashFired(r.Flash);
    if (flash !== null) camera.flash = flash;

    return {
      exifTime: exifTime,
      lat: lat,
      lng: lng,
      camera: Object.keys(camera).length ? camera : null,
    };
  }

  // ---------------------------------------------------------------------------
  // 촬영 정보 표시
  // ---------------------------------------------------------------------------

  function trimNumber(n, digits) {
    return String(Number(n.toFixed(digits)));
  }

  /** 셔터스피드: 1초 미만은 분수(1/250s), 이상은 초(2.5s). */
  function formatShutter(sec) {
    var s = finiteOrNull(sec);
    if (s === null || s <= 0) return null;
    if (s >= 1) return trimNumber(s, 1) + 's';
    return '1/' + Math.round(1 / s) + 's';
  }

  function formatAperture(f) {
    var n = finiteOrNull(f);
    if (n === null || n <= 0) return null;
    return 'f/' + trimNumber(n, 1);
  }

  function formatExposureBias(ev) {
    var n = finiteOrNull(ev);
    if (n === null) return null;
    var r = Number(n.toFixed(1));
    if (r === 0) return '0EV';
    return (r > 0 ? '+' : '') + String(r) + 'EV';
  }

  function formatFocal(mm, mm35) {
    var a = finiteOrNull(mm);
    var b = finiteOrNull(mm35);
    if (a !== null && a > 0 && b !== null && b > 0) return trimNumber(a, 1) + 'mm (' + trimNumber(b, 0) + 'mm 환산)';
    if (a !== null && a > 0) return trimNumber(a, 1) + 'mm';
    if (b !== null && b > 0) return trimNumber(b, 0) + 'mm 환산';
    return null;
  }

  /** 카메라 정보 → 표시할 줄 목록. 값이 없는 줄은 만들지 않습니다. */
  function summarizeCamera(camera) {
    var c = camera || {};
    var lines = [];

    var make = c.make || '';
    var model = c.model || '';
    var device = model && make && model.toLowerCase().indexOf(make.toLowerCase()) === 0 ? model
      : [make, model].filter(Boolean).join(' ');
    if (device) lines.push({ key: 'device', label: '카메라', text: device });

    var lens = [c.lens, formatFocal(c.focalLength, c.focal35)].filter(Boolean).join(' · ');
    if (lens) lines.push({ key: 'lens', label: '렌즈', text: lens });

    var exposure = [
      finiteOrNull(c.iso) !== null ? 'ISO ' + c.iso : null,
      formatShutter(c.exposureTime),
      formatAperture(c.fNumber),
      formatExposureBias(c.exposureBias),
    ].filter(Boolean).join(' · ');
    if (exposure) lines.push({ key: 'exposure', label: '노출', text: exposure });

    if (c.flash === true) lines.push({ key: 'flash', label: '플래시', text: '사용함' });
    return lines;
  }

  var WEEKDAYS_KO = ['일', '월', '화', '수', '목', '금', '토'];

  /** 한국 시간 구성요소 (ICU 버전과 무관하게 같은 결과를 내도록 직접 계산). */
  function kstParts(ms) {
    var d = new Date(ms + KST_OFFSET_MS);
    return {
      year: d.getUTCFullYear(), month: d.getUTCMonth() + 1, day: d.getUTCDate(),
      weekday: WEEKDAYS_KO[d.getUTCDay()], hour: d.getUTCHours(), minute: d.getUTCMinutes(),
    };
  }

  function formatTimeKo(p) {
    var h12 = p.hour % 12 === 0 ? 12 : p.hour % 12;
    return (p.hour < 12 ? '오전 ' : '오후 ') + h12 + ':' + (p.minute < 10 ? '0' : '') + p.minute;
  }

  /** '2026년 10월 3일 (토) 오후 2:14' (한국 시간). */
  function formatDateTimeKo(iso) {
    var ms = toValidMs(iso);
    if (ms === null) return '';
    var p = kstParts(ms);
    return p.year + '년 ' + p.month + '월 ' + p.day + '일 (' + p.weekday + ') ' + formatTimeKo(p);
  }

  /** 짧은 표기 '10월 3일 (토) 오후 2:14'. */
  function formatShortDateTimeKo(iso) {
    var ms = toValidMs(iso);
    if (ms === null) return '';
    var p = kstParts(ms);
    return p.month + '월 ' + p.day + '일 (' + p.weekday + ') ' + formatTimeKo(p);
  }

  /** 두 좌표 사이 거리(m), 하버사인 공식. */
  function distanceMeters(lat1, lng1, lat2, lng2) {
    var R = 6371000;
    var toRad = Math.PI / 180;
    var dLat = (lat2 - lat1) * toRad;
    var dLng = (lng2 - lng1) * toRad;
    var a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
      Math.cos(lat1 * toRad) * Math.cos(lat2 * toRad) * Math.sin(dLng / 2) * Math.sin(dLng / 2);
    return 2 * R * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  }

  /** 좌표에서 가장 가까운 여행 장소 (maxMeters 이내, 기본 1km). 좌표 없는 장소는 건너뜀. */
  function nearestPlace(lat, lng, places, maxMeters) {
    var la = finiteOrNull(lat);
    var ln = finiteOrNull(lng);
    if (la === null || ln === null) return null;
    var limit = maxMeters || 1000;
    var best = null;
    var bestD = Infinity;
    (places || []).forEach(function (p) {
      var pl = finiteOrNull(p.lat);
      var pg = finiteOrNull(p.lng);
      if (pl === null || pg === null) return;
      var d = distanceMeters(la, ln, pl, pg);
      if (d <= limit && d < bestD) { best = p; bestD = d; }
    });
    return best;
  }

  /** 지도 앱으로 열기 링크 (카카오맵, 구글 지도). */
  function mapLinks(lat, lng, name) {
    var la = finiteOrNull(lat);
    var ln = finiteOrNull(lng);
    if (la === null || ln === null) return null;
    var label = String(name || '사진 위치').replace(/,/g, ' ');
    return {
      kakao: 'https://map.kakao.com/link/map/' + encodeURIComponent(label) + ',' + la + ',' + ln,
      google: 'https://www.google.com/maps/search/?api=1&query=' + encodeURIComponent(la + ',' + ln),
    };
  }

  function formatCoords(lat, lng) {
    var la = finiteOrNull(lat);
    var ln = finiteOrNull(lng);
    if (la === null || ln === null) return null;
    return Math.abs(la).toFixed(4) + '°' + (la >= 0 ? 'N' : 'S') + ', ' +
      Math.abs(ln).toFixed(4) + '°' + (ln >= 0 ? 'E' : 'W');
  }

  /** 사람이 고친 값인지 (수정됨 표시). */
  function isEdited(photo) {
    var p = photo || {};
    return {
      time: p.takenAtSource === 'manual',
      location: p.locationSource === 'preset' || p.locationSource === 'manual',
    };
  }

  /** 촬영 시각이 어디서 왔는지 한 줄 설명 (EXIF 면 빈 문자열). */
  function takenAtNote(source) {
    if (source === 'file') return '파일 저장 시각 기준 추정';
    if (source === 'upload') return '올린 시각 기준 추정';
    if (source === 'manual') return '직접 수정함';
    return '';
  }

  // ---------------------------------------------------------------------------
  // 시간·위치 수정 폼
  // ---------------------------------------------------------------------------

  function pad2(n) { return (n < 10 ? '0' : '') + n; }

  /** ISO → <input type="datetime-local"> 값 (한국 시간 'YYYY-MM-DDTHH:mm'). */
  function toKstInputValue(iso) {
    var ms = toValidMs(iso);
    if (ms === null) return '';
    var p = kstParts(ms);
    return p.year + '-' + pad2(p.month) + '-' + pad2(p.day) + 'T' + pad2(p.hour) + ':' + pad2(p.minute);
  }

  /** <input type="datetime-local"> 값(한국 시간) → ISO. 비었으면 null, 잘못되면 undefined. */
  function fromKstInputValue(value) {
    if (!value) return null;
    if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2})?$/.test(value)) return undefined;
    var ms = Date.parse(value.length === 16 ? value + ':00+09:00' : value + '+09:00');
    return Number.isFinite(ms) ? new Date(ms).toISOString() : undefined;
  }

  /**
   * 위치 수정 선택 → 저장할 위치 값. 바꿀 게 없으면 null.
   * - preset: 좌표가 있는 장소면 그 좌표로, 없으면 사진의 좌표는 두고 이름만 붙임
   * - custom: 이름만 직접 입력 (좌표는 유지)
   * - clear: 위치 지우기
   */
  function locationChoice(choice, photo, places) {
    var c = choice || {};
    var p = photo || {};
    var keepLat = p.lat === undefined ? null : p.lat;
    var keepLng = p.lng === undefined ? null : p.lng;
    if (c.type === 'preset') {
      var place = (places || []).find(function (x) { return x.id === c.id; });
      if (!place) return null;
      var hasCoords = finiteOrNull(place.lat) !== null && finiteOrNull(place.lng) !== null;
      return {
        lat: hasCoords ? place.lat : keepLat,
        lng: hasCoords ? place.lng : keepLng,
        placeName: place.name,
        locationSource: 'preset',
      };
    }
    if (c.type === 'custom') {
      var name = String(c.name || '').trim();
      if (!name) return null;
      return { lat: keepLat, lng: keepLng, placeName: name.slice(0, LIMITS.placeNameMax), locationSource: 'manual' };
    }
    if (c.type === 'clear') return { lat: null, lng: null, placeName: null, locationSource: null };
    return null;
  }

  // ---------------------------------------------------------------------------
  // 좋아요
  // ---------------------------------------------------------------------------

  function hasLiked(photo, travelerId) {
    return !!(photo && Array.isArray(photo.likedBy) && photo.likedBy.indexOf(travelerId) >= 0);
  }

  /** 내 좋아요를 켜고/끈 새 사진 객체 (화면에 먼저 반영하는 낙관적 업데이트용). */
  function toggleLike(photo, travelerId) {
    var likedBy = (photo && Array.isArray(photo.likedBy)) ? photo.likedBy.slice() : [];
    if (Number.isInteger(travelerId)) {
      var idx = likedBy.indexOf(travelerId);
      if (idx >= 0) likedBy.splice(idx, 1);
      else likedBy.push(travelerId);
    }
    return Object.assign({}, photo, { likedBy: likedBy, likeCount: likedBy.length });
  }

  /** '미솔, 기아님이 좋아해요' / '미솔, 기아, 소연 외 2명이 좋아해요'. */
  function likeSummary(likedBy, nameOf) {
    var ids = likedBy || [];
    if (!ids.length) return '';
    var shown = ids.slice(0, 3).map(nameOf).join(', ');
    var rest = ids.length - 3;
    return rest > 0 ? shown + ' 외 ' + rest + '명이 좋아해요' : shown + '님이 좋아해요';
  }

  // ---------------------------------------------------------------------------
  // 댓글
  // ---------------------------------------------------------------------------

  /** 댓글은 필수: 비어 있으면 오류. */
  function validateComment(text) {
    return validateText(text, LIMITS.commentMax, { error: '댓글 내용을 입력해 주세요.' }, '댓글');
  }

  /** '방금' · '5분 전' · '3시간 전' · '어제' · '10월 1일' (한국 시간 기준). */
  function formatRelativeTime(iso, nowMs) {
    var t = toValidMs(iso);
    if (t === null) return '';
    var now = Number.isFinite(nowMs) ? nowMs : Date.now();
    var diff = now - t;
    if (diff < 60 * 1000) return '방금';
    if (diff < 60 * 60 * 1000) return Math.floor(diff / 60000) + '분 전';
    if (diff < DAY_MS) return Math.floor(diff / 3600000) + '시간 전';
    var days = Math.round((Date.parse(kstDateString(now)) - Date.parse(kstDateString(t))) / DAY_MS);
    if (days === 1) return '어제';
    var p = kstParts(t);
    return p.month + '월 ' + p.day + '일';
  }

  function isCommentEdited(comment) {
    return !!(comment && comment.updatedAt);
  }

  // ---------------------------------------------------------------------------
  // 영상
  // ---------------------------------------------------------------------------

  /** 영상 길이·용량 확인. { ok: true } 또는 { error }. */
  function validateVideo(info) {
    var i = info || {};
    var d = Number(i.durationSec);
    if (!Number.isFinite(d) || d <= 0) return { error: '영상 길이를 확인할 수 없어요. 다른 형식으로 저장해 다시 올려 주세요.' };
    if (d > LIMITS.videoMaxSec + 0.5) return { error: '영상은 ' + LIMITS.videoMaxSec + '초 이하만 올릴 수 있어요. (지금 ' + Math.round(d) + '초)' };
    if (Number(i.size) > LIMITS.videoMaxBytes) {
      return { error: '영상은 ' + Math.round(LIMITS.videoMaxBytes / 1024 / 1024) + 'MB 이하만 올릴 수 있어요.' };
    }
    return { ok: true };
  }

  /** 썸네일로 쓸 프레임 시각: 앞부분(최대 1초)에서, 짧은 영상은 가운데. */
  function videoThumbTime(durationSec) {
    var d = Number(durationSec);
    if (!Number.isFinite(d) || d <= 0) return 0;
    return Math.min(1, d / 2);
  }

  var VIDEO_TYPES = { mp4: 'video/mp4', m4v: 'video/mp4', mov: 'video/quicktime', webm: 'video/webm', '3gp': 'video/3gpp' };

  /** 업로드 경로 확장자와 Content-Type. */
  function videoFileInfo(file) {
    var f = file || {};
    var m = /\.([a-z0-9]+)$/i.exec(String(f.name || ''));
    var ext = m ? m[1].toLowerCase() : '';
    var type = String(f.type || '').toLowerCase();
    if (!VIDEO_TYPES[ext]) {
      ext = Object.keys(VIDEO_TYPES).find(function (k) { return VIDEO_TYPES[k] === type; }) || 'mp4';
    }
    return { ext: ext, contentType: type.indexOf('video/') === 0 ? type : VIDEO_TYPES[ext] };
  }

  /** 0:04 · 1:15 */
  function formatDuration(sec) {
    var s = finiteOrNull(sec);
    if (s === null) return '';
    var total = Math.round(s);
    var m = Math.floor(total / 60);
    var r = total % 60;
    return m + ':' + (r < 10 ? '0' : '') + r;
  }

  // ---------------------------------------------------------------------------
  // 업로드 오류 문구 · 영상 썸네일 확인
  // ---------------------------------------------------------------------------

  var STORAGE_MISSING_TEXT = '사진 저장소(Vercel Blob)가 아직 연결되지 않아 올릴 수 없어요. 연결된 뒤 "다시 올리기"를 눌러 주세요.';

  /** 업로드 실패 이유를 사람이 알아볼 수 있는 문구로. storageMissing 이면 다른 항목도 같은 이유로 실패합니다. */
  function uploadErrorMessage(message) {
    var m = String(message || '');
    if (/client token|BLOB_READ_WRITE_TOKEN|저장소가 아직 연결/i.test(m)) {
      return { storageMissing: true, text: STORAGE_MISSING_TEXT };
    }
    if (/failed to fetch|network|load failed/i.test(m)) {
      return { storageMissing: false, text: '네트워크가 불안정해 올리지 못했어요. 연결을 확인하고 "다시 올리기"를 눌러 주세요.' };
    }
    if (!m) return { storageMissing: false, text: '올리지 못했어요. "다시 올리기"를 눌러 주세요.' };
    return { storageMissing: false, text: m.replace(/^Vercel Blob:\s*/, '') };
  }

  /** RGBA 픽셀이 거의 검은색인지 (일부 영상은 첫 프레임이 검게 나옴). */
  function isMostlyBlack(pixels) {
    var n = pixels ? Math.floor(pixels.length / 4) : 0;
    if (!n) return true;
    var sum = 0;
    for (var i = 0; i < n; i++) sum += (pixels[i * 4] + pixels[i * 4 + 1] + pixels[i * 4 + 2]) / 3;
    return sum / n < 16;
  }

  var PATH_PREFIX = { photo: 'photos/', thumb: 'photos/thumbs/', video: 'photos/videos/' };

  /** Blob 업로드 경로. rand 는 영숫자만 남겨 경로 조작을 막습니다. */
  function blobPath(kind, ext, nowMs, rand) {
    var prefix = PATH_PREFIX[kind] || PATH_PREFIX.photo;
    var safeExt = String(ext || 'bin').toLowerCase().replace(/[^a-z0-9]/g, '') || 'bin';
    var safeRand = String(rand || '').replace(/[^A-Za-z0-9]/g, '');
    return prefix + nowMs + '-' + safeRand + '.' + safeExt;
  }

  var PhotoCore = {
    LIMITS: LIMITS,
    fitWithin: fitWithin,
    classifyFile: classifyFile,
    pickTakenAt: pickTakenAt,
    suggestDay: suggestDay,
    kstDateString: kstDateString,
    sortByTakenAt: sortByTakenAt,
    filterByDay: filterByDay,
    canModify: canModify,
    validateCaption: validateCaption,
    extractExif: extractExif,
    blobPath: blobPath,
    formatShutter: formatShutter,
    formatAperture: formatAperture,
    formatExposureBias: formatExposureBias,
    formatFocal: formatFocal,
    summarizeCamera: summarizeCamera,
    formatDateTimeKo: formatDateTimeKo,
    formatShortDateTimeKo: formatShortDateTimeKo,
    kstParts: kstParts,
    distanceMeters: distanceMeters,
    nearestPlace: nearestPlace,
    mapLinks: mapLinks,
    formatCoords: formatCoords,
    isEdited: isEdited,
    takenAtNote: takenAtNote,
    toKstInputValue: toKstInputValue,
    fromKstInputValue: fromKstInputValue,
    locationChoice: locationChoice,
    hasLiked: hasLiked,
    toggleLike: toggleLike,
    likeSummary: likeSummary,
    validateComment: validateComment,
    formatRelativeTime: formatRelativeTime,
    isCommentEdited: isCommentEdited,
    validateVideo: validateVideo,
    videoThumbTime: videoThumbTime,
    videoFileInfo: videoFileInfo,
    formatDuration: formatDuration,
    uploadErrorMessage: uploadErrorMessage,
    isMostlyBlack: isMostlyBlack,
    STORAGE_MISSING_TEXT: STORAGE_MISSING_TEXT,
    _toValidMs: toValidMs,
    _validateText: validateText,
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = PhotoCore;
  if (root) root.PhotoCore = PhotoCore;
})(typeof window !== 'undefined' ? window : null);
