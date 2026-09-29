const test = require('node:test');
const assert = require('node:assert/strict');
const { createFakeSql, loadHandler, call } = require('./helpers/fake-api.js');

function sqlWithUsage(paid, shared) {
  return createFakeSql((text) => {
    if (text.includes('FROM expenses WHERE payer_id')) return { rows: [{ paid: String(paid), shared: String(shared) }] };
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
