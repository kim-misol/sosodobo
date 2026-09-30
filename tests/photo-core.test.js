const test = require('node:test');
const assert = require('node:assert/strict');

const P = require('../assets/photo-core.js');

// ---------------------------------------------------------------------------
// 1단계: 업로드 준비 (리사이즈 크기, 파일 종류, 촬영 시각, 일차)
// ---------------------------------------------------------------------------

test('fitWithin keeps aspect ratio for landscape photos', () => {
  assert.deepEqual(P.fitWithin(4032, 3024, 2048), { width: 2048, height: 1536 });
});

test('fitWithin keeps aspect ratio for portrait photos', () => {
  assert.deepEqual(P.fitWithin(3024, 4032, 480), { width: 360, height: 480 });
});

test('fitWithin never upscales small images', () => {
  assert.deepEqual(P.fitWithin(800, 600, 2048), { width: 800, height: 600 });
});

test('fitWithin rounds to whole pixels and never returns 0', () => {
  assert.deepEqual(P.fitWithin(10000, 3, 480), { width: 480, height: 1 });
});

test('fitWithin rejects invalid sizes', () => {
  assert.throws(() => P.fitWithin(0, 100, 480));
  assert.throws(() => P.fitWithin(100, -1, 480));
  assert.throws(() => P.fitWithin(100, 100, 0));
  assert.throws(() => P.fitWithin(NaN, 100, 480));
});

test('classifyFile detects images and videos by MIME type', () => {
  assert.equal(P.classifyFile({ type: 'image/jpeg', name: 'a.jpg' }), 'image');
  assert.equal(P.classifyFile({ type: 'image/heic', name: 'a.heic' }), 'image');
  assert.equal(P.classifyFile({ type: 'video/mp4', name: 'a.mp4' }), 'video');
  assert.equal(P.classifyFile({ type: 'video/quicktime', name: 'a.mov' }), 'video');
});

test('classifyFile falls back to the extension when MIME type is empty', () => {
  assert.equal(P.classifyFile({ type: '', name: 'IMG_0001.HEIC' }), 'image');
  assert.equal(P.classifyFile({ type: '', name: 'clip.MOV' }), 'video');
});

test('classifyFile rejects other files', () => {
  assert.equal(P.classifyFile({ type: 'application/pdf', name: 'a.pdf' }), null);
  assert.equal(P.classifyFile({ type: '', name: 'noext' }), null);
  assert.equal(P.classifyFile(null), null);
});

test('pickTakenAt prefers the EXIF capture time', () => {
  const r = P.pickTakenAt({
    exifTime: new Date('2026-10-03T05:14:00Z'),
    fileModified: Date.parse('2026-10-05T00:00:00Z'),
    uploadedAt: new Date('2026-10-06T00:00:00Z'),
  });
  assert.deepEqual(r, { takenAt: '2026-10-03T05:14:00.000Z', source: 'exif' });
});

test('pickTakenAt falls back to file time, then upload time', () => {
  assert.deepEqual(
    P.pickTakenAt({ exifTime: null, fileModified: Date.parse('2026-10-05T00:00:00Z'), uploadedAt: new Date('2026-10-06T00:00:00Z') }),
    { takenAt: '2026-10-05T00:00:00.000Z', source: 'file' },
  );
  assert.deepEqual(
    P.pickTakenAt({ exifTime: 'garbage', fileModified: undefined, uploadedAt: new Date('2026-10-06T00:00:00Z') }),
    { takenAt: '2026-10-06T00:00:00.000Z', source: 'upload' },
  );
});

test('pickTakenAt ignores implausible dates (e.g. 1970 from a reset camera clock)', () => {
  const r = P.pickTakenAt({
    exifTime: new Date(0),
    fileModified: Date.parse('2026-10-05T00:00:00Z'),
    uploadedAt: new Date('2026-10-06T00:00:00Z'),
  });
  assert.equal(r.source, 'file');
});

