const test = require('node:test');
const assert = require('node:assert/strict');
const { createFakeSql, loadHandler, call } = require('./helpers/fake-api.js');
const A = require('../api/_auth.js');

const SECRET = 'x'.repeat(40);
const ENV = { AUTH_ENABLED: '1', SESSION_SECRET: SECRET, GOOGLE_CLIENT_ID: 'g', GOOGLE_CLIENT_SECRET: 's' };
async function withEnv(env, fn) {
  const keys = Object.keys(ENV);
  const saved = {};
  keys.forEach((k) => { saved[k] = process.env[k]; delete process.env[k]; });
  Object.assign(process.env, env);
  try { return await fn(); } finally { keys.forEach((k) => { if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k]; }); }
}
const cookie = (uid) => A.SESSION_COOKIE + '=' + encodeURIComponent(A.sign({ uid, exp: Date.now() + 60000 }, SECRET));
const blob = { del: async () => {} };

function tripRow(over) {
  return Object.assign({
    id: 5, title: '제주 올레', summary: null, region: '제주', start_date: '2026-11-14', end_date: '2026-11-16',
    visibility: 'private', members_can_edit: true, cover_url: null, legacy_key: null, join_code: 'ABCD2345',
    traveler_id: 11, role: 'member', member_count: '2', photo_count: '0',
  }, over);
}
function sqlFor(row, extra) {
  return createFakeSql((text, values) => {
    if (extra) { const r = extra(text, values); if (r) return r; }
    if (text.includes('FROM trips t LEFT JOIN travelers tr')) return { rows: row ? [row] : [] };
    return { rows: [] };
  });
}

test('GET /api/trips: 로그인 전 401, 로그인하면 내가 참여한 여행만', async () => {
  await withEnv(ENV, async () => {
    assert.equal((await call(loadHandler('trips.js', sqlFor(null), { '@vercel/blob': blob }), { method: 'GET' })).statusCode, 401);
    const sql = createFakeSql((text) => (text.includes('JOIN travelers tr ON tr.trip_id = t.id AND tr.user_id') ? { rows: [tripRow()] } : { rows: [] }));
    const res = await call(loadHandler('trips.js', sql, { '@vercel/blob': blob }), { method: 'GET', headers: { cookie: cookie(3) } });
    assert.equal(res.statusCode, 200);
    assert.equal(res.body.trips[0].days, 3);
    assert.equal(res.body.trips[0].joinCode, undefined, '목록에는 참여 코드를 넣지 않음');
    assert.ok(sql.calls.some((c) => c.values.includes(3)), '로그인한 사람(3) 기준');
  });
});

test('POST /api/trips: 검증 후 만들고, 만든 사람은 관리자로 들어간다', async () => {
  await withEnv(ENV, async () => {
    const bad = await call(loadHandler('trips.js', sqlFor(null), { '@vercel/blob': blob }), {
      method: 'POST', headers: { cookie: cookie(3) }, body: { title: '제주', region: '제주', startDate: '2026-01-01', endDate: '2026-05-01' },
    });
    assert.match(bad.body.error, /최대 90일/);
    const sql = sqlFor(tripRow({ role: 'admin' }), (text) => {
      if (text.startsWith('INSERT INTO trips')) return { rows: [{ id: 5 }] };
      if (text.startsWith('SELECT name FROM users')) return { rows: [{ name: '김미솔' }] };
      return null;
    });
    const res = await call(loadHandler('trips.js', sql, { '@vercel/blob': blob }), {
      method: 'POST', headers: { cookie: cookie(3) }, body: { title: '제주 올레', region: '제주', startDate: '2026-11-14', endDate: '2026-11-16' },
    });
    assert.equal(res.statusCode, 201);
    assert.equal(res.body.trip.joinCode, 'ABCD2345');
    const me = sql.calls.find((c) => c.text.startsWith('INSERT INTO travelers'));
    assert.deepEqual(me.values, ['김미솔', 3, 5], '계정 이름으로, 관리자(admin 은 쿼리에 고정)');
    assert.match(me.text, /'admin'/);
  });
});

test('GET /api/trips?id=: 참여자는 보고, 링크 공개면 누구나, 비공개면 403 · 참여 코드는 관리자에게만', async () => {
  await withEnv(ENV, async () => {
    const mem = await call(loadHandler('trips.js', sqlFor(tripRow()), { '@vercel/blob': blob }), { method: 'GET', query: { id: '5' }, headers: { cookie: cookie(3) } });
    assert.equal(mem.statusCode, 200);
    assert.equal(mem.body.trip.joinCode, undefined);
    assert.equal(mem.body.trip.canEdit, true);
    const adm = await call(loadHandler('trips.js', sqlFor(tripRow({ role: 'admin' })), { '@vercel/blob': blob }), { method: 'GET', query: { id: '5' }, headers: { cookie: cookie(3) } });
    assert.equal(adm.body.trip.joinCode, 'ABCD2345');
    const outsider = tripRow({ traveler_id: null, role: null });
    assert.equal((await call(loadHandler('trips.js', sqlFor(outsider), { '@vercel/blob': blob }), { method: 'GET', query: { id: '5' }, headers: { cookie: cookie(9) } })).statusCode, 403);
    const pub = await call(loadHandler('trips.js', sqlFor(Object.assign(outsider, { visibility: 'link' })), { '@vercel/blob': blob }), { method: 'GET', query: { id: '5' } });
    assert.equal(pub.statusCode, 200);
    assert.equal(pub.body.trip.isMember, false);
    assert.equal(pub.body.trip.canEdit, false);
    const locked = await call(loadHandler('trips.js', sqlFor(tripRow({ members_can_edit: false })), { '@vercel/blob': blob }), { method: 'GET', query: { id: '5' }, headers: { cookie: cookie(3) } });
    assert.equal(locked.body.trip.canEdit, false, '관리자가 "참여자 모두 수정"을 끄면 참여자는 수정 불가');
  });
});

