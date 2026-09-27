const test = require('node:test');
const assert = require('node:assert/strict');

const { createFakeSql, loadHandler, call } = require('./helpers/fake-api.js');

const BLOB = 'https://abc.public.blob.vercel-storage.com/photos/a.jpg';
const THUMB = 'https://abc.public.blob.vercel-storage.com/photos/thumbs/a.jpg';

function photoRow(extra) {
  return Object.assign({
    id: 10,
    uploader_id: 1,
    media_type: 'image',
    url: BLOB,
    thumb_url: THUMB,
    width: 2048,
    height: 1536,
    duration_sec: null,
    caption: '노을',
    day: 1,
    taken_at: new Date('2026-10-03T05:14:00Z'),
    lat: 34.85,
    lng: 128.02,
    place_name: null,
    taken_at_source: 'exif',
    location_source: 'exif',
    original_taken_at: new Date('2026-10-03T05:14:00Z'),
    original_taken_at_source: 'exif',
    original_lat: 34.85,
    original_lng: 128.02,
    camera: { model: 'iPhone 15 Pro', iso: 125 },
    created_at: new Date('2026-10-03T06:00:00Z'),
    updated_at: new Date('2026-10-03T06:00:00Z'),
    like_count: 0,
    liked_by: [],
    comment_count: 0,
  }, extra);
}

function blobMock() {
  const deleted = [];
  return { deleted, module: { del: async (urls) => { deleted.push(...[].concat(urls)); } } };
}

// ---- GET ------------------------------------------------------------------

test('GET /api/photos returns photos (camelCase) and travelers', async () => {
  const sql = createFakeSql((text) => {
    if (text.includes('FROM travelers')) return { rows: [{ id: 1, name: '미솔' }] };
    if (text.includes('FROM photos')) return { rows: [photoRow()] };
    return { rows: [] };
  });
  const handler = loadHandler('photos.js', sql, { '@vercel/blob': blobMock().module });
  const res = await call(handler, { method: 'GET' });

  assert.equal(res.statusCode, 200);
  assert.deepEqual(res.body.travelers, [{ id: 1, name: '미솔' }]);
  const p = res.body.photos[0];
  assert.equal(p.id, 10);
  assert.equal(p.uploaderId, 1);
  assert.equal(p.thumbUrl, THUMB);
  assert.equal(p.takenAt, '2026-10-03T05:14:00.000Z');
  assert.deepEqual(p.original, { takenAt: '2026-10-03T05:14:00.000Z', takenAtSource: 'exif', lat: 34.85, lng: 128.02 });
  assert.deepEqual(p.camera, { model: 'iPhone 15 Pro', iso: 125 });
});

test('GET /api/photos includes like counts and who liked each photo', async () => {
  const sql = createFakeSql((text) => {
    if (text.includes('FROM travelers')) return { rows: [] };
    if (text.includes('FROM photos')) return { rows: [photoRow({ like_count: '2', liked_by: [3, 1] })] };
    return { rows: [] };
  });
  const handler = loadHandler('photos.js', sql, { '@vercel/blob': blobMock().module });
  const res = await call(handler, { method: 'GET' });
  assert.equal(res.body.photos[0].likeCount, 2);
  assert.deepEqual(res.body.photos[0].likedBy, [3, 1]);
  const list = sql.calls.find((c) => c.text.includes('FROM photos'));
  assert.ok(/photo_likes/.test(list.text), '목록 쿼리에서 좋아요 집계');
  assert.ok(/photo_comments/.test(list.text), '목록 쿼리에서 댓글 수 집계');
});

// ---- POST -----------------------------------------------------------------