test('suggestDay maps a capture time to the trip day in Korea time', () => {
  // 여행 첫날 2026-10-03 (KST)
  assert.equal(P.suggestDay('2026-10-03T01:00:00Z', '2026-10-03'), 1); // 10/3 10:00 KST
  assert.equal(P.suggestDay('2026-10-03T16:00:00Z', '2026-10-03'), 2); // 10/4 01:00 KST
  assert.equal(P.suggestDay('2026-10-05T14:59:00Z', '2026-10-03'), 3); // 10/5 23:59 KST
});

test('suggestDay returns null outside the trip or when the start date is unknown', () => {
  assert.equal(P.suggestDay('2026-10-02T10:00:00Z', '2026-10-03'), null);
  assert.equal(P.suggestDay('2026-10-05T15:00:00Z', '2026-10-03'), null); // 10/6 00:00 KST
  assert.equal(P.suggestDay('2026-10-03T01:00:00Z', null), null);
  assert.equal(P.suggestDay(null, '2026-10-03'), null);
});

// ---------------------------------------------------------------------------
// 1단계: 목록 정렬 · 필터 · 권한 · 캡션
// ---------------------------------------------------------------------------

const items = [
  { id: 1, day: 2, takenAt: '2026-10-04T03:00:00Z', createdAt: '2026-10-04T09:00:00Z' },
  { id: 2, day: 1, takenAt: '2026-10-03T03:00:00Z', createdAt: '2026-10-04T09:00:00Z' },
  { id: 3, day: null, takenAt: null, createdAt: '2026-10-02T09:00:00Z' },
  { id: 4, day: 1, takenAt: '2026-10-03T03:00:00Z', createdAt: '2026-10-03T09:00:00Z' },
];

test('sortByTakenAt orders by capture time, ties by id, missing times last', () => {
  assert.deepEqual(P.sortByTakenAt(items).map((x) => x.id), [2, 4, 1, 3]);
});

test('sortByTakenAt does not mutate its input', () => {
  const copy = items.map((x) => x.id);
  P.sortByTakenAt(items);
  assert.deepEqual(items.map((x) => x.id), copy);
});

test('filterByDay supports all / a specific day / etc', () => {
  assert.deepEqual(P.filterByDay(items, 'all').map((x) => x.id), [1, 2, 3, 4]);
  assert.deepEqual(P.filterByDay(items, 1).map((x) => x.id), [2, 4]);
  assert.deepEqual(P.filterByDay(items, '1').map((x) => x.id), [2, 4]);
  assert.deepEqual(P.filterByDay(items, 'etc').map((x) => x.id), [3]);
});

test('canModify allows only the owner (or anyone if the owner was deleted)', () => {
  assert.equal(P.canModify({ uploaderId: 5 }, 5), true);
  assert.equal(P.canModify({ uploaderId: 5 }, 6), false);
  assert.equal(P.canModify({ uploaderId: 5 }, null), false);
  assert.equal(P.canModify({ uploaderId: null }, 6), true);
  assert.equal(P.canModify({ authorId: 7 }, 7, 'authorId'), true);
});

test('validateCaption trims, allows empty, and limits length', () => {
  assert.deepEqual(P.validateCaption('  바다 보인다  '), { value: '바다 보인다' });
  assert.deepEqual(P.validateCaption('   '), { value: null });
  assert.deepEqual(P.validateCaption(undefined), { value: null });
  assert.ok(P.validateCaption('가'.repeat(P.LIMITS.captionMax + 1)).error);
  assert.deepEqual(P.validateCaption('가'.repeat(P.LIMITS.captionMax)).value.length, P.LIMITS.captionMax);
});

// ---------------------------------------------------------------------------
// 1단계: EXIF 원본값 추출 (리사이즈 전에 원본 파일에서 읽은 값 → 저장용 필드)
// ---------------------------------------------------------------------------

