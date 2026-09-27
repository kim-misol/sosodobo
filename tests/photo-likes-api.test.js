const test = require('node:test');
const assert = require('node:assert/strict');

const { createFakeSql, loadHandler, call } = require('./helpers/fake-api.js');

function likesSql({ photoExists = true, travelerExists = true, likedBy = [1] } = {}) {
  return createFakeSql((text) => {
    if (text.startsWith('SELECT 1 FROM photos')) return { rows: photoExists ? [{}] : [] };
    if (text.startsWith('SELECT 1 FROM travelers')) return { rows: travelerExists ? [{}] : [] };
    if (text.includes('FROM photo_likes')) return { rows: likedBy.map((id) => ({ traveler_id: id })) };
    return { rows: [] };
  });
}

test('POST /api/photo-likes adds a like (idempotent) and returns the new list', async () => {
  const sql = likesSql({ likedBy: [2, 1] });
  const handler = loadHandler('photo-likes.js', sql);
  const res = await call(handler, { method: 'POST', body: { photoId: 10, travelerId: 1 } });
  assert.equal(res.statusCode, 200);
  assert.deepEqual(res.body, { photoId: 10, likeCount: 2, likedBy: [2, 1] });
  const insert = sql.calls.find((c) => c.text.startsWith('INSERT INTO photo_likes'));
  assert.ok(insert && /ON CONFLICT/.test(insert.text), '중복 좋아요는 무시');
});

test('DELETE /api/photo-likes removes my like', async () => {
  const sql = likesSql({ likedBy: [] });
  const handler = loadHandler('photo-likes.js', sql);
  const res = await call(handler, { method: 'DELETE', query: { photoId: '10', travelerId: '1' } });
  assert.equal(res.statusCode, 200);
  assert.deepEqual(res.body, { photoId: 10, likeCount: 0, likedBy: [] });
  assert.ok(sql.calls.some((c) => c.text.startsWith('DELETE FROM photo_likes')));
});

test('photo-likes validates ids and existence', async () => {
  const h = loadHandler('photo-likes.js', likesSql());
  assert.equal((await call(h, { method: 'POST', body: { photoId: 'x', travelerId: 1 } })).statusCode, 400);
  const h404 = loadHandler('photo-likes.js', likesSql({ photoExists: false }));
  assert.equal((await call(h404, { method: 'POST', body: { photoId: 10, travelerId: 1 } })).statusCode, 404);
  const hNoTraveler = loadHandler('photo-likes.js', likesSql({ travelerExists: false }));
  assert.equal((await call(hNoTraveler, { method: 'POST', body: { photoId: 10, travelerId: 9 } })).statusCode, 400);
  const h405 = loadHandler('photo-likes.js', likesSql());
  assert.equal((await call(h405, { method: 'GET' })).statusCode, 405);
});
