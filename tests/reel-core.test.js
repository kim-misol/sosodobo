const test = require('node:test');
const assert = require('node:assert/strict');

const R = require('../assets/reel-core.js');

const items = [
  { id: 1, mediaType: 'image', day: 2, takenAt: '2026-10-04T01:00:00Z', likeCount: 2, caption: '말발굽길', placeName: '적량마을', width: 1200, height: 1600 },
  { id: 2, mediaType: 'image', day: 1, takenAt: '2026-10-03T05:14:00Z', likeCount: 0, caption: null, placeName: null, width: 1600, height: 1200 },
  { id: 3, mediaType: 'video', day: 1, takenAt: '2026-10-03T06:00:00Z', likeCount: 1, durationSec: 12, caption: '파도' },
  { id: 4, mediaType: 'image', day: null, takenAt: '2026-10-06T01:00:00Z', likeCount: 3 },
];

// ---- 고르기 -----------------------------------------------------------------

test('selectReelItems sorts by capture time and filters by day and likes', () => {
  assert.deepEqual(R.selectReelItems(items, {}).map((x) => x.id), [2, 3, 1, 4]);
  assert.deepEqual(R.selectReelItems(items, { day: 1 }).map((x) => x.id), [2, 3]);
  assert.deepEqual(R.selectReelItems(items, { day: '2' }).map((x) => x.id), [1]);
  assert.deepEqual(R.selectReelItems(items, { minLikes: 2 }).map((x) => x.id), [1, 4]);
  assert.deepEqual(R.selectReelItems(items, { day: 'all', minLikes: 1 }).map((x) => x.id), [3, 1, 4]);
});

// ---- 타임라인 ---------------------------------------------------------------

const opts = { photoSec: 3, clipMaxSec: 5, transitionSec: 0.5, titleSec: 2, titleCards: true };

test('buildTimeline inserts a title card whenever the day changes', () => {
  const tl = R.buildTimeline(R.selectReelItems(items, {}), opts);
  assert.deepEqual(tl.map((s) => s.type + (s.item ? ':' + s.item.id : ':' + s.day)),
    ['title:1', 'image:2', 'video:3', 'title:2', 'image:1', 'image:4']);
});

test('buildTimeline overlaps segments by the transition time', () => {
  const tl = R.buildTimeline(R.selectReelItems(items, { day: 1 }), opts);
  // title 0~2, image 1.5~4.5, video(최대 5초) 4~9
  assert.deepEqual(tl.map((s) => [s.start, s.end]), [[0, 2], [1.5, 4.5], [4, 9]]);
  assert.equal(R.totalDuration(tl), 9);
});

test('buildTimeline trims videos to clipMaxSec but keeps shorter clips whole', () => {
  const short = [{ id: 9, mediaType: 'video', day: 1, takenAt: '2026-10-03T00:00:00Z', durationSec: 2.5 }];
  const tl = R.buildTimeline(short, Object.assign({}, opts, { titleCards: false }));
  assert.deepEqual([tl[0].start, tl[0].end, tl[0].clipDuration], [0, 2.5, 2.5]);
  const long = R.buildTimeline([items[2]], Object.assign({}, opts, { titleCards: false }));
  assert.equal(long[0].clipDuration, 5);
});

test('buildTimeline without title cards and with an opening/ending card', () => {
  const tl = R.buildTimeline(R.selectReelItems(items, { day: 2 }), Object.assign({}, opts, {
    titleCards: false,
    opening: { title: '남해 바래길', subtitle: '3일 도보여행' },
    ending: { title: '함께 걸어서 좋았어요', subtitle: '미솔 · 기아' },
  }));
  assert.deepEqual(tl.map((s) => s.type), ['card', 'image', 'card']);
  assert.equal(tl[0].title, '남해 바래길');
  assert.equal(tl[2].subtitle, '미솔 · 기아');
});

test('buildTimeline returns an empty timeline for no items', () => {
  assert.deepEqual(R.buildTimeline([], opts), []);
  assert.equal(R.totalDuration([]), 0);
});

// ---- 특정 시각에 무엇을 그릴지 ----------------------------------------------

test('segmentsAt returns one segment, or two during a crossfade', () => {
  const tl = R.buildTimeline(R.selectReelItems(items, { day: 1 }), opts);
  const at1 = R.segmentsAt(tl, 1);
  assert.equal(at1.length, 1);
  assert.equal(at1[0].seg.type, 'title');
  assert.equal(at1[0].alpha, 1);

  const at175 = R.segmentsAt(tl, 1.75); // title 이 사라지고 image 가 나타나는 중
  assert.deepEqual(at175.map((x) => x.seg.type), ['title', 'image']);
  assert.equal(at175[0].alpha, 1);
  assert.equal(at175[1].alpha, 0.5);

  const atEnd = R.segmentsAt(tl, 9);
  assert.equal(atEnd.length, 1);
  assert.equal(atEnd[0].seg.type, 'video');
  assert.equal(atEnd[0].progress, 1);
  assert.deepEqual(R.segmentsAt(tl, 99).length, 1, 'clamps past the end');
  assert.deepEqual(R.segmentsAt([], 1), []);
});