test('extractExif picks capture time, GPS and camera fields', () => {
  const raw = {
    DateTimeOriginal: new Date('2026-10-03T05:14:00Z'),
    latitude: 34.8512,
    longitude: 128.0231,
    Make: 'Apple',
    Model: 'iPhone 15 Pro',
    LensModel: 'iPhone 15 Pro back triple camera 6.765mm f/1.78',
    FocalLength: 6.765,
    FocalLengthIn35mmFormat: 24,
    ISO: 125,
    ExposureTime: 0.004,
    FNumber: 1.78,
    ExposureCompensation: 0, // exifr 는 ExposureBiasValue 를 이 이름으로 돌려줌
    Flash: 'Flash did not fire, compulsory flash mode',
    ImageWidth: 4032,
  };
  assert.deepEqual(P.extractExif(raw), {
    exifTime: new Date('2026-10-03T05:14:00Z'),
    lat: 34.8512,
    lng: 128.0231,
    camera: {
      make: 'Apple',
      model: 'iPhone 15 Pro',
      lens: 'iPhone 15 Pro back triple camera 6.765mm f/1.78',
      focalLength: 6.765,
      focal35: 24,
      iso: 125,
      exposureTime: 0.004,
      fNumber: 1.78,
      exposureBias: 0,
      flash: false,
    },
  });
});

test('extractExif also accepts the raw ExposureBiasValue tag name', () => {
  assert.equal(P.extractExif({ ExposureBiasValue: -1 }).camera.exposureBias, -1);
  assert.equal(P.extractExif({ ExposureCompensation: 0.3333 }).camera.exposureBias, 0.3333);
});

test('extractExif falls back to CreateDate and handles fired flash', () => {
  const r = P.extractExif({ CreateDate: new Date('2026-10-04T00:00:00Z'), Flash: 'Flash fired, auto mode' });
  assert.deepEqual(r.exifTime, new Date('2026-10-04T00:00:00Z'));
  assert.equal(r.camera.flash, true);
});

test('extractExif treats missing or 0,0 GPS as no location', () => {
  assert.equal(P.extractExif({ latitude: 0, longitude: 0 }).lat, null);
  assert.equal(P.extractExif({ latitude: NaN, longitude: 128 }).lng, null);
  assert.equal(P.extractExif({}).lat, null);
});

test('extractExif returns empty values for no EXIF at all', () => {
  assert.deepEqual(P.extractExif(null), { exifTime: null, lat: null, lng: null, camera: null });
  assert.deepEqual(P.extractExif(undefined).camera, null);
});

test('blobPath builds unique, safe upload paths', () => {
  assert.equal(P.blobPath('photo', 'jpg', 1759470000000, 'ab12'), 'photos/1759470000000-ab12.jpg');
  assert.equal(P.blobPath('thumb', 'jpg', 1759470000000, 'ab12'), 'photos/thumbs/1759470000000-ab12.jpg');
  assert.equal(P.blobPath('video', 'MOV', 1, 'x/../y'), 'photos/videos/1-xy.mov');
});

// ---------------------------------------------------------------------------
// 2단계: 촬영 정보 표시
// ---------------------------------------------------------------------------

test('formatShutter shows fractions under a second and seconds above', () => {
  assert.equal(P.formatShutter(0.004), '1/250s');
  assert.equal(P.formatShutter(1 / 8000), '1/8000s');
  assert.equal(P.formatShutter(0.3), '1/3s');
  assert.equal(P.formatShutter(0.5), '1/2s');
  assert.equal(P.formatShutter(1), '1s');
  assert.equal(P.formatShutter(2.5), '2.5s');
  assert.equal(P.formatShutter(30), '30s');
  assert.equal(P.formatShutter(0), null);
  assert.equal(P.formatShutter(undefined), null);
});

