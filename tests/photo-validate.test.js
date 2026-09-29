const test = require('node:test');
const assert = require('node:assert/strict');

const { parsePhoto, isBlobUrl } = require('../api/_photo-validate.js');

const BLOB = 'https://abc123.public.blob.vercel-storage.com/photos/a-XyZ.jpg';
const THUMB = 'https://abc123.public.blob.vercel-storage.com/photos/thumbs/a-XyZ.jpg';

function base(extra) {
  return Object.assign(
    { uploaderId: 3, mediaType: 'image', url: BLOB, thumbUrl: THUMB, width: 2048, height: 1536 },
    extra,
  );
}

test('isBlobUrl accepts only https Vercel Blob URLs', () => {
  assert.equal(isBlobUrl(BLOB), true);
  assert.equal(isBlobUrl('http://abc.public.blob.vercel-storage.com/x.jpg'), false);
  assert.equal(isBlobUrl('https://evil.example.com/x.jpg'), false);
  assert.equal(isBlobUrl('https://blob.vercel-storage.com.evil.com/x.jpg'), false);
  assert.equal(isBlobUrl('not a url'), false);
  assert.equal(isBlobUrl(null), false);
});

test('parsePhoto accepts a minimal valid photo', () => {
  const r = parsePhoto(base());
  assert.equal(r.error, undefined);
  assert.equal(r.value.uploaderId, 3);
  assert.equal(r.value.mediaType, 'image');
  assert.equal(r.value.caption, null);
  assert.equal(r.value.day, null);
  assert.equal(r.value.takenAt, null);
});

test('parsePhoto requires an uploader and blob URLs', () => {
  assert.ok(parsePhoto(base({ uploaderId: undefined })).error);
  assert.ok(parsePhoto(base({ url: 'https://evil.example.com/a.jpg' })).error);
  assert.ok(parsePhoto(base({ thumbUrl: '' })).error);
});

test('parsePhoto validates media type, day and caption', () => {
  assert.ok(parsePhoto(base({ mediaType: 'audio' })).error);
  assert.ok(parsePhoto(base({ day: 4 })).error);
  assert.ok(parsePhoto(base({ day: 0 })).error);
  assert.equal(parsePhoto(base({ day: '2' })).value.day, 2);
  assert.equal(parsePhoto(base({ day: '' })).value.day, null);
  assert.equal(parsePhoto(base({ caption: '  노을  ' })).value.caption, '노을');
  assert.ok(parsePhoto(base({ caption: 'x'.repeat(101) })).error);
});

test('parsePhoto keeps the captured time and location as the original values', () => {
  const r = parsePhoto(base({
    takenAt: '2026-10-03T05:14:00.000Z',
    takenAtSource: 'exif',
    lat: 34.85, lng: 128.02,
  }));
  assert.equal(r.value.takenAt, '2026-10-03T05:14:00.000Z');
  assert.equal(r.value.originalTakenAt, '2026-10-03T05:14:00.000Z');
  assert.equal(r.value.takenAtSource, 'exif');
  assert.equal(r.value.lat, 34.85);
  assert.equal(r.value.originalLat, 34.85);
  assert.equal(r.value.locationSource, 'exif');
});

test('parsePhoto rejects half coordinates and out-of-range values', () => {
  assert.ok(parsePhoto(base({ lat: 34.8 })).error);
  assert.ok(parsePhoto(base({ lat: 91, lng: 128 })).error);
  assert.ok(parsePhoto(base({ lat: 34, lng: 181 })).error);
  assert.ok(parsePhoto(base({ takenAt: 'yesterday' })).error);
});

test('parsePhoto whitelists camera fields', () => {
  const r = parsePhoto(base({
    camera: { make: 'Apple', model: 'iPhone 15 Pro', iso: 125, exposureTime: 0.004, evil: '<script>' },
  }));
  assert.deepEqual(r.value.camera, { make: 'Apple', model: 'iPhone 15 Pro', iso: 125, exposureTime: 0.004 });
  assert.equal(parsePhoto(base({ camera: 'nope' })).value.camera, null);
});