test('POST /api/photos stores a valid photo', async () => {
  const sql = createFakeSql((text) => {
    if (text.startsWith('SELECT 1 FROM travelers')) return { rows: [{ '?column?': 1 }] };
    if (text.startsWith('INSERT INTO photos')) return { rows: [photoRow({ id: 11 })] };
    return { rows: [] };
  });
  const handler = loadHandler('photos.js', sql, { '@vercel/blob': blobMock().module });
  const res = await call(handler, {
    method: 'POST',
    body: { uploaderId: 1, url: BLOB, thumbUrl: THUMB, width: 2048, height: 1536, takenAt: '2026-10-03T05:14:00Z', takenAtSource: 'exif' },
  });
  assert.equal(res.statusCode, 201);
  assert.equal(res.body.id, 11);
  const insert = sql.calls.find((c) => c.text.startsWith('INSERT INTO photos'));
  assert.ok(insert.values.includes(BLOB));
});

test('POST /api/photos rejects invalid input with 400', async () => {
  const sql = createFakeSql(() => ({ rows: [] }));
  const handler = loadHandler('photos.js', sql, { '@vercel/blob': blobMock().module });
  const res = await call(handler, { method: 'POST', body: { uploaderId: 1, url: 'https://evil.com/a.jpg', thumbUrl: THUMB } });
  assert.equal(res.statusCode, 400);
  assert.equal(sql.calls.filter((c) => c.text.startsWith('INSERT')).length, 0);
});

test('POST /api/photos rejects an unknown uploader', async () => {
  const sql = createFakeSql(() => ({ rows: [] }));
  const handler = loadHandler('photos.js', sql, { '@vercel/blob': blobMock().module });
  const res = await call(handler, { method: 'POST', body: { uploaderId: 99, url: BLOB, thumbUrl: THUMB } });
  assert.equal(res.statusCode, 400);
});

// ---- DELETE ---------------------------------------------------------------

function deleteSql(row) {
  return createFakeSql((text) => {
    if (text.startsWith('SELECT') && text.includes('FROM photos')) return { rows: row ? [row] : [] };
    return { rows: [] };
  });
}

test('DELETE /api/photos lets the uploader delete and removes blob files', async () => {
  const blob = blobMock();
  const sql = deleteSql(photoRow());
  const handler = loadHandler('photos.js', sql, { '@vercel/blob': blob.module });
  const res = await call(handler, { method: 'DELETE', query: { id: '10', travelerId: '1' } });
  assert.equal(res.statusCode, 200);
  assert.ok(sql.calls.some((c) => c.text.startsWith('DELETE FROM photos')));
  assert.deepEqual(blob.deleted.sort(), [BLOB, THUMB].sort());
});

test('DELETE /api/photos forbids other travelers (403)', async () => {
  const blob = blobMock();
  const sql = deleteSql(photoRow());
  const handler = loadHandler('photos.js', sql, { '@vercel/blob': blob.module });
  const res = await call(handler, { method: 'DELETE', query: { id: '10', travelerId: '2' } });
  assert.equal(res.statusCode, 403);
  assert.equal(sql.calls.filter((c) => c.text.startsWith('DELETE')).length, 0);
  assert.equal(blob.deleted.length, 0);
});

test('DELETE /api/photos returns 404 / 400 for missing photo or ids', async () => {
  const handler404 = loadHandler('photos.js', deleteSql(null), { '@vercel/blob': blobMock().module });
  assert.equal((await call(handler404, { method: 'DELETE', query: { id: '10', travelerId: '1' } })).statusCode, 404);
  const handler400 = loadHandler('photos.js', deleteSql(photoRow()), { '@vercel/blob': blobMock().module });
  assert.equal((await call(handler400, { method: 'DELETE', query: { id: '10' } })).statusCode, 400);
});

test('DELETE still removes the row when blob cleanup fails', async () => {
  const sql = deleteSql(photoRow());
  const handler = loadHandler('photos.js', sql, {
    '@vercel/blob': { del: async () => { throw new Error('no token'); } },
  });
  const res = await call(handler, { method: 'DELETE', query: { id: '10', travelerId: '1' } });
  assert.equal(res.statusCode, 200);
  assert.ok(sql.calls.some((c) => c.text.startsWith('DELETE FROM photos')));
});

// ---- 업로드 토큰 규칙 ------------------------------------------------------