test('formatAperture rounds to one decimal', () => {
  assert.equal(P.formatAperture(1.78), 'f/1.8');
  assert.equal(P.formatAperture(8), 'f/8');
  assert.equal(P.formatAperture(2.2), 'f/2.2');
  assert.equal(P.formatAperture(null), null);
});

test('formatExposureBias shows sign and one decimal', () => {
  assert.equal(P.formatExposureBias(1 / 3), '+0.3EV');
  assert.equal(P.formatExposureBias(0), '0EV');
  assert.equal(P.formatExposureBias(-1), '-1EV');
  assert.equal(P.formatExposureBias(-2 / 3), '-0.7EV');
  assert.equal(P.formatExposureBias(undefined), null);
});

test('formatFocal shows actual and 35mm-equivalent focal length', () => {
  assert.equal(P.formatFocal(6.765, 24), '6.8mm (24mm 환산)');
  assert.equal(P.formatFocal(50, null), '50mm');
  assert.equal(P.formatFocal(null, 26), '26mm 환산');
  assert.equal(P.formatFocal(null, null), null);
});

test('summarizeCamera lists only the lines that have values', () => {
  const lines = P.summarizeCamera({
    make: 'Apple', model: 'iPhone 15 Pro', lens: 'iPhone 15 Pro back triple camera 6.765mm f/1.78',
    focalLength: 6.765, focal35: 24, iso: 125, exposureTime: 0.004, fNumber: 1.78, exposureBias: 1 / 3, flash: false,
  });
  assert.deepEqual(lines, [
    { key: 'device', label: '카메라', text: 'Apple iPhone 15 Pro' },
    { key: 'lens', label: '렌즈', text: 'iPhone 15 Pro back triple camera 6.765mm f/1.78 · 6.8mm (24mm 환산)' },
    { key: 'exposure', label: '노출', text: 'ISO 125 · 1/250s · f/1.8 · +0.3EV' },
  ]);
});

test('summarizeCamera avoids repeating the maker and shows flash when fired', () => {
  const lines = P.summarizeCamera({ make: 'SONY', model: 'SONY ILCE-7M4', iso: 3200, flash: true });
  assert.deepEqual(lines, [
    { key: 'device', label: '카메라', text: 'SONY ILCE-7M4' },
    { key: 'exposure', label: '노출', text: 'ISO 3200' },
    { key: 'flash', label: '플래시', text: '사용함' },
  ]);
  assert.deepEqual(P.summarizeCamera(null), []);
  assert.deepEqual(P.summarizeCamera({}), []);
});

test('formatDateTimeKo shows the full Korea-time date', () => {
  assert.equal(P.formatDateTimeKo('2026-10-03T05:14:00Z'), '2026년 10월 3일 (토) 오후 2:14');
  assert.equal(P.formatDateTimeKo('2026-10-03T15:05:00Z'), '2026년 10월 4일 (일) 오전 12:05');
  assert.equal(P.formatDateTimeKo('2026-10-04T03:00:00Z'), '2026년 10월 4일 (일) 오후 12:00');
  assert.equal(P.formatShortDateTimeKo('2026-10-03T00:30:00Z'), '10월 3일 (토) 오전 9:30');
  assert.equal(P.formatDateTimeKo(null), '');
});

test('distanceMeters approximates great-circle distance', () => {
  // 위도 0.01° ≈ 1.11km
  const d = P.distanceMeters(34.85, 128.02, 34.86, 128.02);
  assert.ok(d > 1100 && d < 1125, String(d));
  assert.equal(P.distanceMeters(34.85, 128.02, 34.85, 128.02), 0);
});

test('nearestPlace picks the closest place within range and skips places without coordinates', () => {
  const places = [
    { id: 'a', name: '가', lat: 34.85, lng: 128.02 },
    { id: 'b', name: '나', lat: 34.852, lng: 128.02 },
    { id: 'c', name: '다', lat: null, lng: null },
  ];
  assert.equal(P.nearestPlace(34.8519, 128.02, places).id, 'b');
  assert.equal(P.nearestPlace(34.95, 128.02, places), null); // 10km 떨어짐
  assert.equal(P.nearestPlace(34.95, 128.02, places, 20000).id, 'b');
  assert.equal(P.nearestPlace(null, null, places), null);
  assert.equal(P.nearestPlace(34.85, 128.02, []), null);
});

