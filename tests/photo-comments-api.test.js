const test = require('node:test');
const assert = require('node:assert/strict');

const { createFakeSql, loadHandler, call } = require('./helpers/fake-api.js');

function commentRow(extra) {
  return Object.assign({
    id: 7, photo_id: 10, author_id: 1, content: '멋지다',
    created_at: new Date('2026-10-04T12:00:00Z'), updated_at: null,
  }, extra);
}

function commentsSql({ photoExists = true, travelerExists = true, existing = commentRow() } = {}) {
  return createFakeSql((text, values) => {
    if (text.startsWith('SELECT 1 FROM photos')) return { rows: photoExists ? [{}] : [] };
    if (text.startsWith('SELECT 1 FROM travelers')) return { rows: travelerExists ? [{}] : [] };
    if (text.startsWith('SELECT') && text.includes('FROM photo_comments') && text.includes('WHERE id')) {
      return { rows: existing ? [existing] : [] };
    }
    if (text.startsWith('SELECT') && text.includes('FROM photo_comments')) return { rows: [commentRow(), commentRow({ id: 8, author_id: 2, content: '좋아' })] };
    if (text.startsWith('INSERT INTO photo_comments')) return { rows: [commentRow({ content: values[2] })] };
    if (text.startsWith('UPDATE photo_comments')) return { rows: [commentRow({ content: values[0], updated_at: new Date('2026-10-04T13:00:00Z') })] };
    return { rows: [] };
  });
}

test('GET /api/photo-comments lists comments of a photo in order', async () => {
  const sql = commentsSql();
  const res = await call(loadHandler('photo-comments.js', sql), { method: 'GET', query: { photoId: '10' } });
  assert.equal(res.statusCode, 200);
  assert.deepEqual(res.body.comments.map((c) => [c.id, c.authorId, c.content]), [[7, 1, '멋지다'], [8, 2, '좋아']]);
  assert.equal(res.body.comments[0].createdAt, '2026-10-04T12:00:00.000Z');
  assert.equal(res.body.comments[0].updatedAt, null);
});

test('POST /api/photo-comments creates a comment', async () => {
  const sql = commentsSql();
  const res = await call(loadHandler('photo-comments.js', sql), {
    method: 'POST', body: { photoId: 10, travelerId: 1, content: '  노을 최고  ' },
  });
  assert.equal(res.statusCode, 201);
  assert.equal(res.body.content, '노을 최고');
});

test('POST /api/photo-comments validates content, photo and traveler', async () => {
  assert.equal((await call(loadHandler('photo-comments.js', commentsSql()), {
    method: 'POST', body: { photoId: 10, travelerId: 1, content: '   ' },
  })).statusCode, 400);
  assert.equal((await call(loadHandler('photo-comments.js', commentsSql()), {
    method: 'POST', body: { photoId: 10, travelerId: 1, content: 'x'.repeat(301) },
  })).statusCode, 400);
  assert.equal((await call(loadHandler('photo-comments.js', commentsSql({ photoExists: false })), {
    method: 'POST', body: { photoId: 10, travelerId: 1, content: 'hi' },
  })).statusCode, 404);
  assert.equal((await call(loadHandler('photo-comments.js', commentsSql({ travelerExists: false })), {
    method: 'POST', body: { photoId: 10, travelerId: 9, content: 'hi' },
  })).statusCode, 400);
});

test('PATCH /api/photo-comments lets only the author edit and marks it edited', async () => {
  const sql = commentsSql();
  const ok = await call(loadHandler('photo-comments.js', sql), {
    method: 'PATCH', query: { id: '7' }, body: { travelerId: 1, content: '수정한 댓글' },
  });
  assert.equal(ok.statusCode, 200);
  assert.equal(ok.body.content, '수정한 댓글');
  assert.equal(ok.body.updatedAt, '2026-10-04T13:00:00.000Z');
  assert.ok(sql.calls.some((c) => c.text.startsWith('UPDATE photo_comments') && /updated_at = now\(\)/.test(c.text)));

  const other = await call(loadHandler('photo-comments.js', commentsSql()), {
    method: 'PATCH', query: { id: '7' }, body: { travelerId: 2, content: '남의 댓글' },
  });
  assert.equal(other.statusCode, 403);
  const missing = await call(loadHandler('photo-comments.js', commentsSql({ existing: null })), {
    method: 'PATCH', query: { id: '7' }, body: { travelerId: 1, content: 'x' },
  });
  assert.equal(missing.statusCode, 404);
});

test('DELETE /api/photo-comments lets only the author delete', async () => {
  const sql = commentsSql();
  const ok = await call(loadHandler('photo-comments.js', sql), { method: 'DELETE', query: { id: '7', travelerId: '1' } });
  assert.equal(ok.statusCode, 200);
  assert.ok(sql.calls.some((c) => c.text.startsWith('DELETE FROM photo_comments')));
  const sql2 = commentsSql();
  const other = await call(loadHandler('photo-comments.js', sql2), { method: 'DELETE', query: { id: '7', travelerId: '2' } });
  assert.equal(other.statusCode, 403);
  assert.ok(!sql2.calls.some((c) => c.text.startsWith('DELETE')));
});
