/**
 * 시간 순 슬라이드 영상의 순수 로직 (DOM·캔버스 없음).
 *
 * 사진·영상 목록 → "타임라인"(구간 목록)을 만들고, 특정 시각에 어떤 구간을 얼마나 진하게 그릴지 계산합니다.
 * 같은 타임라인을 화면 재생(재생 모드)과 파일 녹화(저장) 양쪽에서 씁니다. 그리기는 reel-ui.js 가 담당합니다.
 */
(function (root) {
  'use strict';

  var PhotoCore = (typeof module !== 'undefined' && module.exports)
    ? require('./photo-core.js')
    : root.PhotoCore;

  var DEFAULTS = {
    photoSec: 3,        // 사진 1장 길이
    clipMaxSec: 5,      // 영상 클립 최대 길이 (앞부분만)
    transitionSec: 0.6, // 크로스페이드 길이
    titleSec: 2.2,      // 일차 타이틀·시작·끝 카드 길이
    titleCards: true,
  };

  // ---------------------------------------------------------------------------
  // 고르기
  // ---------------------------------------------------------------------------

  /** 촬영 시각 순으로 정렬하고, 일차·좋아요 수로 거릅니다. */
  function selectReelItems(items, options) {
    var o = options || {};
    var list = PhotoCore.sortByTakenAt(items || []);
    if (o.day !== undefined && o.day !== null && o.day !== 'all') list = PhotoCore.filterByDay(list, o.day);
    var min = Number(o.minLikes) || 0;
    if (min > 0) list = list.filter(function (x) { return (x.likeCount || 0) >= min; });
    return list;
  }

  // ---------------------------------------------------------------------------
  // 문구
  // ---------------------------------------------------------------------------

  /** { title: 'DAY 2', subtitle: '말발굽길 · 10.4' } */
  function dayTitle(day, dayNames, firstTakenAt) {
    var name = (dayNames && dayNames[day]) || '';
    var ms = PhotoCore._toValidMs(firstTakenAt);
    var date = '';
    if (ms !== null) {
      var p = PhotoCore.kstParts(ms);
      date = p.month + '.' + p.day;
    }
    return { title: 'DAY ' + day, subtitle: [name, date].filter(Boolean).join(' · ') };
  }

  /** 사진 위에 얹을 글 줄: [촬영 시각 · 장소, 캡션] (옵션에 따라). */
  function overlayLines(item, options) {
    var o = options || {};
    var lines = [];
    if (o.showMeta) {
      var meta = [PhotoCore.formatShortDateTimeKo(item.takenAt), item.placeName].filter(Boolean).join(' · ');
      if (meta) lines.push(meta);
    }
    if (o.showCaption && item.caption) lines.push(item.caption);
    return lines;
  }

  function formatLength(sec) {
    var total = Math.round(Number(sec) || 0);
    var m = Math.floor(total / 60);
    var s = total % 60;
    if (m && s) return m + '분 ' + s + '초';
    if (m) return m + '분';
    return s + '초';
  }

  /** 올린 사람 이름을 많이 올린 순서로. */
  function contributors(items, nameOf) {
    var counts = {};
    var order = [];
    (items || []).forEach(function (x) {
      if (x.uploaderId === null || x.uploaderId === undefined) return;
      if (!counts[x.uploaderId]) { counts[x.uploaderId] = 0; order.push(x.uploaderId); }
      counts[x.uploaderId] += 1;
    });
    return order
      .slice()
      .sort(function (a, b) { return counts[b] - counts[a] || order.indexOf(a) - order.indexOf(b); })
      .map(nameOf)
      .filter(Boolean);
  }

  // ---------------------------------------------------------------------------
  // 타임라인
  // ---------------------------------------------------------------------------

  var KEN_BURNS_PANS = [
    { fromX: -0.4, fromY: -0.2, toX: 0.4, toY: 0.2 },
    { fromX: 0.4, fromY: 0.3, toX: -0.3, toY: -0.2 },
    { fromX: 0, fromY: 0.4, toX: 0, toY: -0.4 },
    { fromX: -0.3, fromY: 0.3, toX: 0.3, toY: -0.3 },
  ];

  /** 사진마다 다른 느린 줌·이동 (짝수는 줌인, 홀수는 줌아웃). 같은 순서면 항상 같은 결과. */
  function kenBurnsFor(index) {
    var pan = KEN_BURNS_PANS[((index % KEN_BURNS_PANS.length) + KEN_BURNS_PANS.length) % KEN_BURNS_PANS.length];
    var zoomIn = index % 2 === 0;
    return {
      fromScale: zoomIn ? 1 : 1.12,
      toScale: zoomIn ? 1.12 : 1,
      fromX: pan.fromX, fromY: pan.fromY, toX: pan.toX, toY: pan.toY,
    };
  }

  function round3(n) { return Math.round(n * 1000) / 1000; }

  /**
   * 사진·영상 → 구간 목록. 구간은 전환 시간만큼 겹칩니다(크로스페이드).
   * 구간: { type: 'title'|'card'|'image'|'video', start, end, fadeIn, item?, day?, title?, subtitle?, kenBurns?, clipDuration? }
   */
  function buildTimeline(items, options) {
    var o = Object.assign({}, DEFAULTS, options || {});
    var list = items || [];
    if (!list.length) return [];

    var raw = [];
    if (o.opening) raw.push({ type: 'card', title: o.opening.title, subtitle: o.opening.subtitle || '', dur: o.titleSec });
    var prevDay = null;
    var photoIndex = 0;
    list.forEach(function (item) {
      var day = item.day === undefined ? null : item.day;
      if (o.titleCards && day !== null && day !== prevDay) {
        var t = dayTitle(day, o.dayNames, item.takenAt);
        raw.push({ type: 'title', day: day, title: t.title, subtitle: t.subtitle, dur: o.titleSec });
      }
      if (day !== null) prevDay = day;
      if (item.mediaType === 'video') {
        var clip = Math.min(Number(item.durationSec) || o.photoSec, o.clipMaxSec);
        raw.push({ type: 'video', item: item, clipDuration: round3(clip), dur: clip });
      } else {
        raw.push({ type: 'image', item: item, kenBurns: kenBurnsFor(photoIndex), dur: o.photoSec });
        photoIndex += 1;
      }
    });
    if (o.ending) raw.push({ type: 'card', title: o.ending.title, subtitle: o.ending.subtitle || '', dur: o.titleSec });

    var t0 = 0;
    return raw.map(function (seg, i) {
      var start = i === 0 ? 0 : Math.max(0, t0 - o.transitionSec);
      var end = start + seg.dur;
      t0 = end;
      var out = Object.assign({}, seg, { start: round3(start), end: round3(end), fadeIn: i === 0 ? 0 : o.transitionSec });
      delete out.dur;
      return out;
    });
  }

  function totalDuration(timeline) {
    return timeline && timeline.length ? timeline[timeline.length - 1].end : 0;
  }

  /**
   * 시각 t 에 그릴 구간들 (아래에서 위 순서).
   * → [{ seg, alpha(0~1, 새로 나타나는 중이면 1 미만), progress(0~1), local(구간 안 경과 초) }]
   */
  function segmentsAt(timeline, t) {
    if (!timeline || !timeline.length) return [];
    var total = totalDuration(timeline);
    var time = Math.min(Math.max(t, 0), total);
    var out = [];
    timeline.forEach(function (seg) {
      if (time < seg.start || time > seg.end) return;
      var local = round3(time - seg.start);
      var alpha = seg.fadeIn > 0 ? Math.min(1, local / seg.fadeIn) : 1;
      out.push({
        seg: seg,
        alpha: round3(alpha),
        progress: seg.end > seg.start ? round3(local / (seg.end - seg.start)) : 1,
        local: local,
      });
    });
    // 끝에 딱 걸친 앞 구간이 완전히 가려졌으면 빼서 불필요한 그리기를 줄입니다.
    if (out.length > 1 && out[out.length - 1].alpha >= 1) return [out[out.length - 1]];
    return out;
  }

  // ---------------------------------------------------------------------------
  // 그리기 계산
  // ---------------------------------------------------------------------------

  /**
   * object-fit: cover 처럼 화면을 꽉 채우도록 원본에서 잘라낼 영역.
   * scale(≥1)로 확대, panX/panY(-1~1)로 확대된 만큼 안에서 이동.
   */
  function coverRect(srcW, srcH, dstW, dstH, scale, panX, panY) {
    var dstAspect = dstW / dstH;
    var sw;
    var sh;
    if (srcW / srcH > dstAspect) { sh = srcH; sw = srcH * dstAspect; } else { sw = srcW; sh = srcW / dstAspect; }
    var z = Math.max(1, scale || 1);
    sw /= z;
    sh /= z;
    var px = Math.max(-1, Math.min(1, panX || 0));
    var py = Math.max(-1, Math.min(1, panY || 0));
    return {
      sx: ((srcW - sw) / 2) * (1 + px),
      sy: ((srcH - sh) / 2) * (1 + py),
      sw: sw,
      sh: sh,
    };
  }

  /** object-fit: contain 처럼 전체가 보이도록 화면 안에 놓을 위치. */
  function containRect(srcW, srcH, dstW, dstH) {
    var s = Math.min(dstW / srcW, dstH / srcH);
    var dw = srcW * s;
    var dh = srcH * s;
    return { dx: (dstW - dw) / 2, dy: (dstH - dh) / 2, dw: dw, dh: dh };
  }

  /** 화면과 비율이 크게 다르면(세로 사진을 가로 화면에 등) 잘라내지 않고 전체를 보여줍니다. */
  function fitMode(srcW, srcH, dstW, dstH) {
    if (!(srcW > 0 && srcH > 0 && dstW > 0 && dstH > 0)) return 'cover';
    var ratio = (srcW / srcH) / (dstW / dstH);
    return Math.abs(Math.log(ratio)) > 0.35 ? 'contain' : 'cover';
  }

  /** 두 값 사이 보간 (부드럽게 시작·끝나는 곡선). */
  function ease(from, to, p) {
    var x = Math.max(0, Math.min(1, p));
    var e = x * x * (3 - 2 * x);
    return from + (to - from) * e;
  }

  function summarizeReel(timeline) {
    var photos = 0;
    var videos = 0;
    (timeline || []).forEach(function (s) {
      if (s.type === 'image') photos += 1;
      if (s.type === 'video') videos += 1;
    });
    return {
      photos: photos,
      videos: videos,
      duration: totalDuration(timeline),
      text: '사진 ' + photos + ' · 영상 ' + videos + ' · 약 ' + formatLength(totalDuration(timeline)),
    };
  }

  // ---------------------------------------------------------------------------
  // 녹화 형식
  // ---------------------------------------------------------------------------

  // H.264 가 명시된 MP4 → WebM → (WebM 을 못 쓰는 브라우저만) 코덱 없는 MP4 순서.
  // 코덱 없는 'video/mp4' 는 브라우저에 따라 MP4 안에 VP9 를 넣기도 해서 휴대폰·카톡에서 안 열릴 수 있어요.
  var RECORDER_MIMES = [
    'video/mp4;codecs=avc1.42E01E,mp4a.40.2',
    'video/mp4;codecs=avc1,mp4a',
    'video/mp4;codecs=avc1',
    'video/webm;codecs=vp9,opus',
    'video/webm;codecs=vp8,opus',
    'video/webm',
    'video/mp4',
  ];

  /** 카톡 공유에 유리한 MP4 를 먼저, 안 되면 WebM. 녹화 불가면 ''. */
  function pickRecorderMime(isTypeSupported) {
    if (typeof isTypeSupported !== 'function') return '';
    for (var i = 0; i < RECORDER_MIMES.length; i++) {
      try {
        if (isTypeSupported(RECORDER_MIMES[i])) return RECORDER_MIMES[i];
      } catch (e) { /* 일부 브라우저는 모르는 형식에 예외 */ }
    }
    return '';
  }

  function extensionForMime(mime) {
    return /mp4/.test(String(mime)) ? 'mp4' : 'webm';
  }

  /** 저장 파일 이름: 남해바래길_전체_20261006.mp4 */
  function reelFileName(options, mime, nowMs) {
    var o = options || {};
    var scope = o.day === undefined || o.day === null || o.day === 'all' ? '전체' : o.day + '일차';
    if (Number(o.minLikes) > 0) scope += '_베스트';
    var d = PhotoCore.kstParts(Number.isFinite(nowMs) ? nowMs : Date.now());
    var ymd = d.year + (d.month < 10 ? '0' : '') + d.month + (d.day < 10 ? '0' : '') + d.day;
    return '남해바래길_' + scope + '_' + ymd + '.' + extensionForMime(mime);
  }

  var ReelCore = {
    DEFAULTS: DEFAULTS,
    selectReelItems: selectReelItems,
    dayTitle: dayTitle,
    overlayLines: overlayLines,
    formatLength: formatLength,
    contributors: contributors,
    kenBurnsFor: kenBurnsFor,
    buildTimeline: buildTimeline,
    totalDuration: totalDuration,
    segmentsAt: segmentsAt,
    coverRect: coverRect,
    containRect: containRect,
    fitMode: fitMode,
    ease: ease,
    summarizeReel: summarizeReel,
    pickRecorderMime: pickRecorderMime,
    extensionForMime: extensionForMime,
    reelFileName: reelFileName,
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = ReelCore;
  if (root) root.ReelCore = ReelCore;
})(typeof window !== 'undefined' ? window : null);
