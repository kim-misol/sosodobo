/**
 * 시간 순 슬라이드 영상 — 화면 재생(7단계)과 영상 파일 저장(8단계).
 *
 * 타임라인 계산은 테스트된 reel-core.js(window.ReelCore)가 하고, 이 파일은
 * 사진·영상 불러오기, <canvas> 그리기, 재생 제어, 녹화만 담당합니다.
 *
 * 필요 전역: ReelCore, PhotoCore, PhotoUI, TripPlaces
 */
(function () {
  'use strict';

  var R = window.ReelCore;
  var UI = window.PhotoUI;
  var esc = UI.esc;

  var COLORS = { sea: '#2f5233', seaDark: '#1c3320', sand: '#f5efdb', accent: '#c2703f', ink: '#12120f' };
  var FONT = '-apple-system, BlinkMacSystemFont, "Apple SD Gothic Neo", "Malgun Gothic", "Segoe UI", sans-serif';
  var SIZES = { landscape: { w: 1280, h: 720 }, portrait: { w: 720, h: 1280 } };

  var els = {};
  var opts = {
    day: 'all',
    minLikes: 0,
    photoSec: 3,
    clipMaxSec: 5,
    aspect: 'landscape',
    titleCards: true,
    showMeta: true,
    showCaption: true,
  };
  var bgmFile = null;

  // 재생 상태
  var player = null; // { timeline, assets, W, H, playing, offset, startPerf, raf, audio, total, recording }

  // ---------------------------------------------------------------------------
  // 옵션 → 타임라인
  // ---------------------------------------------------------------------------
  function places() { return window.TripPlaces || {}; }

  function currentItems() {
    return R.selectReelItems(UI.state.photos, { day: opts.day, minLikes: opts.minLikes });
  }

  function timelineFor(items) {
    var names = R.contributors(items, UI.nameOf);
    return R.buildTimeline(items, {
      photoSec: opts.photoSec,
      clipMaxSec: opts.clipMaxSec,
      titleCards: opts.titleCards,
      dayNames: places().DAY_NAMES || {},
      opening: { title: places().TRIP_TITLE || '우리 여행', subtitle: scopeLabel() },
      ending: { title: '함께 걸어서 좋았어요', subtitle: names.length ? '📷 ' + names.join(' · ') : '' },
    });
  }

  function scopeLabel() {
    var base = places().TRIP_SUBTITLE || '';
    var scope = opts.day === 'all' ? '' : opts.day + '일차';
    var best = opts.minLikes > 0 ? '♥ ' + opts.minLikes + '개 이상' : '';
    return [base, scope, best].filter(Boolean).join(' · ');
  }

  // ---------------------------------------------------------------------------
  // 옵션 화면
  // ---------------------------------------------------------------------------
  function selectHtml(name, value, choices) {
    return '<select name="' + name + '">' + choices.map(function (c) {
      return '<option value="' + c[0] + '"' + (String(c[0]) === String(value) ? ' selected' : '') + '>' + c[1] + '</option>';
    }).join('') + '</select>';
  }

  function checkHtml(name, label) {
    return '<label class="rl-check"><input type="checkbox" name="' + name + '"' + (opts[name] ? ' checked' : '') + '> ' + label + '</label>';
  }

  function renderOptions() {
    var canRecord = !!R.pickRecorderMime(window.MediaRecorder && window.MediaRecorder.isTypeSupported
      ? window.MediaRecorder.isTypeSupported.bind(window.MediaRecorder) : null) && !!HTMLCanvasElement.prototype.captureStream;
    els.root.innerHTML =
      '<div class="rl-sheet" role="dialog" aria-modal="true" aria-label="슬라이드 영상 만들기">' +
      '<div class="rl-head"><b>🎬 슬라이드 영상</b><button type="button" class="ph-lb-close" data-rl="close" aria-label="닫기">×</button></div>' +
      '<p class="rl-intro">앨범의 사진·영상을 찍은 시간 순서대로 이어서 보여줘요.</p>' +
      '<form class="rl-form" autocomplete="off">' +
      '<div class="rl-grid">' +
      '<label>범위' + selectHtml('day', opts.day, [['all', '전체'], [1, '1일차'], [2, '2일차'], [3, '3일차']]) + '</label>' +
      '<label>좋아요' + selectHtml('minLikes', opts.minLikes, [[0, '모두'], [1, '♥ 1개 이상'], [2, '♥ 2개 이상'], [3, '♥ 3개 이상']]) + '</label>' +
      '<label>사진 1장' + selectHtml('photoSec', opts.photoSec, [[2, '2초'], [3, '3초'], [4, '4초']]) + '</label>' +
      '<label>영상 클립' + selectHtml('clipMaxSec', opts.clipMaxSec, [[3, '앞 3초'], [5, '앞 5초'], [10, '앞 10초']]) + '</label>' +
      '<label>화면' + selectHtml('aspect', opts.aspect, [['landscape', '가로 16:9 (TV·노트북)'], ['portrait', '세로 9:16 (휴대폰)']]) + '</label>' +
      '<label>배경음악<input type="file" name="bgm" accept="audio/*"></label>' +
      '</div>' +
      '<div class="rl-checks">' + checkHtml('titleCards', '일차 타이틀') + checkHtml('showMeta', '시각·장소') + checkHtml('showCaption', '캡션') + '</div>' +
      '<p class="rl-summary" data-rl="summary"></p>' +
      '<div class="rl-actions">' +
      '<button type="button" class="st-btn" data-rl="play">▶ 재생</button>' +
      (canRecord
        ? '<button type="button" class="st-btn ghost light" data-rl="record">⬇ 영상 파일로 저장</button>'
        : '<span class="rl-note">이 브라우저는 영상 저장을 지원하지 않아요. PC 의 Chrome·Safari 에서 저장해 주세요.</span>') +
      '</div>' +
      '<p class="rl-note">💡 저장은 영상 길이만큼 시간이 걸려요(화면을 켜 둔 채로). 긴 영상은 PC 에서 만드는 걸 추천해요.</p>' +
      (bgmFile ? '<p class="rl-note">🎵 ' + esc(bgmFile.name) + ' <button type="button" class="ph-linkbtn" data-rl="bgm-clear">빼기</button></p>' : '') +
      '</form></div>';
    updateSummary();
  }

  function updateSummary() {
    var el = els.root.querySelector('[data-rl="summary"]');
    if (!el) return;
    var items = currentItems();
    var tl = timelineFor(items);
    var buttons = els.root.querySelectorAll('[data-rl="play"], [data-rl="record"]');
    Array.prototype.forEach.call(buttons, function (b) { b.disabled = !items.length; });
    el.textContent = items.length ? R.summarizeReel(tl).text : '조건에 맞는 사진·영상이 없어요.';
  }

  function readForm(form) {
    opts.day = form.day.value === 'all' ? 'all' : Number(form.day.value);
    opts.minLikes = Number(form.minLikes.value);
    opts.photoSec = Number(form.photoSec.value);
    opts.clipMaxSec = Number(form.clipMaxSec.value);
    opts.aspect = form.aspect.value;
    opts.titleCards = form.titleCards.checked;
    opts.showMeta = form.showMeta.checked;
    opts.showCaption = form.showCaption.checked;
  }

  // ---------------------------------------------------------------------------
  // 불러오기
  // ---------------------------------------------------------------------------
  function loadImage(url) {
    return new Promise(function (resolve, reject) {
      var img = new Image();
      img.crossOrigin = 'anonymous'; // 녹화하려면 캔버스가 "오염"되지 않아야 해요
      img.decoding = 'async';
      img.onload = function () { resolve(img); };
      img.onerror = function () { reject(new Error('이미지 불러오기 실패')); };
      img.src = url;
    });
  }

  function loadVideo(url) {
    return new Promise(function (resolve, reject) {
      var v = document.createElement('video');
      v.crossOrigin = 'anonymous';
      v.muted = true;
      v.playsInline = true;
      v.preload = 'auto';
      var timer = setTimeout(function () { reject(new Error('영상 불러오기 시간 초과')); }, 20000);
      v.addEventListener('loadeddata', function () { clearTimeout(timer); resolve(v); }, { once: true });
      v.addEventListener('error', function () { clearTimeout(timer); reject(new Error('영상 불러오기 실패')); }, { once: true });
      v.src = url;
      v.load();
    });
  }

  /** 사진·영상을 모두 불러오고, 실패한 항목은 빼고 타임라인을 만듭니다. */
  async function prepare(onProgress) {
    var items = currentItems();
    var assets = {};
    var ok = [];
    var done = 0;
    await Promise.all(items.map(function (it) {
      var p = it.mediaType === 'video' ? loadVideo(it.url) : loadImage(it.url);
      return p.then(function (el) {
        assets[it.id] = el;
        ok.push(it);
      }).catch(function () { /* 불러오지 못한 항목은 건너뜀 */ }).then(function () {
        done += 1;
        if (onProgress) onProgress(done, items.length);
      });
    }));
    var kept = items.filter(function (it) { return ok.indexOf(it) >= 0; });
    return { timeline: timelineFor(kept), assets: assets, skipped: items.length - kept.length };
  }

  // ---------------------------------------------------------------------------
  // 그리기
  // ---------------------------------------------------------------------------
  function mediaSize(el) {
    return el.tagName === 'VIDEO' ? { w: el.videoWidth, h: el.videoHeight } : { w: el.naturalWidth, h: el.naturalHeight };
  }

  function drawCard(ctx, W, H, title, subtitle, small) {
    var g = ctx.createLinearGradient(0, 0, W, H);
    g.addColorStop(0, COLORS.sea);
    g.addColorStop(1, COLORS.seaDark);
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, H);
    var base = Math.min(W, H);
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = COLORS.accent;
    ctx.fillRect(W / 2 - base * 0.05, H / 2 - base * 0.16, base * 0.1, base * 0.008);
    ctx.fillStyle = COLORS.sand;
    ctx.font = '800 ' + Math.round(base * (small ? 0.075 : 0.11)) + 'px ' + FONT;
    ctx.fillText(title || '', W / 2, H / 2 - base * 0.03, W * 0.9);
    if (subtitle) {
      ctx.globalAlpha *= 0.85;
      ctx.font = '500 ' + Math.round(base * 0.045) + 'px ' + FONT;
      ctx.fillText(subtitle, W / 2, H / 2 + base * 0.09, W * 0.9);
    }
  }

  function drawMedia(ctx, W, H, el, kb, p) {
    var size = mediaSize(el);
    if (!size.w || !size.h) return;
    var scale = kb ? R.ease(kb.fromScale, kb.toScale, p) : 1;
    var px = kb ? R.ease(kb.fromX, kb.toX, p) : 0;
    var py = kb ? R.ease(kb.fromY, kb.toY, p) : 0;
    if (R.fitMode(size.w, size.h, W, H) === 'cover') {
      var r = R.coverRect(size.w, size.h, W, H, scale, px, py);
      ctx.drawImage(el, r.sx, r.sy, r.sw, r.sh, 0, 0, W, H);
      return;
    }
    // 비율이 크게 다르면: 흐린 배경 + 전체가 보이는 사진
    var bg = R.coverRect(size.w, size.h, W, H, 1.2, 0, 0);
    ctx.save();
    if ('filter' in ctx) ctx.filter = 'blur(28px) brightness(0.55)';
    ctx.drawImage(el, bg.sx, bg.sy, bg.sw, bg.sh, -W * 0.05, -H * 0.05, W * 1.1, H * 1.1);
    ctx.restore();
    if (!('filter' in ctx)) {
      ctx.fillStyle = 'rgba(0,0,0,0.55)';
      ctx.fillRect(0, 0, W, H);
    }
    var c = R.containRect(size.w, size.h, W, H);
    var s = kb ? R.ease(1, 1.05, kb.toScale > kb.fromScale ? p : 1 - p) : 1;
    var dw = c.dw * s;
    var dh = c.dh * s;
    ctx.drawImage(el, (W - dw) / 2, (H - dh) / 2, dw, dh);
  }

  function drawOverlay(ctx, W, H, lines) {
    if (!lines.length) return;
    var base = Math.min(W, H);
    var g = ctx.createLinearGradient(0, H * 0.62, 0, H);
    g.addColorStop(0, 'rgba(0,0,0,0)');
    g.addColorStop(1, 'rgba(0,0,0,0.62)');
    ctx.fillStyle = g;
    ctx.fillRect(0, H * 0.62, W, H * 0.38);
    ctx.textAlign = 'left';
    ctx.textBaseline = 'alphabetic';
    var x = base * 0.05;
    var y = H - base * 0.06;
    for (var i = lines.length - 1; i >= 0; i--) {
      var isCaption = i === lines.length - 1 && opts.showCaption && lines.length > (opts.showMeta ? 1 : 0);
      ctx.font = (isCaption ? '700 ' + Math.round(base * 0.048) : '500 ' + Math.round(base * 0.034)) + 'px ' + FONT;
      ctx.fillStyle = isCaption ? '#ffffff' : 'rgba(255,255,255,0.85)';
      ctx.shadowColor = 'rgba(0,0,0,0.5)';
      ctx.shadowBlur = 6;
      ctx.fillText(lines[i], x, y, W - x * 2);
      ctx.shadowBlur = 0;
      y -= base * (isCaption ? 0.065 : 0.05);
    }
  }

  function drawFrame(ctx, W, H, t) {
    ctx.globalAlpha = 1;
    ctx.fillStyle = COLORS.ink;
    ctx.fillRect(0, 0, W, H);
    R.segmentsAt(player.timeline, t).forEach(function (a) {
      var seg = a.seg;
      ctx.save();
      ctx.globalAlpha = a.alpha;
      if (seg.type === 'title' || seg.type === 'card') {
        drawCard(ctx, W, H, seg.title, seg.subtitle, seg.type === 'card' && a.seg === player.timeline[player.timeline.length - 1]);
      } else {
        var el = player.assets[seg.item.id];
        if (el) drawMedia(ctx, W, H, el, seg.type === 'image' ? seg.kenBurns : null, a.progress);
        drawOverlay(ctx, W, H, R.overlayLines(seg.item, opts));
      }
      ctx.restore();
    });
  }

  /** 지금 시각에 맞춰 영상 클립 재생/정지. */
  function syncVideos(t, playing) {
    var active = {};
    R.segmentsAt(player.timeline, t).forEach(function (a) {
      if (a.seg.type === 'video') active[a.seg.item.id] = a.local;
    });
    player.timeline.forEach(function (seg) {
      if (seg.type !== 'video') return;
      var v = player.assets[seg.item.id];
      if (!v) return;
      var local = active[seg.item.id];
      if (local === undefined || !playing) {
        if (!v.paused) v.pause();
        return;
      }
      var want = Math.min(local, seg.clipDuration);
      if (Math.abs(v.currentTime - want) > 0.35) {
        try { v.currentTime = want; } catch (e) { /* 아직 탐색 불가 */ }
      }
      if (v.paused && want < seg.clipDuration - 0.05) {
        var pr = v.play();
        if (pr && pr.catch) pr.catch(function () {});
      }
    });
  }

  // ---------------------------------------------------------------------------
  // 재생 제어
  // ---------------------------------------------------------------------------
  function now() { return performance.now(); }

  function currentTime() {
    if (!player) return 0;
    return player.playing ? player.offset + (now() - player.startPerf) / 1000 : player.offset;
  }

  function tick() {
    if (!player) return;
    var t = currentTime();
    if (t >= player.total) {
      t = player.total;
      if (player.playing) pause(true);
    }
    syncVideos(t, player.playing);
    drawFrame(player.ctx, player.W, player.H, t);
    updateControls(t);
    if (player.onFrame) player.onFrame(t);
    if (player.playing) player.raf = requestAnimationFrame(tick);
  }

  function play() {
    if (!player || player.playing) return;
    if (player.offset >= player.total) player.offset = 0;
    player.playing = true;
    player.startPerf = now();
    if (player.audio) {
      try { player.audio.currentTime = player.offset % (player.audio.duration || Infinity); } catch (e) { /* 무시 */ }
      var pr = player.audio.play();
      if (pr && pr.catch) pr.catch(function () {});
    }
    player.raf = requestAnimationFrame(tick);
  }

  function pause(ended) {
    if (!player) return;
    player.offset = Math.min(currentTime(), player.total);
    player.playing = false;
    cancelAnimationFrame(player.raf);
    if (player.audio) player.audio.pause();
    syncVideos(player.offset, false);
    if (player.onEnd && ended) player.onEnd();
    updateControls(player.offset);
  }

  function seek(t) {
    if (!player) return;
    var wasPlaying = player.playing;
    if (wasPlaying) pause();
    player.offset = Math.max(0, Math.min(t, player.total));
    if (player.audio && player.audio.duration) {
      try { player.audio.currentTime = player.offset % player.audio.duration; } catch (e) { /* 무시 */ }
    }
    tick();
    if (wasPlaying) play();
  }

  function destroyPlayer() {
    if (!player) return;
    pause();
    Object.keys(player.assets).forEach(function (k) {
      var el = player.assets[k];
      if (el.tagName === 'VIDEO') { el.pause(); el.removeAttribute('src'); el.load(); }
    });
    if (player.audio) { player.audio.pause(); URL.revokeObjectURL(player.audio.src); }
    if (player.audioGraph) { try { player.audioGraph.ctx.close(); } catch (e) { /* 무시 */ } }
    player = null;
  }

  function fmtClock(sec) {
    return window.PhotoCore.formatDuration(sec);
  }

  function updateControls(t) {
    var bar = els.root.querySelector('[data-rl="bar"]');
    var clock = els.root.querySelector('[data-rl="clock"]');
    var btn = els.root.querySelector('[data-rl="toggle"]');
    if (bar) bar.value = String(t);
    if (clock) clock.textContent = fmtClock(t) + ' / ' + fmtClock(player.total);
    if (btn) btn.textContent = player.playing ? '⏸' : (t >= player.total ? '↺' : '▶');
  }

  function renderPlayerShell(size) {
    els.root.innerHTML =
      '<div class="rl-player">' +
      '<div class="rl-head"><b>🎬 슬라이드 영상</b>' +
      '<button type="button" class="ph-lb-close" data-rl="back" aria-label="옵션으로">×</button></div>' +
      '<div class="rl-stage"><canvas class="rl-canvas ' + opts.aspect + '" width="' + size.w + '" height="' + size.h + '"></canvas>' +
      '<div class="rl-loading" data-rl="loading">불러오는 중…</div></div>' +
      '<div class="rl-controls">' +
      '<button type="button" class="ph-act" data-rl="toggle" aria-label="재생/일시정지">▶</button>' +
      '<input type="range" data-rl="bar" min="0" max="1" step="0.05" value="0" aria-label="재생 위치">' +
      '<span class="rl-clock" data-rl="clock">0:00</span>' +
      '<button type="button" class="ph-act" data-rl="fullscreen" aria-label="전체 화면">⛶</button>' +
      '</div>' +
      '<div class="rl-rec" data-rl="rec" hidden></div>' +
      '</div>';
  }

  /** 옵션대로 불러와 플레이어를 준비. mode: 'play' | 'record' */
  async function startPlayer(mode) {
    destroyPlayer();
    var size = SIZES[opts.aspect] || SIZES.landscape;
    renderPlayerShell(size);
    var canvas = els.root.querySelector('canvas');
    var loading = els.root.querySelector('[data-rl="loading"]');
    var prepared = await prepare(function (done, total) {
      loading.textContent = '사진·영상 불러오는 중… ' + done + ' / ' + total;
    });
    if (!prepared.timeline.length) {
      loading.textContent = '불러올 수 있는 사진·영상이 없어요.';
      return null;
    }
    loading.hidden = true;
    player = {
      timeline: prepared.timeline,
      assets: prepared.assets,
      total: R.totalDuration(prepared.timeline),
      W: size.w,
      H: size.h,
      ctx: canvas.getContext('2d'),
      canvas: canvas,
      playing: false,
      offset: 0,
      startPerf: 0,
      raf: 0,
      audio: null,
      skipped: prepared.skipped,
      mode: mode,
    };
    var bar = els.root.querySelector('[data-rl="bar"]');
    bar.max = String(player.total);
    if (bgmFile) {
      var audio = new Audio(URL.createObjectURL(bgmFile));
      audio.loop = true;
      audio.volume = 0.8;
      player.audio = audio;
    }
    if (prepared.skipped) {
      var rec = els.root.querySelector('[data-rl="rec"]');
      rec.hidden = false;
      rec.textContent = '⚠️ 불러오지 못한 ' + prepared.skipped + '개는 빼고 만들었어요.';
    }
    tick();
    return player;
  }

  var recordingHooks = { start: null, share: null, cancel: null };

  // ---------------------------------------------------------------------------
  // 8단계: 영상 파일로 저장 (캔버스 + 소리를 실시간으로 녹화)
  // ---------------------------------------------------------------------------
  var RECORD_WARN_SEC = 5 * 60;

  function recBox() { return els.root.querySelector('[data-rl="rec"]'); }

  function setRecBox(html) {
    var box = recBox();
    if (!box) return;
    box.hidden = false;
    box.innerHTML = html;
  }

  /**
   * 소리 합치기: 배경음악이 있으면 배경음악만(끝에서 2초 동안 서서히 줄임),
   * 없으면 영상 클립의 원래 소리를 넣습니다.
   */
  function buildAudio(p) {
    var Ctx = window.AudioContext || window.webkitAudioContext;
    if (!Ctx) return null;
    var ac = new Ctx();
    var dest = ac.createMediaStreamDestination();
    var master = ac.createGain();
    master.connect(dest);
    master.connect(ac.destination); // 저장하는 동안 들을 수 있게
    if (p.audio) {
      var src = ac.createMediaElementSource(p.audio);
      src.connect(master);
      var fadeAt = Math.max(0, p.total - 2);
      master.gain.setValueAtTime(1, ac.currentTime + fadeAt);
      master.gain.linearRampToValueAtTime(0, ac.currentTime + p.total);
    } else {
      Object.keys(p.assets).forEach(function (k) {
        var v = p.assets[k];
        if (v.tagName !== 'VIDEO') return;
        v.muted = false;
        try { ac.createMediaElementSource(v).connect(master); } catch (e) { /* 이미 연결됨 등 */ }
      });
    }
    return { ctx: ac, stream: dest.stream, master: master };
  }

  async function startRecording() {
    var mime = R.pickRecorderMime(window.MediaRecorder && window.MediaRecorder.isTypeSupported.bind(window.MediaRecorder));
    if (!mime) { alert('이 브라우저는 영상 저장을 지원하지 않아요.'); return; }
    var est = R.totalDuration(timelineFor(currentItems()));
    if (est > RECORD_WARN_SEC && !confirm('영상 길이가 약 ' + R.formatLength(est) + '예요. 저장하는 데 그만큼 걸려요. 계속할까요?')) return;

    var p = await startPlayer('record');
    if (!p) return;
    var toggle = els.root.querySelector('[data-rl="toggle"]');
    var bar = els.root.querySelector('[data-rl="bar"]');
    if (toggle) toggle.disabled = true;
    if (bar) bar.disabled = true;

    var stream = p.canvas.captureStream(30);
    var audio = null;
    try { audio = buildAudio(p); } catch (e) { audio = null; }
    if (audio) {
      audio.stream.getAudioTracks().forEach(function (tr) { stream.addTrack(tr); });
      p.audioGraph = audio; // 저장이 끝난 뒤 다시 볼 때도 같은 소리 경로를 씁니다 (destroyPlayer 에서 닫음)
    }

    var chunks = [];
    var recorder;
    try {
      recorder = new MediaRecorder(stream, { mimeType: mime, videoBitsPerSecond: 5000000 });
    } catch (e) {
      setRecBox('⚠️ 녹화를 시작하지 못했어요: ' + esc(e.message));
      return;
    }
    p.recorder = recorder;
    var startedAt = performance.now();
    recorder.ondataavailable = function (e) { if (e.data && e.data.size) chunks.push(e.data); };
    recorder.onstop = function () {
      stream.getVideoTracks().forEach(function (tr) { tr.stop(); });
      if (audio) {
        audio.master.gain.cancelScheduledValues(audio.ctx.currentTime);
        audio.master.gain.setValueAtTime(1, audio.ctx.currentTime);
      }
      document.removeEventListener('visibilitychange', onHidden);
      if (recorder.cancelled) return;
      var type = mime.split(';')[0];
      var blob = new Blob(chunks, { type: type });
      var elapsedMs = performance.now() - startedAt;
      finishRecording(blob, type, elapsedMs);
    };

    function onHidden() {
      if (document.hidden) {
        setRecBox('⚠️ 다른 화면으로 가면 녹화가 멈출 수 있어요. 이 화면으로 돌아와 주세요.');
      }
    }
    document.addEventListener('visibilitychange', onHidden);

    setRecBox('<div>⏺ 저장 중… <span data-rl="rec-clock">0:00 / ' + fmtClock(p.total) + '</span></div>' +
      '<div class="ph-progress"><span data-rl="rec-bar" style="width:0%"></span></div>' +
      '<div style="margin-top:8px"><button type="button" class="ph-act" data-rl="rec-cancel">그만두기</button></div>');
    p.onFrame = function (t) {
      var clock = els.root.querySelector('[data-rl="rec-clock"]');
      var fill = els.root.querySelector('[data-rl="rec-bar"]');
      if (clock) clock.textContent = fmtClock(t) + ' / ' + fmtClock(p.total);
      if (fill) fill.style.width = Math.round((t / p.total) * 100) + '%';
    };
    p.onEnd = function () {
      // 마지막 프레임이 담기도록 잠깐 기다렸다 멈춥니다.
      setTimeout(function () { if (recorder.state === 'recording') recorder.stop(); }, 400);
    };
    if (audio && audio.ctx.state === 'suspended') await audio.ctx.resume();
    recorder.start(1000);
    play();
  }

  async function finishRecording(blob, type, elapsedMs) {
    var fixed = blob;
    // Chrome 의 WebM 녹화본에는 길이 정보가 비어 있어 일부 앱에서 탐색이 안 되므로 채워 넣습니다.
    if (/webm/.test(type) && window.ysFixWebmDuration) {
      try { fixed = await window.ysFixWebmDuration(blob, Math.round(elapsedMs), { logger: false }); } catch (e) { fixed = blob; }
    }
    var name = R.reelFileName(opts, type);
    var url = URL.createObjectURL(fixed);
    var mb = (fixed.size / 1024 / 1024).toFixed(1);
    var canShare = false;
    var file = null;
    try {
      file = new File([fixed], name, { type: type });
      canShare = !!(navigator.canShare && navigator.canShare({ files: [file] }));
    } catch (e) { canShare = false; }
    lastRecording = { blob: fixed, url: url, name: name, file: file, type: type };
    setRecBox('✅ 영상이 만들어졌어요 (' + esc(R.extensionForMime(type).toUpperCase()) + ' · ' + mb + 'MB)' +
      '<div class="rl-actions" style="margin-top:8px">' +
      '<a class="st-btn" data-rl="download" href="' + url + '" download="' + esc(name) + '">⬇ ' + esc(name) + '</a>' +
      (canShare ? '<button type="button" class="st-btn ghost light" data-rl="share">공유하기</button>' : '') +
      '</div>' +
      (/webm/.test(type) ? '<p class="rl-note">이 브라우저는 WebM 으로만 저장돼요. 카카오톡으로 보내려면 Safari 나 최신 Chrome 에서 만들면 MP4 로 저장돼요.</p>' : ''));
    var toggle = els.root.querySelector('[data-rl="toggle"]');
    var bar = els.root.querySelector('[data-rl="bar"]');
    if (toggle) toggle.disabled = false;
    if (bar) bar.disabled = false;
    if (player) {
      player.mode = 'play';
      player.onFrame = null;
      player.onEnd = null;
      player.recorder = null;
    }
  }

  var lastRecording = null;

  function shareRecording() {
    if (!lastRecording || !lastRecording.file) return;
    navigator.share({ files: [lastRecording.file], title: lastRecording.name }).catch(function () {});
  }

  recordingHooks.start = startRecording;
  recordingHooks.share = shareRecording;
  recordingHooks.cancel = function () {
    if (player && player.recorder && player.recorder.state === 'recording') {
      player.recorder.cancelled = true;
      player.recorder.stop();
      pause();
      setRecBox('저장을 그만뒀어요.');
      var toggle = els.root.querySelector('[data-rl="toggle"]');
      var bar = els.root.querySelector('[data-rl="bar"]');
      if (toggle) toggle.disabled = false;
      if (bar) bar.disabled = false;
      player.mode = 'play';
      player.onFrame = null;
      player.onEnd = null;
    }
  };


  // ---------------------------------------------------------------------------
  // 열기·닫기·이벤트
  // ---------------------------------------------------------------------------
  function open() {
    if (!UI.state.photos.length) { alert('아직 앨범에 사진이 없어요.'); return; }
    els.root.hidden = false;
    document.body.classList.add('ph-noscroll');
    renderOptions();
  }

  function close() {
    if (player && player.recorder && player.recorder.state === 'recording') {
      if (!confirm('영상 저장 중이에요. 그만두고 닫을까요?')) return;
      player.recorder.cancelled = true;
      player.recorder.stop();
    }
    destroyPlayer();
    els.root.hidden = true;
    els.root.innerHTML = '';
    document.body.classList.remove('ph-noscroll');
  }

  function bind() {
    els.button.addEventListener('click', open);

    els.root.addEventListener('change', function (e) {
      var form = e.target.form;
      if (!form || !form.classList.contains('rl-form')) return;
      if (e.target.name === 'bgm') {
        bgmFile = e.target.files && e.target.files[0] ? e.target.files[0] : null;
        readForm(form);
        renderOptions();
        return;
      }
      readForm(form);
      updateSummary();
    });

    els.root.addEventListener('input', function (e) {
      if (e.target.getAttribute('data-rl') === 'bar' && player) seek(Number(e.target.value));
    });

    els.root.addEventListener('click', function (e) {
      var t = e.target.closest('[data-rl]');
      if (!t) return;
      var a = t.getAttribute('data-rl');
      if (a === 'close') close();
      else if (a === 'back') {
        if (player && player.recorder && player.recorder.state === 'recording') { close(); return; }
        destroyPlayer();
        renderOptions();
      } else if (a === 'bgm-clear') {
        bgmFile = null;
        renderOptions();
      } else if (a === 'play') {
        startPlayer('play').then(function (p) { if (p) play(); });
      } else if (a === 'record' && recordingHooks.start) {
        recordingHooks.start();
      } else if (a === 'rec-cancel' && recordingHooks.cancel) {
        recordingHooks.cancel();
      } else if (a === 'share' && recordingHooks.share) {
        recordingHooks.share();
      } else if (a === 'toggle' && player && player.mode === 'play') {
        if (player.playing) pause(); else play();
      } else if (a === 'fullscreen') {
        var stage = els.root.querySelector('.rl-stage');
        if (document.fullscreenElement) document.exitFullscreen();
        else if (stage && stage.requestFullscreen) stage.requestFullscreen().catch(function () {});
      }
    });

    document.addEventListener('keydown', function (e) {
      if (els.root.hidden) return;
      if (e.key === 'Escape' && !document.fullscreenElement) close();
      if (e.key === ' ' && player && player.mode === 'play' && !e.target.matches('input, select, textarea, button')) {
        e.preventDefault();
        if (player.playing) pause(); else play();
      }
    });
  }

  function init() {
    els.root = document.getElementById('ph-reel');
    els.button = document.getElementById('ph-reel-btn');
    if (!els.root || !els.button || !R || !UI) return;
    bind();
  }

  // 녹화 코드(8단계)와 테스트에서 쓰도록 내부를 노출합니다.
  window.ReelUI = {
    opts: opts,
    get player() { return player; },
    startPlayer: startPlayer,
    play: play,
    pause: pause,
    seek: seek,
    tick: tick,
    currentTime: currentTime,
    destroyPlayer: destroyPlayer,
    renderOptions: renderOptions,
    recordingHooks: recordingHooks,
    get bgmFile() { return bgmFile; },
    els: els,
    open: open,
    close: close,
  };

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