test('segmentsAt gives local playback time for video clips', () => {
  const tl = R.buildTimeline(R.selectReelItems(items, { day: 1 }), opts);
  const at6 = R.segmentsAt(tl, 6);
  const v = at6.find((x) => x.seg.type === 'video');
  assert.equal(v.local, 2);
});

// ---- 그리기 계산 -------------------------------------------------------------

test('kenBurnsFor is deterministic and alternates zoom direction', () => {
  const a = R.kenBurnsFor(0);
  const b = R.kenBurnsFor(1);
  assert.deepEqual(R.kenBurnsFor(0), a);
  assert.ok(a.toScale > a.fromScale, 'zoom in');
  assert.ok(b.toScale < b.fromScale, 'zoom out');
  for (const kb of [a, b, R.kenBurnsFor(7)]) {
    assert.ok(Math.min(kb.fromScale, kb.toScale) >= 1);
    assert.ok(Math.abs(kb.fromX) <= 1 && Math.abs(kb.toY) <= 1);
  }
});

test('coverRect crops the source to fill the frame (object-fit: cover)', () => {
  // 4:3 사진 → 16:9 화면: 위아래가 잘림
  assert.deepEqual(R.coverRect(1600, 1200, 1280, 720, 1, 0, 0), { sx: 0, sy: 150, sw: 1600, sh: 900 });
  // 세로 사진 → 16:9: 가운데만
  const r = R.coverRect(1200, 1600, 1280, 720, 1, 0, 0);
  assert.equal(r.sw, 1200);
  assert.equal(r.sh, 675);
  assert.equal(r.sy, (1600 - 675) / 2);
});

test('coverRect zooms and pans within the image bounds', () => {
  const z = R.coverRect(1600, 900, 1280, 720, 2, 0, 0);
  assert.deepEqual(z, { sx: 400, sy: 225, sw: 800, sh: 450 });
  const panRight = R.coverRect(1600, 900, 1280, 720, 2, 1, 0);
  assert.equal(panRight.sx, 800); // 오른쪽 끝까지
  const panLeft = R.coverRect(1600, 900, 1280, 720, 2, -1, -1);
  assert.deepEqual([panLeft.sx, panLeft.sy], [0, 0]);
});

test('containRect fits the whole image (for portrait photos on a wide frame)', () => {
  assert.deepEqual(R.containRect(1200, 1600, 1280, 720), { dx: 370, dy: 0, dw: 540, dh: 720 });
  assert.deepEqual(R.containRect(1600, 900, 1280, 720), { dx: 0, dy: 0, dw: 1280, dh: 720 });
});

// ---- 문구 -------------------------------------------------------------------

test('dayTitle uses the trip day name and the first capture date', () => {
  const t = R.dayTitle(2, { 2: '말발굽길' }, '2026-10-04T01:00:00Z');
  assert.deepEqual(t, { title: 'DAY 2', subtitle: '말발굽길 · 10.4' });
  assert.deepEqual(R.dayTitle(3, {}, null), { title: 'DAY 3', subtitle: '' });
});

test('overlayLines shows time/place and caption depending on options', () => {
  const it = items[0];
  assert.deepEqual(R.overlayLines(it, { showMeta: true, showCaption: true }), ['10월 4일 (일) 오전 10:00 · 적량마을', '말발굽길']);
  assert.deepEqual(R.overlayLines(it, { showMeta: false, showCaption: true }), ['말발굽길']);
  assert.deepEqual(R.overlayLines(items[1], { showMeta: true, showCaption: true }), ['10월 3일 (토) 오후 2:14']);
  assert.deepEqual(R.overlayLines(it, { showMeta: false, showCaption: false }), []);
});

test('summarizeReel counts items and formats the length', () => {
  const tl = R.buildTimeline(R.selectReelItems(items, {}), opts);
  const s = R.summarizeReel(tl);
  assert.equal(s.photos, 3);
  assert.equal(s.videos, 1);
  assert.equal(s.text, `사진 3 · 영상 1 · 약 ${R.formatLength(R.totalDuration(tl))}`);
  assert.equal(R.formatLength(72.4), '1분 12초');
  assert.equal(R.formatLength(9), '9초');
  assert.equal(R.formatLength(120), '2분');
});

test('contributors lists uploaders by how many items they shared', () => {
  const list = [{ uploaderId: 2 }, { uploaderId: 1 }, { uploaderId: 2 }, { uploaderId: null }];
  const names = { 1: '미솔', 2: '기아' };
  assert.deepEqual(R.contributors(list, (id) => names[id]), ['기아', '미솔']);
});

