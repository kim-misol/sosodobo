const test = require('node:test');
const assert = require('node:assert/strict');
const { createFakeSql, loadHandler, call } = require('./helpers/fake-api.js');

function sqlWithUsage(paid, shared) {
  return createFakeSql((text) => {
    if (text.includes('FROM expenses WHERE payer_id')) return { rows: [{ paid: String(paid), shared: String(shared) }] };
    if (text.startsWith('SELECT user_id, role FROM travelers WHERE id =')) return { rows: [{ user_id: null, role: 'member' }] };
    return { rows: [] };
  });
}

test('DELETE /api/travelers: 지출 기록에 들어 있는 여행자는 409 로 막는다', async () => {
  const sql = sqlWithUsage(13, 17);
  const res = await call(loadHandler('travelers.js', sql), { method: 'DELETE', query: { id: '2' } });
  assert.equal(res.statusCode, 409);
  assert.match(res.body.error, /결제 13건 · 나눠 냄 17건/);
  assert.ok(!sql.calls.some((c) => c.text.startsWith('DELETE FROM travelers')), '삭제하지 않음');
});

test('DELETE /api/travelers: 지출 기록이 없으면 삭제한다', async () => {
  const sql = sqlWithUsage(0, 0);
  const res = await call(loadHandler('travelers.js', sql), { method: 'DELETE', query: { id: '9' } });
  assert.equal(res.statusCode, 200);
  assert.ok(sql.calls.some((c) => c.text.startsWith('DELETE FROM travelers')));
});

test('DELETE /api/travelers: 다른 여행 사람은 404, 삭제는 이 여행 안에서만', async () => {
  const none = createFakeSql(() => ({ rows: [] }));
  const res = await call(loadHandler('travelers.js', none), { method: 'DELETE', query: { id: '9', trip: '2' } });
  assert.equal(res.statusCode, 404);
  const sql = sqlWithUsage(0, 0);
  await call(loadHandler('travelers.js', sql), { method: 'DELETE', query: { id: '9' } });
  const del = sql.calls.find((c) => c.text.startsWith('DELETE FROM travelers'));
  assert.deepEqual(del.values, [9, 1], '기본 여행(1) 안의 9번만');
});

test('POST /api/travelers: 새 사람은 지금 여행에 들어간다', async () => {
  const sql = createFakeSql((text) => (text.startsWith('INSERT INTO travelers') ? { rows: [{ id: 5, name: '수진' }] } : undefined));
  const res = await call(loadHandler('travelers.js', sql), { method: 'POST', body: { name: '수진' } });
  assert.equal(res.statusCode, 201);
  assert.deepEqual(sql.calls.find((c) => c.text.startsWith('INSERT INTO travelers')).values, ['수진', 1]);
});