test('mapLinks builds Kakao Map and Google Maps links', () => {
  const links = P.mapLinks(34.85, 128.02, '창선교');
  assert.equal(links.kakao, 'https://map.kakao.com/link/map/%EC%B0%BD%EC%84%A0%EA%B5%90,34.85,128.02');
  assert.equal(links.google, 'https://www.google.com/maps/search/?api=1&query=34.85%2C128.02');
  assert.equal(P.mapLinks(null, 128, 'x'), null);
});

test('formatCoords shows hemisphere letters', () => {
  assert.equal(P.formatCoords(34.85, 128.02), '34.8500°N, 128.0200°E');
  assert.equal(P.formatCoords(-33.8688, -151.2093), '33.8688°S, 151.2093°W');
  assert.equal(P.formatCoords(null, 1), null);
});

test('isEdited reports manual time/location changes', () => {
  assert.deepEqual(P.isEdited({ takenAtSource: 'exif', locationSource: 'exif' }), { time: false, location: false });
  assert.deepEqual(P.isEdited({ takenAtSource: 'manual', locationSource: 'preset' }), { time: true, location: true });
  assert.deepEqual(P.isEdited({ takenAtSource: 'file', locationSource: 'manual' }), { time: false, location: true });
});

test('takenAtNote explains estimated capture times', () => {
  assert.equal(P.takenAtNote('exif'), '');
  assert.match(P.takenAtNote('file'), /추정/);
  assert.match(P.takenAtNote('upload'), /추정/);
  assert.match(P.takenAtNote('manual'), /수정/);
});

// ---------------------------------------------------------------------------
// 3단계: 시간·위치 수정 폼 도우미
// ---------------------------------------------------------------------------

test('toKstInputValue / fromKstInputValue convert for <input type="datetime-local">', () => {
  assert.equal(P.toKstInputValue('2026-10-03T05:14:00Z'), '2026-10-03T14:14');
  assert.equal(P.toKstInputValue(null), '');
  assert.equal(P.fromKstInputValue('2026-10-03T14:14'), '2026-10-03T05:14:00.000Z');
  assert.equal(P.fromKstInputValue(''), null);
  assert.equal(P.fromKstInputValue('garbage'), undefined);
});

const places = [
  { id: 'a', name: '적량마을', lat: 34.9, lng: 128.1 },
  { id: 'b', name: '가인리', lat: null, lng: null },
];
const photo = { lat: 34.85, lng: 128.02, placeName: null, locationSource: 'exif' };

test('locationChoice: a preset with coordinates replaces the location', () => {
  assert.deepEqual(P.locationChoice({ type: 'preset', id: 'a' }, photo, places),
    { lat: 34.9, lng: 128.1, placeName: '적량마을', locationSource: 'preset' });
});

test('locationChoice: a preset without coordinates only names the place', () => {
  assert.deepEqual(P.locationChoice({ type: 'preset', id: 'b' }, photo, places),
    { lat: 34.85, lng: 128.02, placeName: '가인리', locationSource: 'preset' });
});

test('locationChoice: custom name, clear, keep', () => {
  assert.deepEqual(P.locationChoice({ type: 'custom', name: '  편의점 앞 ' }, photo, places),
    { lat: 34.85, lng: 128.02, placeName: '편의점 앞', locationSource: 'manual' });
  assert.deepEqual(P.locationChoice({ type: 'clear' }, photo, places),
    { lat: null, lng: null, placeName: null, locationSource: null });
  assert.equal(P.locationChoice({ type: 'keep' }, photo, places), null);
  assert.equal(P.locationChoice({ type: 'preset', id: 'zzz' }, photo, places), null);
  assert.equal(P.locationChoice({ type: 'custom', name: '  ' }, photo, places), null);
});

