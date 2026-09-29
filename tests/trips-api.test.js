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
    const U = 'https://abc.public.blob.vercel-storage.com/';
    const sql = sqlFor(tripRow({ role: 'admin' }), (text) => {
      if (text.startsWith('SELECT url, thumb_url FROM photos')) return { rows: [{ url: U + 'photos/1.jpg', thumb_url: U + 'photos/thumbs/1.jpg' }] };
      if (text.includes('FROM day_photos p JOIN trip_days d')) return { rows: [{ url: U + 'trips/5/preview/2.jpg', thumb_url: U + 'trips/5/preview/2-t.jpg' }, { url: 'assets/map03.png', thumb_url: 'assets/map03.png' }] };
      return null;
    });
    const res = await call(loadHandler('trips.js', sql, { '@vercel/blob': b }), { method: 'DELETE', query: { id: '5' }, headers: { cookie: cookie(3) } });
    assert.equal(res.statusCode, 200);
    assert.deepEqual(deleted, [U + 'photos/1.jpg', U + 'photos/thumbs/1.jpg', U + 'trips/5/preview/2.jpg', U + 'trips/5/preview/2-t.jpg'], '사이트 파일(assets/)은 지우지 않음');
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

// ---- 날짜별 일정 ----------------------------------------------------------------

function itinerarySql(row, extra) {
  return sqlFor(row, (text, values) => {
    if (extra) { const r = extra(text, values); if (r) return r; }
    if (text.startsWith('SELECT id FROM trip_days WHERE trip_id')) return { rows: [{ id: 70 }] };
    if (text.startsWith('SELECT COUNT(*) AS n, COALESCE(MAX(position)')) return { rows: [{ n: '2', maxpos: '4' }] };
    if (text.startsWith('SELECT title, summary, plan_mode, free_note FROM trip_days')) return { rows: [{ title: '옛 제목', summary: null, plan_mode: 'course', free_note: null }] };
    return null;
  });
}

test('일정 보기: 참여자·링크 공개는 되고, 비공개 여행의 비참여자는 403', async () => {
  await withEnv(ENV, async () => {
    const res = await call(loadHandler('trips.js', itinerarySql(tripRow()), { '@vercel/blob': blob }), { method: 'GET', query: { id: '5', part: 'itinerary' }, headers: { cookie: cookie(3) } });
    assert.equal(res.statusCode, 200);
    assert.equal(res.body.days.length, 3);
    assert.equal(res.body.canEdit, true);
    const outsider = tripRow({ traveler_id: null, role: null });
    assert.equal((await call(loadHandler('trips.js', itinerarySql(outsider), { '@vercel/blob': blob }), { method: 'GET', query: { id: '5', part: 'itinerary' }, headers: { cookie: cookie(9) } })).statusCode, 403);
    const pub = await call(loadHandler('trips.js', itinerarySql(Object.assign({}, outsider, { visibility: 'link' })), { '@vercel/blob': blob }), { method: 'GET', query: { id: '5', part: 'itinerary' } });
    assert.equal(pub.statusCode, 200);
    assert.equal(pub.body.canEdit, false);
  });
});

test('일정 고치기: 참여자 가능, "참여자 모두 수정"이 꺼지면 관리자만, 비참여자는 불가', async () => {
  await withEnv(ENV, async () => {
    const body = { kind: 'course', name: '동대만길', distanceKm: '15' };
    const sql = itinerarySql(tripRow());
    const ok = await call(loadHandler('trips.js', sql, { '@vercel/blob': blob }), { method: 'POST', query: { id: '5', part: 'item', day: '1' }, headers: { cookie: cookie(3) }, body });
    assert.equal(ok.statusCode, 201);
    const ins = sql.calls.find((c) => c.text.startsWith('INSERT INTO day_items'));
    assert.deepEqual(ins.values.slice(0, 4), [70, 'course', 5, '동대만길'], '그날 맨 뒤(순서 5)에');
    const locked = await call(loadHandler('trips.js', itinerarySql(tripRow({ members_can_edit: false })), { '@vercel/blob': blob }), { method: 'POST', query: { id: '5', part: 'item', day: '1' }, headers: { cookie: cookie(3) }, body });
    assert.equal(locked.statusCode, 403);
    assert.equal(locked.body.code, 'cannot_edit');
    const adminLocked = await call(loadHandler('trips.js', itinerarySql(tripRow({ members_can_edit: false, role: 'admin' })), { '@vercel/blob': blob }), { method: 'POST', query: { id: '5', part: 'item', day: '1' }, headers: { cookie: cookie(3) }, body });
    assert.equal(adminLocked.statusCode, 201, '관리자는 토글과 상관없이 가능');
    const outsider = await call(loadHandler('trips.js', itinerarySql(tripRow({ traveler_id: null, role: null, visibility: 'link' })), { '@vercel/blob': blob }), { method: 'POST', query: { id: '5', part: 'item', day: '1' }, headers: { cookie: cookie(9) }, body });
    assert.equal(outsider.statusCode, 403);
  });
});

