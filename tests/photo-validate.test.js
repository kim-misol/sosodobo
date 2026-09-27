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