// ---------------------------------------------------------------------------
// 4단계: 좋아요
// ---------------------------------------------------------------------------

test('toggleLike adds and removes my like without mutating the photo', () => {
  const photo = { id: 1, likeCount: 1, likedBy: [2] };
  const liked = P.toggleLike(photo, 5);
  assert.deepEqual(liked, { id: 1, likeCount: 2, likedBy: [2, 5] });
  assert.deepEqual(photo, { id: 1, likeCount: 1, likedBy: [2] });
  assert.deepEqual(P.toggleLike(liked, 5), { id: 1, likeCount: 1, likedBy: [2] });
});

test('toggleLike tolerates missing fields and invalid travelers', () => {
  assert.deepEqual(P.toggleLike({ id: 1 }, 3), { id: 1, likeCount: 1, likedBy: [3] });
  assert.deepEqual(P.toggleLike({ id: 1, likeCount: 0, likedBy: [] }, null), { id: 1, likeCount: 0, likedBy: [] });
});

test('hasLiked checks my like', () => {
  assert.equal(P.hasLiked({ likedBy: [1, 2] }, 2), true);
  assert.equal(P.hasLiked({ likedBy: [1, 2] }, 3), false);
  assert.equal(P.hasLiked({}, 3), false);
});

test('likeSummary names who liked it, with "외 N명" for many', () => {
  const names = { 1: '미솔', 2: '기아', 3: '소연', 4: '하늘' };
  const nameOf = (id) => names[id] || '알 수 없음';
  assert.equal(P.likeSummary([], nameOf), '');
  assert.equal(P.likeSummary([1], nameOf), '미솔님이 좋아해요');
  assert.equal(P.likeSummary([1, 2, 3], nameOf), '미솔, 기아, 소연님이 좋아해요');
  assert.equal(P.likeSummary([1, 2, 3, 4], nameOf), '미솔, 기아, 소연 외 1명이 좋아해요');
});

// ---------------------------------------------------------------------------
// 5단계: 댓글
// ---------------------------------------------------------------------------

test('validateComment requires text and limits length', () => {
  assert.deepEqual(P.validateComment('  멋지다!  '), { value: '멋지다!' });
  assert.ok(P.validateComment('   ').error);
  assert.ok(P.validateComment(null).error);
  assert.ok(P.validateComment('가'.repeat(P.LIMITS.commentMax + 1)).error);
  assert.equal(P.validateComment('가'.repeat(P.LIMITS.commentMax)).value.length, 300);
});

test('formatRelativeTime shows friendly Korean relative times', () => {
  const now = Date.parse('2026-10-04T12:00:00Z'); // 10/4 21:00 KST
  assert.equal(P.formatRelativeTime('2026-10-04T11:59:30Z', now), '방금');
  assert.equal(P.formatRelativeTime('2026-10-04T11:55:00Z', now), '5분 전');
  assert.equal(P.formatRelativeTime('2026-10-04T09:00:00Z', now), '3시간 전');
  assert.equal(P.formatRelativeTime('2026-10-03T09:00:00Z', now), '어제');      // 10/3 18:00 KST
  assert.equal(P.formatRelativeTime('2026-10-01T09:00:00Z', now), '10월 1일');
  assert.equal(P.formatRelativeTime('2026-10-04T12:00:30Z', now), '방금');     // 기기 시계가 조금 빨라도
  assert.equal(P.formatRelativeTime(null, now), '');
});

test('isCommentEdited checks updatedAt', () => {
  assert.equal(P.isCommentEdited({ updatedAt: null }), false);
  assert.equal(P.isCommentEdited({ updatedAt: '2026-10-04T12:00:00Z' }), true);
  assert.equal(P.isCommentEdited({}), false);
});