test('일정 고치기: 입력 검증 · 기간 밖 날짜 · 다른 여행 항목은 404', async () => {
  await withEnv(ENV, async () => {
    const h = () => loadHandler('trips.js', itinerarySql(tripRow()), { '@vercel/blob': blob });
    const bad = await call(h(), { method: 'POST', query: { id: '5', part: 'item', day: '1' }, headers: { cookie: cookie(3) }, body: { kind: 'course', name: 'x', difficulty: 9 } });
    assert.match(bad.body.error, /1~5/);
    const out = await call(h(), { method: 'PATCH', query: { id: '5', part: 'day', day: '4' }, headers: { cookie: cookie(3) }, body: { title: 'x' } });
    assert.match(out.body.error, /기간 밖/);
    const missing = await call(h(), { method: 'DELETE', query: { id: '5', part: 'item', item: '99' }, headers: { cookie: cookie(3) } });
    assert.equal(missing.statusCode, 404);
    const sql = itinerarySql(tripRow());
    const day = await call(loadHandler('trips.js', sql, { '@vercel/blob': blob }), { method: 'PATCH', query: { id: '5', part: 'day', day: '2' }, headers: { cookie: cookie(3) }, body: { planMode: 'free', freeNote: '바다 보이면 멈추기' } });
    assert.equal(day.statusCode, 200);
    const upd = sql.calls.find((c) => c.text.startsWith('UPDATE trip_days SET'));
    assert.deepEqual(upd.values, ['옛 제목', null, 'free', '바다 보이면 멈추기', 70], '안 보낸 제목은 그대로');
  });
});

test('일정 순서 바꾸기: 같은 종류 안에서만', async () => {
  await withEnv(ENV, async () => {
    const sql = itinerarySql(tripRow(), (text) => {
      if (text.startsWith('SELECT i.* FROM day_items i JOIN trip_days d ON d.id = i.day_id WHERE i.id')) return { rows: [{ id: 4, day_id: 70, kind: 'course', position: 4 }] };
      if (text.startsWith('SELECT id, kind, timing, position FROM day_items WHERE day_id')) {
        return { rows: [{ id: 2, kind: 'move', timing: 'before', position: 2 }, { id: 3, kind: 'course', position: 3 }, { id: 4, kind: 'course', position: 4 }] };
      }
      return null;
    });
    const res = await call(loadHandler('trips.js', sql, { '@vercel/blob': blob }), { method: 'POST', query: { id: '5', part: 'item-move', item: '4' }, headers: { cookie: cookie(3) }, body: { dir: -1 } });
    assert.equal(res.statusCode, 200);
    const moves = sql.calls.filter((c) => c.text.startsWith('UPDATE day_items SET position')).map((c) => c.values);
    assert.deepEqual(moves, [[3, 4], [4, 3]]);
  });
});

// ---- 숙소 ----------------------------------------------------------------------

function lodgingSql(row, opts) {
  const o = opts || {};
  return itinerarySql(row, (text) => {
    if (text.startsWith('SELECT id FROM travelers WHERE trip_id')) return { rows: [{ id: 2 }, { id: 3 }, { id: 4 }, { id: 5 }] };
    if (text.startsWith('INSERT INTO lodgings')) return { rows: [{ id: 30, expense_id: null }] };
    if (text.startsWith('SELECT * FROM lodgings WHERE id')) return { rows: o.existing ? [o.existing] : [] };
    if (text.startsWith('SELECT id, description FROM expenses WHERE id')) return { rows: o.expense ? [o.expense] : [] };
    if (text.startsWith('INSERT INTO expenses')) return { rows: [{ id: 77 }] };
    return null;
  });
}
const lodgingBody = { name: '파도가 머무는 정원', checkIn: '2026-11-15', nights: 1, cost: 300000, guestIds: [2, 4, 5], addExpense: true, payerId: 2 };