test('parsePhoto validates video length', () => {
  assert.equal(parsePhoto(base({ mediaType: 'video', durationSec: 12.5 })).value.durationSec, 12.5);
  assert.ok(parsePhoto(base({ mediaType: 'video', durationSec: 61 })).error);
});

// ---------------------------------------------------------------------------
// 3단계: 시간·위치 수정 (PATCH)
// ---------------------------------------------------------------------------
const { parsePhotoPatch } = require('../api/_photo-validate.js');

const NOW = Date.parse('2026-10-06T00:00:00Z');
const current = {
  caption: '노을', day: 1,
  takenAt: '2026-10-03T05:14:00.000Z', takenAtSource: 'exif',
  lat: 34.85, lng: 128.02, placeName: null, locationSource: 'exif',
  original: { takenAt: '2026-10-03T05:14:00.000Z', takenAtSource: 'exif', lat: 34.85, lng: 128.02 },
};

test('parsePhotoPatch requires the traveler id', () => {
  assert.ok(parsePhotoPatch({ caption: 'x' }, current, NOW).error);
});

test('parsePhotoPatch keeps untouched fields as they are', () => {
  const r = parsePhotoPatch({ travelerId: 1, caption: '  바다  ' }, current, NOW);
  assert.deepEqual(r.value, {
    caption: '바다', day: 1,
    takenAt: '2026-10-03T05:14:00.000Z', takenAtSource: 'exif',
    lat: 34.85, lng: 128.02, placeName: null, locationSource: 'exif',
  });
});

test('parsePhotoPatch marks a changed time as manual and rejects future times', () => {
  const r = parsePhotoPatch({ travelerId: 1, takenAt: '2026-10-03T08:00:00+09:00' }, current, NOW);
  assert.equal(r.value.takenAt, '2026-10-02T23:00:00.000Z');
  assert.equal(r.value.takenAtSource, 'manual');
  assert.ok(parsePhotoPatch({ travelerId: 1, takenAt: '2026-10-07T00:00:00Z' }, current, NOW).error);
  assert.ok(parsePhotoPatch({ travelerId: 1, takenAt: 'nope' }, current, NOW).error);
});

test('parsePhotoPatch sets a preset or manual place', () => {
  const preset = parsePhotoPatch({ travelerId: 1, placeName: '적량마을', lat: 34.9, lng: 128.1, locationSource: 'preset' }, current, NOW);
  assert.deepEqual(
    [preset.value.placeName, preset.value.lat, preset.value.lng, preset.value.locationSource],
    ['적량마을', 34.9, 128.1, 'preset'],
  );
  const manual = parsePhotoPatch({ travelerId: 1, placeName: '편의점 앞', lat: 34.85, lng: 128.02 }, current, NOW);
  assert.equal(manual.value.locationSource, 'manual');
  assert.ok(parsePhotoPatch({ travelerId: 1, placeName: 'x'.repeat(51), lat: null, lng: null }, current, NOW).error);
});

test('parsePhotoPatch can clear the location', () => {
  const r = parsePhotoPatch({ travelerId: 1, lat: null, lng: null, placeName: null }, current, NOW);
  assert.deepEqual([r.value.lat, r.value.lng, r.value.placeName, r.value.locationSource], [null, null, null, null]);
});

test('parsePhotoPatch reset restores the original values from the file', () => {
  const edited = Object.assign({}, current, {
    takenAt: '2026-10-01T00:00:00.000Z', takenAtSource: 'manual',
    lat: 1, lng: 2, placeName: '엉뚱한 곳', locationSource: 'manual',
  });
  const r = parsePhotoPatch({ travelerId: 1, reset: ['time', 'location'], placeName: '창선교' }, edited, NOW);
  assert.equal(r.value.takenAt, '2026-10-03T05:14:00.000Z');
  assert.equal(r.value.takenAtSource, 'exif');
  assert.deepEqual([r.value.lat, r.value.lng, r.value.locationSource, r.value.placeName], [34.85, 128.02, 'exif', '창선교']);
});