// ---------------------------------------------------------------------------
// 6단계: 영상 업로드
// ---------------------------------------------------------------------------

test('validateVideo enforces length and size limits', () => {
  assert.deepEqual(P.validateVideo({ durationSec: 12.3, size: 30 * 1024 * 1024 }), { ok: true });
  assert.match(P.validateVideo({ durationSec: 61, size: 1000 }).error, /60초/);
  assert.match(P.validateVideo({ durationSec: 10, size: 201 * 1024 * 1024 }).error, /200MB/);
  assert.ok(P.validateVideo({ durationSec: NaN, size: 1000 }).error);
  assert.ok(P.validateVideo({ durationSec: Infinity, size: 1000 }).error);
  assert.ok(P.validateVideo({ durationSec: 0, size: 1000 }).error);
});

test('videoThumbTime picks a representative frame early in the clip', () => {
  assert.equal(P.videoThumbTime(10), 1);
  assert.equal(P.videoThumbTime(1), 0.5);
  assert.equal(P.videoThumbTime(0.2), 0.1);
  assert.equal(P.videoThumbTime(NaN), 0);
});

test('videoFileInfo decides extension and content type', () => {
  assert.deepEqual(P.videoFileInfo({ name: 'IMG_0001.MOV', type: 'video/quicktime' }), { ext: 'mov', contentType: 'video/quicktime' });
  assert.deepEqual(P.videoFileInfo({ name: 'clip.mp4', type: '' }), { ext: 'mp4', contentType: 'video/mp4' });
  assert.deepEqual(P.videoFileInfo({ name: 'a.webm', type: 'video/webm' }), { ext: 'webm', contentType: 'video/webm' });
  assert.deepEqual(P.videoFileInfo({ name: 'noext', type: 'video/mp4' }), { ext: 'mp4', contentType: 'video/mp4' });
});

test('formatDuration shows m:ss', () => {
  assert.equal(P.formatDuration(4.2), '0:04');
  assert.equal(P.formatDuration(59.6), '1:00');
  assert.equal(P.formatDuration(75), '1:15');
  assert.equal(P.formatDuration(null), '');
});

// ---------------------------------------------------------------------------
// 배포 후 수정: 업로드 오류 문구 · 검은 영상 썸네일
// ---------------------------------------------------------------------------

test('uploadErrorMessage explains a missing Blob store instead of the library message', () => {
  const r = P.uploadErrorMessage('Vercel Blob: Failed to retrieve the client token');
  assert.equal(r.storageMissing, true);
  assert.match(r.text, /저장소/);
  assert.equal(P.uploadErrorMessage('Failed to fetch').storageMissing, false);
  assert.match(P.uploadErrorMessage('Failed to fetch').text, /네트워크/);
  assert.equal(P.uploadErrorMessage('캡션은(는) 100자 이하로 입력해 주세요.').text, '캡션은(는) 100자 이하로 입력해 주세요.');
  assert.match(P.uploadErrorMessage('').text, /다시/);
});

test('isMostlyBlack detects black video frames from RGBA pixels', () => {
  const black = new Uint8ClampedArray(4 * 16).fill(0);
  for (let i = 3; i < black.length; i += 4) black[i] = 255;
  assert.equal(P.isMostlyBlack(black), true);
  const bright = new Uint8ClampedArray(4 * 16).fill(200);
  assert.equal(P.isMostlyBlack(bright), false);
  const dim = new Uint8ClampedArray(4 * 16).fill(12);
  assert.equal(P.isMostlyBlack(dim), true);
  assert.equal(P.isMostlyBlack(new Uint8ClampedArray(0)), true);
});