test('숙소 추가: 숙소비 지출을 만들어 연결 (나눠 내는 사람 = 함께 묵는 사람)', async () => {
  await withEnv(ENV, async () => {
    const sql = lodgingSql(tripRow());
    const res = await call(loadHandler('trips.js', sql, { '@vercel/blob': blob }), { method: 'POST', query: { id: '5', part: 'lodging' }, headers: { cookie: cookie(3) }, body: lodgingBody });
    assert.equal(res.statusCode, 201);
    const exp = sql.calls.find((c) => c.text.startsWith('INSERT INTO expenses'));
    assert.deepEqual(exp.values, ['숙소 · 파도가 머무는 정원', 300000, 2, 5]);
    const splits = sql.calls.filter((c) => c.text.startsWith('INSERT INTO expense_splits')).map((c) => c.values[1]);
    assert.deepEqual(splits, [2, 4, 5]);
    const guests = sql.calls.filter((c) => c.text.startsWith('INSERT INTO lodging_guests')).map((c) => c.values[1]);
    assert.deepEqual(guests, [2, 4, 5]);
    assert.deepEqual(sql.calls.find((c) => c.text.startsWith('UPDATE lodgings SET expense_id')).values, [77, 30]);
  });
});

test('숙소 추가: 기간 밖 · 다른 여행 사람은 거절, 링크 구경하는 사람은 못 고침', async () => {
  await withEnv(ENV, async () => {
    const h = () => loadHandler('trips.js', lodgingSql(tripRow()), { '@vercel/blob': blob });
    const out = await call(h(), { method: 'POST', query: { id: '5', part: 'lodging' }, headers: { cookie: cookie(3) }, body: Object.assign({}, lodgingBody, { checkIn: '2026-11-20' }) });
    assert.match(out.body.error, /기간 안/);
    const stranger = await call(h(), { method: 'POST', query: { id: '5', part: 'lodging' }, headers: { cookie: cookie(3) }, body: Object.assign({}, lodgingBody, { guestIds: [2, 99] }) });
    assert.match(stranger.body.error, /이 여행에 없는/);
    const viewer = await call(loadHandler('trips.js', lodgingSql(tripRow({ traveler_id: null, role: null, visibility: 'link' })), { '@vercel/blob': blob }), { method: 'POST', query: { id: '5', part: 'lodging' }, body: lodgingBody });
    assert.equal(viewer.statusCode, 401);
  });
});

test('숙소 고치기: 연결된 지출 금액·결제자·나눠 내는 사람도 같이, 옮겨 온 설명은 그대로', async () => {
  await withEnv(ENV, async () => {
    const existing = { id: 30, trip_id: 5, expense_id: 77 };
    const sql = lodgingSql(tripRow(), { existing, expense: { id: 77, description: '숙소2_파도가 머무는 정원' } });
    const res = await call(loadHandler('trips.js', sql, { '@vercel/blob': blob }), {
      method: 'PATCH', query: { id: '5', part: 'lodging', lodging: '30' }, headers: { cookie: cookie(3) },
      body: Object.assign({}, lodgingBody, { cost: 330000, payerId: 5, guestIds: [2, 3, 4, 5] }),
    });
    assert.equal(res.statusCode, 200);
    assert.deepEqual(sql.calls.find((c) => c.text.startsWith('UPDATE expenses SET description')).values, ['숙소2_파도가 머무는 정원', 330000, 5, 77]);
    assert.deepEqual(sql.calls.filter((c) => c.text.startsWith('INSERT INTO expense_splits')).map((c) => c.values[1]), [2, 3, 4, 5]);
  });
});