test('PATCH /api/trips: 관리자만, 기간이 줄면 범위 밖 사진 일차를 비운다', async () => {
  await withEnv(ENV, async () => {
    const member = await call(loadHandler('trips.js', sqlFor(tripRow()), { '@vercel/blob': blob }), { method: 'PATCH', query: { id: '5' }, headers: { cookie: cookie(3) }, body: { visibility: 'link' } });
    assert.equal(member.statusCode, 403);
    const sql = sqlFor(tripRow({ role: 'admin' }), (text) => (text.startsWith('UPDATE photos SET day = NULL') ? { rows: [{ id: 1 }, { id: 2 }] } : null));
    const res = await call(loadHandler('trips.js', sql, { '@vercel/blob': blob }), { method: 'PATCH', query: { id: '5' }, headers: { cookie: cookie(3) }, body: { endDate: '2026-11-14', membersCanEdit: false } });
    assert.equal(res.statusCode, 200);
    assert.equal(res.body.photosWithoutDay, 2);
    const upd = sql.calls.find((c) => c.text.startsWith('UPDATE trips SET title'));
    assert.ok(upd.values.includes('2026-11-14') && upd.values.includes(false));
    assert.deepEqual(sql.calls.find((c) => c.text.startsWith('UPDATE photos SET day = NULL')).values, [5, 1]);
  });
});

test('DELETE /api/trips: 관리자만, 사진 파일도 정리 · 나가기는 관리자 불가', async () => {
  await withEnv(ENV, async () => {
    const deleted = [];
    const b = { del: async (urls) => { deleted.push(...urls); } };
    const sql = sqlFor(tripRow({ role: 'admin' }), (text) => (text.startsWith('SELECT url, thumb_url FROM photos') ? { rows: [{ url: 'u1', thumb_url: 't1' }] } : null));
    const res = await call(loadHandler('trips.js', sql, { '@vercel/blob': b }), { method: 'DELETE', query: { id: '5' }, headers: { cookie: cookie(3) } });
    assert.equal(res.statusCode, 200);
    assert.deepEqual(deleted, ['u1', 't1']);
    assert.ok(sql.calls.some((c) => c.text.startsWith('DELETE FROM trips')));
    const leaveAdmin = await call(loadHandler('trips.js', sqlFor(tripRow({ role: 'admin' })), { '@vercel/blob': blob }), { method: 'POST', query: { id: '5', part: 'leave' }, headers: { cookie: cookie(3) } });
    assert.equal(leaveAdmin.statusCode, 409);
    const sql2 = sqlFor(tripRow());
    const leave = await call(loadHandler('trips.js', sql2, { '@vercel/blob': blob }), { method: 'POST', query: { id: '5', part: 'leave' }, headers: { cookie: cookie(3) } });
    assert.equal(leave.statusCode, 200);
    assert.deepEqual(sql2.calls.find((c) => c.text.startsWith('UPDATE travelers SET user_id = NULL')).values, [11, 5]);
  });
});

test('withMember: 링크 공개 여행은 로그인 없이 사진 목록을 읽을 수 있지만 정산은 못 본다', async () => {
  await withEnv(ENV, async () => {
    const pubTrip = { id: 5, title: '제주', summary: null, region: '제주', start_date: '2026-11-14', end_date: '2026-11-16', visibility: 'link', members_can_edit: true, cover_url: null, legacy_key: null, join_code: 'X' };
    const mk = () => createFakeSql((text) => (text.includes('FROM trips WHERE id =') ? { rows: [pubTrip] } : { rows: [] }));
    const photos = await call(loadHandler('photos.js', mk(), { '@vercel/blob': blob }), { method: 'GET', query: { trip: '5' } });
    assert.equal(photos.statusCode, 200);
    assert.equal(photos.body.me, null);
    const state = await call(loadHandler('state.js', mk()), { method: 'GET', query: { trip: '5' } });
    assert.equal(state.statusCode, 401, '정산·준비물은 참여자만');
    const like = await call(loadHandler('photo-likes.js', mk()), { method: 'POST', query: { trip: '5' }, body: { photoId: 1 } });
    assert.equal(like.statusCode, 401, '좋아요도 참여자만');
  });
});