test('dayDate / formatDayDate: n일차를 그날 날짜로 바꾼다', () => {
  assert.equal(P.dayDate(1, '2026-09-24'), '2026-09-24');
  assert.equal(P.dayDate(3, '2026-09-24'), '2026-09-26');
  assert.equal(P.dayDate(2, '2026-12-31'), '2027-01-01');
  assert.equal(P.dayDate(1, null), null);
  assert.equal(P.dayDate(0, '2026-09-24'), null);
  assert.equal(P.formatDayDate(2, '2026-09-24'), '9/25');
  assert.equal(P.formatDayDate(1, null), '');
});

test('여행 첫날(places.js)이 정해져 있어 촬영 날짜가 일차로 연결된다', () => {
  const TripPlaces = require('../assets/places.js');
  assert.match(TripPlaces.TRIP_START_DATE, /^\d{4}-\d{2}-\d{2}$/);
  // 9/24 23:30 KST → 1일차, 9/25 00:10 KST → 2일차 (UTC 가 아니라 한국 날짜 기준)
  assert.equal(P.suggestDay('2026-09-24T14:30:00Z', TripPlaces.TRIP_START_DATE), 1);
  assert.equal(P.suggestDay('2026-09-24T15:10:00Z', TripPlaces.TRIP_START_DATE), 2);
  assert.equal(P.suggestDay('2026-09-26T03:00:00Z', TripPlaces.TRIP_START_DATE), 3);
  assert.equal(P.suggestDay('2026-09-27T03:00:00Z', TripPlaces.TRIP_START_DATE), null);
});

// ---- 모바일 사진첩: 모아보기 · 좋아요 ------------------------------------------

const albumPhotos = [
  { id: 1, uploaderId: 5, day: 1, takenAt: '2026-09-24T03:00:00Z', likedBy: [5] },
  { id: 2, uploaderId: 4, day: 2, takenAt: '2026-09-25T03:00:00Z', likedBy: [] },
  { id: 3, uploaderId: 5, day: 1, takenAt: '2026-09-24T01:00:00Z', likedBy: [4, 5] },
  { id: 4, uploaderId: 99, day: null, takenAt: null, likedBy: [4] },
];
const albumTravelers = [{ id: 2, name: '단해' }, { id: 4, name: '정환' }, { id: 5, name: '미솔' }];

test('groupByUploader: 사진 많은 사람부터, 사진 없는 사람도 포함, 모르는 사람은 맨 뒤', () => {
  const g = P.groupByUploader(albumPhotos, albumTravelers);
  assert.deepEqual(g.map((x) => [x.name, x.photos.map((p) => p.id)]), [
    ['미솔', [3, 1]], ['정환', [2]], ['단해', []], ['알 수 없음', [4]],
  ]);
});

test('groupByDay: 여행 일수만큼 + 일차 없는 사진은 etc', () => {
  const g = P.groupByDay(albumPhotos, 3);
  assert.deepEqual(g.map((x) => [x.day, x.photos.map((p) => p.id)]), [[1, [3, 1]], [2, [2]], [3, []], ['etc', [4]]]);
  assert.equal(P.groupByDay(albumPhotos.slice(0, 3), 3).length, 3);
});

test('likedBy: 내가 좋아요한 사진만, 나를 모르면 빈 목록', () => {
  assert.deepEqual(P.likedBy(albumPhotos, 5).map((p) => p.id), [3, 1]);
  assert.deepEqual(P.likedBy(albumPhotos, 4).map((p) => p.id), [3, 4]);
  assert.deepEqual(P.likedBy(albumPhotos, null), []);
});

test('canManagePhoto: 관리자는 모든 사진, 아니면 내가 올린 사진만', () => {
  assert.equal(P.canManagePhoto({ uploaderId: 1 }, 1, 'member'), true);
  assert.equal(P.canManagePhoto({ uploaderId: 1 }, 2, 'member'), false);
  assert.equal(P.canManagePhoto({ uploaderId: 1 }, 2, 'admin'), true);
  assert.equal(P.canManagePhoto({ uploaderId: 1 }, 2, null), false);
});