test('숙소 고치기: "지출에 추가"를 끄면 연결된 지출을 지우고, 숙소를 지우면 지출도 지움', async () => {
  await withEnv(ENV, async () => {
    const existing = { id: 30, trip_id: 5, expense_id: 77 };
    const sql = lodgingSql(tripRow(), { existing, expense: { id: 77, description: '숙소 · 파도가 머무는 정원' } });
    await call(loadHandler('trips.js', sql, { '@vercel/blob': blob }), {
      method: 'PATCH', query: { id: '5', part: 'lodging', lodging: '30' }, headers: { cookie: cookie(3) }, body: Object.assign({}, lodgingBody, { addExpense: false }),
    });
    assert.deepEqual(sql.calls.find((c) => c.text.startsWith('DELETE FROM expenses')).values, [77]);
    assert.deepEqual(sql.calls.find((c) => c.text.startsWith('UPDATE lodgings SET expense_id')).values, [null, 30]);
    const sql2 = lodgingSql(tripRow(), { existing });
    const del = await call(loadHandler('trips.js', sql2, { '@vercel/blob': blob }), { method: 'DELETE', query: { id: '5', part: 'lodging', lodging: '30' }, headers: { cookie: cookie(3) } });
    assert.equal(del.statusCode, 200);
    assert.deepEqual(sql2.calls.find((c) => c.text.startsWith('DELETE FROM expenses')).values, [77, 5]);
    assert.ok(sql2.calls.some((c) => c.text.startsWith('DELETE FROM lodgings')));
  });
});

test('지출 API: 숙소와 연결된 지출은 정산 화면에서 고치거나 지울 수 없음', async () => {
  const sql = createFakeSql((text) => (text.startsWith('SELECT 1 FROM lodgings WHERE expense_id') ? { rows: [{ ok: 1 }] } : undefined));
  const res = await call(loadHandler('expenses.js', sql), { method: 'DELETE', query: { id: '77' } });
  assert.equal(res.statusCode, 409);
  assert.equal(res.body.code, 'lodging_expense');
  const res2 = await call(loadHandler('expenses.js', sql), { method: 'PATCH', query: { id: '77' }, body: { description: 'x', amount: 1, payerId: 2, participantIds: [2] } });
  assert.equal(res2.statusCode, 409);
});

// ---- 미리보기 사진 ------------------------------------------------------------------

const PV = 'https://abc.public.blob.vercel-storage.com/trips/5/preview/';
function photoSql(row, opts) {
  const o = opts || {};
  return itinerarySql(row, (text) => {
    if (text.startsWith('SELECT COUNT(*) AS n, COALESCE(MAX(position), 0) AS maxpos FROM day_photos')) return { rows: [{ n: String(o.count || 0), maxpos: String(o.count || 0) }] };
    if (text.startsWith('SELECT p.* FROM day_photos p JOIN trip_days d')) return { rows: o.photo ? [o.photo] : [] };
    if (text.startsWith('SELECT id, position FROM day_photos WHERE day_id')) return { rows: o.siblings || [] };
    return null;
  });
}

test('미리보기 사진: 등록 · 하루 10장 · 다른 여행 파일 거절 · 편집 권한', async () => {
  await withEnv(ENV, async () => {
    const body = { url: PV + '1-ab.jpg', thumbUrl: PV + '1-ab-t.jpg', width: 1600, height: 1200, caption: '창선대교' };
    const sql = photoSql(tripRow(), { count: 2 });
    const ok = await call(loadHandler('trips.js', sql, { '@vercel/blob': blob }), { method: 'POST', query: { id: '5', part: 'day-photo', day: '1' }, headers: { cookie: cookie(3) }, body });
    assert.equal(ok.statusCode, 201);
    assert.deepEqual(sql.calls.find((c) => c.text.startsWith('INSERT INTO day_photos')).values, [70, 3, PV + '1-ab.jpg', PV + '1-ab-t.jpg', '창선대교', 1600, 1200]);
    const full = await call(loadHandler('trips.js', photoSql(tripRow(), { count: 10 }), { '@vercel/blob': blob }), { method: 'POST', query: { id: '5', part: 'day-photo', day: '1' }, headers: { cookie: cookie(3) }, body });
    assert.match(full.body.error, /10장/);
    const other = await call(loadHandler('trips.js', photoSql(tripRow()), { '@vercel/blob': blob }), { method: 'POST', query: { id: '5', part: 'day-photo', day: '1' }, headers: { cookie: cookie(3) }, body: Object.assign({}, body, { url: body.url.replace('/trips/5/', '/trips/6/') }) });
    assert.match(other.body.error, /주소/);
    const locked = await call(loadHandler('trips.js', photoSql(tripRow({ members_can_edit: false })), { '@vercel/blob': blob }), { method: 'POST', query: { id: '5', part: 'day-photo', day: '1' }, headers: { cookie: cookie(3) }, body });
    assert.equal(locked.statusCode, 403);
  });
});