test('upload token rules only allow the photos/ folder, media types and size limit', () => {
  const { uploadTokenOptions } = require('../api/_photo-validate.js');
  const opts = uploadTokenOptions('photos/abc.jpg');
  assert.ok(opts.allowedContentTypes.includes('image/jpeg'));
  assert.ok(opts.allowedContentTypes.includes('video/mp4'));
  assert.equal(opts.maximumSizeInBytes, 200 * 1024 * 1024);
  assert.equal(opts.addRandomSuffix, true);
  assert.throws(() => uploadTokenOptions('../secret.txt'));
  assert.throws(() => uploadTokenOptions('other/abc.jpg'));
});

// ---- PATCH (3단계) ----------------------------------------------------------

function patchSql(row) {
  return createFakeSql((text) => {
    if (text.startsWith('SELECT') && text.includes('FROM photos')) return { rows: row ? [row] : [] };
    if (text.startsWith('UPDATE photos')) return { rows: [Object.assign({}, row, { caption: '수정됨', taken_at_source: 'manual' })] };
    return { rows: [] };
  });
}

test('PATCH /api/photos lets the uploader edit time and place', async () => {
  const sql = patchSql(photoRow());
  const handler = loadHandler('photos.js', sql, { '@vercel/blob': blobMock().module });
  const res = await call(handler, {
    method: 'PATCH', query: { id: '10' },
    body: { travelerId: 1, takenAt: '2026-09-20T06:00:00Z', placeName: '창선교', lat: 34.85, lng: 128.02, locationSource: 'preset' },
  });
  assert.equal(res.statusCode, 200);
  const update = sql.calls.find((c) => c.text.startsWith('UPDATE photos'));
  assert.ok(update, 'UPDATE 실행');
  assert.ok(update.values.includes('2026-09-20T06:00:00.000Z'));
  assert.ok(update.values.includes('manual'));
  assert.ok(update.values.includes('창선교'));
  assert.equal(res.body.caption, '수정됨');
});

test('PATCH /api/photos forbids other travelers and validates input', async () => {
  const h1 = loadHandler('photos.js', patchSql(photoRow()), { '@vercel/blob': blobMock().module });
  assert.equal((await call(h1, { method: 'PATCH', query: { id: '10' }, body: { travelerId: 2, caption: 'x' } })).statusCode, 403);
  const h2 = loadHandler('photos.js', patchSql(photoRow()), { '@vercel/blob': blobMock().module });
  assert.equal((await call(h2, { method: 'PATCH', query: { id: '10' }, body: { travelerId: 1, takenAt: 'nope' } })).statusCode, 400);
  const h3 = loadHandler('photos.js', patchSql(null), { '@vercel/blob': blobMock().module });
  assert.equal((await call(h3, { method: 'PATCH', query: { id: '10' }, body: { travelerId: 1 } })).statusCode, 404);
});

// ---- 업로드 가능 여부 (배포 후 수정) ----------------------------------------

test('GET /api/photo-upload reports whether the Blob store is connected', async () => {
  const handlerPath = require.resolve('../api/photo-upload.js');
  const saved = process.env.BLOB_READ_WRITE_TOKEN;
  try {
    delete require.cache[handlerPath];
    delete process.env.BLOB_READ_WRITE_TOKEN;
    let res = await call(require(handlerPath), { method: 'GET' });
    assert.equal(res.statusCode, 200);
    assert.equal(res.body.ready, false);
    assert.match(res.body.message, /Blob/);
    assert.ok(Array.isArray(res.body.blobEnvNames));
    process.env.BLOB_READ_WRITE_TOKEN = 'vercel_blob_rw_test';
    res = await call(require(handlerPath), { method: 'GET' });
    assert.deepEqual(res.body, { ready: true });
  } finally {
    if (saved === undefined) delete process.env.BLOB_READ_WRITE_TOKEN;
    else process.env.BLOB_READ_WRITE_TOKEN = saved;
  }
});