test('parsePhotoPatch reset without original location clears it', () => {
  const noLoc = Object.assign({}, current, { original: { takenAt: null, takenAtSource: null, lat: null, lng: null } });
  const r = parsePhotoPatch({ travelerId: 1, reset: ['location', 'time'] }, noLoc, NOW);
  assert.deepEqual([r.value.lat, r.value.placeName, r.value.locationSource], [null, null, null]);
  assert.deepEqual([r.value.takenAt, r.value.takenAtSource], [null, null]);
});

test('parsePhoto remembers where the original time came from', () => {
  const r = parsePhoto(base({ takenAt: '2026-09-27T11:06:00Z', takenAtSource: 'file' }));
  assert.equal(r.value.originalTakenAtSource, 'file');
});

test('presignedUploadOptions: 서명을 그 경로의 put 하나로 좁히고 경로를 바꾸지 않는다', () => {
  const { presignedUploadOptions } = require('../api/_photo-validate.js');
  const now = Date.UTC(2026, 8, 28);
  const { signed, urlOptions } = presignedUploadOptions('photos/1-abc.jpg', now);
  assert.equal(signed.pathname, 'photos/1-abc.jpg');
  assert.deepEqual(signed.operations, ['put']);
  assert.equal(signed.validUntil, now + 60 * 60 * 1000);
  assert.ok(signed.allowedContentTypes.includes('image/jpeg'));
  assert.equal(urlOptions.addRandomSuffix, false);
  assert.throws(() => presignedUploadOptions('../etc/passwd'), /허용되지 않은/);
  assert.throws(() => presignedUploadOptions('other/x.jpg'), /허용되지 않은/);
});

// ---------------------------------------------------------------------------
// 사진 날짜 ↔ n일차 연결
// ---------------------------------------------------------------------------
const TRIP = { tripStartDate: '2026-09-24' };

test('parsePhoto: 일차를 고르지 않으면 촬영 날짜(한국 시간)로 정한다', () => {
  assert.equal(parsePhoto(base({ takenAt: '2026-09-25T09:00:00+09:00' }), TRIP).value.day, 2);
  assert.equal(parsePhoto(base({ takenAt: '2026-09-24T23:50:00+09:00' }), TRIP).value.day, 1);
  // 직접 고른 일차가 우선
  assert.equal(parsePhoto(base({ takenAt: '2026-09-25T09:00:00+09:00', day: 3 }), TRIP).value.day, 3);
  // 여행 기간 밖·시각 없음·첫날 모름 → 일차 없음
  assert.equal(parsePhoto(base({ takenAt: '2026-09-20T09:00:00+09:00' }), TRIP).value.day, null);
  assert.equal(parsePhoto(base(), TRIP).value.day, null);
  assert.equal(parsePhoto(base({ takenAt: '2026-09-25T09:00:00+09:00' }), { tripStartDate: null }).value.day, null);
});

test('parsePhotoPatch: 촬영 시각을 바꾸면 그 날짜의 일차로 옮긴다', () => {
  const cur = Object.assign({}, current, {
    day: 1, takenAt: '2026-09-24T03:00:00.000Z',
    original: Object.assign({}, current.original, { takenAt: '2026-09-24T03:00:00.000Z' }),
  });
  const moved = parsePhotoPatch({ travelerId: 1, takenAt: '2026-09-26T10:00:00+09:00' }, cur, NOW, TRIP);
  assert.equal(moved.value.day, 3);
  // 일차를 함께 보내면 그 값을 따른다
  const explicit = parsePhotoPatch({ travelerId: 1, takenAt: '2026-09-26T10:00:00+09:00', day: 2 }, cur, NOW, TRIP);
  assert.equal(explicit.value.day, 2);
  // 여행 기간 밖으로 옮기면 일차는 그대로
  const outside = parsePhotoPatch({ travelerId: 1, takenAt: '2026-09-28T10:00:00+09:00' }, cur, NOW, TRIP);
  assert.equal(outside.value.day, 1);
  // 시각을 안 바꾸면 일차도 그대로
  assert.equal(parsePhotoPatch({ travelerId: 1, caption: 'x' }, Object.assign({}, cur, { day: null }), NOW, TRIP).value.day, null);
});