test('미리보기 사진: 지우면 저장소 파일도 정리 · 순서 바꾸기 · 설명 고치기', async () => {
  await withEnv(ENV, async () => {
    const deleted = [];
    const b = { del: async (urls) => { deleted.push(...urls); } };
    const photo = { id: 4, day_id: 70, url: PV + '1-ab.jpg', thumb_url: PV + '1-ab-t.jpg' };
    const del = await call(loadHandler('trips.js', photoSql(tripRow(), { photo }), { '@vercel/blob': b }), { method: 'DELETE', query: { id: '5', part: 'day-photo', photo: '4' }, headers: { cookie: cookie(3) } });
    assert.equal(del.statusCode, 200);
    assert.deepEqual(deleted, [PV + '1-ab.jpg', PV + '1-ab-t.jpg']);
    const sql = photoSql(tripRow(), { photo, siblings: [{ id: 3, position: 1 }, { id: 4, position: 2 }] });
    await call(loadHandler('trips.js', sql, { '@vercel/blob': blob }), { method: 'POST', query: { id: '5', part: 'day-photo-move', photo: '4' }, headers: { cookie: cookie(3) }, body: { dir: -1 } });
    assert.deepEqual(sql.calls.filter((c) => c.text.startsWith('UPDATE day_photos SET position')).map((c) => c.values), [[1, 4], [2, 3]]);
    const sql2 = photoSql(tripRow(), { photo });
    await call(loadHandler('trips.js', sql2, { '@vercel/blob': blob }), { method: 'PATCH', query: { id: '5', part: 'day-photo', photo: '4' }, headers: { cookie: cookie(3) }, body: { caption: ' 노을 ' } });
    assert.deepEqual(sql2.calls.find((c) => c.text.startsWith('UPDATE day_photos SET caption')).values, ['노을', 4]);
    const missing = await call(loadHandler('trips.js', photoSql(tripRow()), { '@vercel/blob': blob }), { method: 'DELETE', query: { id: '5', part: 'day-photo', photo: '99' }, headers: { cookie: cookie(3) } });
    assert.equal(missing.statusCode, 404);
  });
});

// ---- 티켓 · 예약 ----------------------------------------------------------------------

const DOC = 'https://abc.public.blob.vercel-storage.com/trips/5/docs/';
function docsSql(row, opts) {
  const o = opts || {};
  return sqlFor(row, (text) => {
    if (text.startsWith('SELECT id FROM travelers WHERE trip_id')) return { rows: [{ id: 11 }, { id: 12 }] };
    if (text.startsWith('INSERT INTO trip_docs')) return { rows: [{ id: 40 }] };
    if (text.startsWith('SELECT id, uploader_id FROM trip_docs')) return { rows: o.doc ? [o.doc] : [] };
    if (text.startsWith('SELECT url FROM trip_doc_files WHERE doc_id')) return { rows: (o.files || []).map((u) => ({ url: u })) };
    if (text.startsWith('SELECT kind, title, to_char(doc_date')) return { rows: [{ kind: 'flight', title: '옛 제목', doc_date: null, memo: null, traveler_ids: [] }] };
    return null;
  });
}
const docBody = { kind: 'flight', title: '김포 → 제주', docDate: '2026-11-14', files: [{ url: DOC + '1-ab.pdf', contentType: 'application/pdf', name: 'ticket.pdf' }] };