test('fitMode keeps similar shapes filled and shows very different shapes whole', () => {
  assert.equal(R.fitMode(1600, 1200, 1280, 720), 'cover');   // 4:3 → 16:9 : 살짝 잘림
  assert.equal(R.fitMode(1200, 1600, 1280, 720), 'contain'); // 세로 사진 → 가로 화면 : 전체 보이기
  assert.equal(R.fitMode(1200, 1600, 720, 1280), 'cover');   // 세로 → 세로
  assert.equal(R.fitMode(0, 0, 1280, 720), 'cover');
});

test('ease interpolates smoothly and clamps', () => {
  assert.equal(R.ease(1, 2, 0), 1);
  assert.equal(R.ease(1, 2, 1), 2);
  assert.equal(R.ease(1, 2, 0.5), 1.5);
  assert.equal(R.ease(1, 2, 3), 2);
});

// ---- 8단계: 녹화 형식 · 파일 이름 --------------------------------------------

test('pickRecorderMime never picks codec-less MP4 when WebM works (it may hold VP9, which phones cannot play)', () => {
  // Playwright 의 Chromium: 코덱 없는 'video/mp4' 만 true → 실제로는 MP4 안에 VP9 가 들어감
  const chromiumLike = (m) => m === 'video/mp4' || m.startsWith('video/webm');
  assert.equal(R.pickRecorderMime(chromiumLike), 'video/webm;codecs=vp9,opus');
  // WebM 을 못 쓰는 오래된 Safari 는 코덱 없는 MP4(H.264)라도 써야 함
  assert.equal(R.pickRecorderMime((m) => m === 'video/mp4'), 'video/mp4');
  assert.equal(R.pickRecorderMime((m) => m === 'video/mp4;codecs=avc1'), 'video/mp4;codecs=avc1');
});

test('pickRecorderMime prefers MP4, then WebM, else empty', () => {
  assert.equal(R.pickRecorderMime((m) => m.startsWith('video/mp4')), 'video/mp4;codecs=avc1.42E01E,mp4a.40.2');
  assert.equal(R.pickRecorderMime((m) => m === 'video/webm;codecs=vp9,opus'), 'video/webm;codecs=vp9,opus');
  assert.equal(R.pickRecorderMime(() => false), '');
  assert.equal(R.pickRecorderMime(() => { throw new Error('x'); }), '');
  assert.equal(R.pickRecorderMime(undefined), '');
});

test('reelFileName describes the scope and date', () => {
  const now = Date.parse('2026-10-06T03:00:00Z');
  assert.equal(R.reelFileName({ day: 'all' }, 'video/mp4', now), '남해바래길_전체_20261006.mp4');
  assert.equal(R.reelFileName({ day: 2, minLikes: 1 }, 'video/webm;codecs=vp9', now), '남해바래길_2일차_베스트_20261006.webm');
});

// ---- 초 직접 입력 ------------------------------------------------------------

test('parseSeconds: 소수점 초를 읽고 범위를 벗어나거나 잘못된 값은 null', () => {
  assert.equal(R.parseSeconds('0.5', 'photoSec'), 0.5);
  assert.equal(R.parseSeconds('.5', 'photoSec'), 0.5);
  assert.equal(R.parseSeconds('0,5', 'photoSec'), 0.5);
  assert.equal(R.parseSeconds(' 2.25 ', 'photoSec'), 2.25);
  assert.equal(R.parseSeconds('1.234', 'photoSec'), 1.23);
  assert.equal(R.parseSeconds(7, 'clipMaxSec'), 7);
  assert.equal(R.parseSeconds('', 'photoSec'), null);
  assert.equal(R.parseSeconds('abc', 'photoSec'), null);
  assert.equal(R.parseSeconds('0', 'photoSec'), null);
  assert.equal(R.parseSeconds('-1', 'photoSec'), null);
  assert.equal(R.parseSeconds('0.05', 'photoSec'), null);
  assert.equal(R.parseSeconds(String(R.SEC_LIMITS.photoSec.max + 1), 'photoSec'), null);
  assert.equal(R.parseSeconds(String(R.SEC_LIMITS.clipMaxSec.max + 1), 'clipMaxSec'), null);
});

test('buildTimeline: 0.5초 같은 짧은 길이에서도 전환이 구간보다 길어지지 않는다', () => {
  const photos = [1, 2, 3].map((id) => ({ id, mediaType: 'image', day: 1, takenAt: `2026-10-03T0${id}:00:00Z` }));
  const tl = R.buildTimeline(photos, { photoSec: 0.5, transitionSec: 0.6, titleCards: false });
  // 전환 = min(0.6, 0.5/2, 0.5/2) = 0.25 → 0~0.5, 0.25~0.75, 0.5~1
  assert.deepEqual(tl.map((s) => [s.start, s.end, s.fadeIn]), [[0, 0.5, 0], [0.25, 0.75, 0.25], [0.5, 1, 0.25]]);
  tl.forEach((s, i) => { if (i) assert.ok(s.start >= tl[i - 1].start, '앞 구간보다 먼저 시작하지 않음'); });
  const clip = R.buildTimeline([items[2]], { clipMaxSec: 1.5, transitionSec: 0.6, titleCards: false });
  assert.equal(clip[0].clipDuration, 1.5);
});