test('parsePhotoPatch: 원래 시각으로 되돌리면 원래 날짜의 일차로 돌아간다', () => {
  const cur = Object.assign({}, current, {
    day: 3, takenAt: '2026-09-26T01:00:00.000Z', takenAtSource: 'manual',
    original: Object.assign({}, current.original, { takenAt: '2026-09-25T01:00:00.000Z', takenAtSource: 'exif' }),
  });
  assert.equal(parsePhotoPatch({ travelerId: 1, reset: ['time'] }, cur, NOW, TRIP).value.day, 2);
});

test('parsePhoto: 올리기 전에 고친 사진도 파일에서 읽은 원래 값을 남긴다', () => {
  const r = parsePhoto(base({
    takenAt: '2026-09-25T10:00:00+09:00', takenAtSource: 'manual',
    placeName: '창선교', locationSource: 'manual', lat: 34.85, lng: 128.02,
    original: { takenAt: '2026-09-24T10:00:00+09:00', takenAtSource: 'exif', lat: 34.85, lng: 128.02 },
  }), TRIP);
  assert.equal(r.value.takenAtSource, 'manual');
  assert.equal(r.value.originalTakenAt, '2026-09-24T01:00:00.000Z');
  assert.equal(r.value.originalTakenAtSource, 'exif');
  assert.equal(r.value.originalLat, 34.85);
  // 파일 시각이 아닌 값(upload·manual)은 원본으로 남기지 않음
  const r2 = parsePhoto(base({ takenAt: '2026-09-25T10:00:00+09:00', takenAtSource: 'manual',
    original: { takenAt: '2026-09-28T10:00:00+09:00', takenAtSource: 'upload' } }), TRIP);
  assert.equal(r2.value.originalTakenAt, null);
  assert.ok(parsePhoto(base({ original: { takenAt: 'nope', takenAtSource: 'exif' } })).error);
});

test('parsePhotoPatch: 올린 사람이 아니면 캡션은 못 고치고 나머지는 고칠 수 있다', () => {
  const r = parsePhotoPatch({ travelerId: 2, caption: 'x' }, current, NOW, { isOwner: false });
  assert.equal(r.status, 403);
  const ok = parsePhotoPatch({ travelerId: 2, day: 2, placeName: '적량마을', locationSource: 'manual' }, current, NOW, { isOwner: false });
  assert.equal(ok.error, undefined);
  assert.equal(ok.value.day, 2);
  assert.equal(ok.value.caption, '노을');
});

test('uploadRule: 앨범(photos/)과 여행별 미리보기(trips/<id>/preview/)만, 다른 여행 경로는 거절', () => {
  const { uploadRule, uploadTokenOptions } = require('../api/_photo-validate.js');
  assert.equal(uploadRule('photos/1-abc.jpg').maxBytes > 8 * 1024 * 1024, true, '앨범은 영상 용량까지');
  const pv = uploadRule('trips/5/preview/1-abc.jpg', 5);
  assert.deepEqual(pv.types, ['image/jpeg', 'image/png', 'image/webp']);
  assert.equal(pv.maxBytes, 8 * 1024 * 1024);
  assert.throws(() => uploadRule('trips/6/preview/1-abc.jpg', 5), /다른 여행/);
  assert.throws(() => uploadRule('trips/5/other/1.jpg', 5), /허용되지 않은/);
  assert.throws(() => uploadRule('trips/5/preview/../x.jpg', 5), /허용되지 않은/);
  assert.deepEqual(uploadTokenOptions('trips/5/preview/1.jpg', 5).allowedContentTypes, ['image/jpeg', 'image/png', 'image/webp']);
});