test('티켓: 참여자만 보고, 링크 공개 여행을 구경하는 사람은 못 봄', async () => {
  await withEnv(ENV, async () => {
    const ok = await call(loadHandler('trips.js', docsSql(tripRow()), { '@vercel/blob': blob }), { method: 'GET', query: { id: '5', part: 'docs' }, headers: { cookie: cookie(3) } });
    assert.equal(ok.statusCode, 200);
    assert.deepEqual(ok.body.me, { travelerId: 11, role: 'member' });
    const outsider = tripRow({ traveler_id: null, role: null, visibility: 'link' });
    assert.equal((await call(loadHandler('trips.js', docsSql(outsider), { '@vercel/blob': blob }), { method: 'GET', query: { id: '5', part: 'docs' } })).statusCode, 401);
    assert.equal((await call(loadHandler('trips.js', docsSql(outsider), { '@vercel/blob': blob }), { method: 'GET', query: { id: '5', part: 'docs' }, headers: { cookie: cookie(9) } })).statusCode, 403);
  });
});

test('티켓 추가: 올린 사람 = 로그인한 사람, 다른 여행 파일은 거절', async () => {
  await withEnv(ENV, async () => {
    const sql = docsSql(tripRow());
    const res = await call(loadHandler('trips.js', sql, { '@vercel/blob': blob }), { method: 'POST', query: { id: '5', part: 'doc' }, headers: { cookie: cookie(3) }, body: Object.assign({}, docBody, { uploaderId: 12 }) });
    assert.equal(res.statusCode, 201);
    assert.deepEqual(sql.calls.find((c) => c.text.startsWith('INSERT INTO trip_docs')).values, [5, 'flight', '김포 → 제주', '2026-11-14', null, [], 11]);
    assert.deepEqual(sql.calls.find((c) => c.text.startsWith('INSERT INTO trip_doc_files')).values, [40, 1, DOC + '1-ab.pdf', 'ticket.pdf', 'application/pdf', null, null, null]);
    const bad = await call(loadHandler('trips.js', docsSql(tripRow()), { '@vercel/blob': blob }), { method: 'POST', query: { id: '5', part: 'doc' }, headers: { cookie: cookie(3) }, body: Object.assign({}, docBody, { files: [{ url: DOC.replace('/trips/5/', '/trips/6/') + 'x.pdf' }] }) });
    assert.match(bad.body.error, /주소/);
  });
});

test('티켓 고치기 · 지우기: 올린 사람과 관리자만, 빠진 파일은 저장소에서도 정리', async () => {
  await withEnv(ENV, async () => {
    const other = await call(loadHandler('trips.js', docsSql(tripRow(), { doc: { id: 40, uploader_id: 12 } }), { '@vercel/blob': blob }), { method: 'DELETE', query: { id: '5', part: 'doc', doc: '40' }, headers: { cookie: cookie(3) } });
    assert.equal(other.statusCode, 403);
    const deleted = [];
    const b = { del: async (urls) => { deleted.push(...urls); } };
    const adminDel = await call(loadHandler('trips.js', docsSql(tripRow({ role: 'admin' }), { doc: { id: 40, uploader_id: 12 }, files: [DOC + 'a.pdf', DOC + 'b.jpg'] }), { '@vercel/blob': b }), { method: 'DELETE', query: { id: '5', part: 'doc', doc: '40' }, headers: { cookie: cookie(3) } });
    assert.equal(adminDel.statusCode, 200);
    assert.deepEqual(deleted, [DOC + 'a.pdf', DOC + 'b.jpg']);
    const removed = [];
    const b2 = { del: async (urls) => { removed.push(...urls); } };
    const sql = docsSql(tripRow(), { doc: { id: 40, uploader_id: 11 }, files: [DOC + 'a.pdf', DOC + 'b.jpg'] });
    const res = await call(loadHandler('trips.js', sql, { '@vercel/blob': b2 }), { method: 'PATCH', query: { id: '5', part: 'doc', doc: '40' }, headers: { cookie: cookie(3) }, body: { title: '새 제목', files: [{ url: DOC + 'a.pdf' }] } });
    assert.equal(res.statusCode, 200);
    assert.deepEqual(removed, [DOC + 'b.jpg'], '남긴 파일은 그대로, 빠진 파일만 정리');
    assert.equal(sql.calls.find((c) => c.text.startsWith('UPDATE trip_docs SET')).values[1], '새 제목');
  });
});
