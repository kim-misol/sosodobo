const test = require('node:test');
const assert = require('node:assert/strict');
const { createFakeSql, loadHandler, call } = require('./helpers/fake-api.js');

const A = require('../api/_auth.js');

const SECRET = 'x'.repeat(40);
const ENV = {
  AUTH_ENABLED: '1', SESSION_SECRET: SECRET, TRIP_JOIN_CODE: 'Namhae2026',
  GOOGLE_CLIENT_ID: 'gid', GOOGLE_CLIENT_SECRET: 'gsecret', KAKAO_REST_API_KEY: 'kkey',
};

/** process.env 를 잠시 바꿔 fn 실행 */
async function withEnv(env, fn) {
  const keys = Object.keys(ENV).concat(['PUBLIC_BASE_URL']);
  const saved = {};
  keys.forEach((k) => { saved[k] = process.env[k]; delete process.env[k]; });
  Object.assign(process.env, env);
  try { return await fn(); } finally {
    keys.forEach((k) => { if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k]; });
  }
}

function sessionCookie(uid, secret = SECRET, exp = Date.now() + 60000) {
  return A.SESSION_COOKIE + '=' + encodeURIComponent(A.sign({ uid, exp }, secret));
}

function cookiesFrom(res) {
  const raw = res.headers['Set-Cookie'];
  return (Array.isArray(raw) ? raw : raw ? [raw] : []).map((c) => c.split(';')[0]).join('; ');
}

// ---- 서명 · 설정 ---------------------------------------------------------------

test('sign/verify: 서명이 맞고 안 지났을 때만 통과', () => {
  const t = A.sign({ uid: 7, exp: 2000 }, SECRET);
  assert.deepEqual(A.verify(t, SECRET, 1000), { uid: 7, exp: 2000 });
  assert.equal(A.verify(t, SECRET, 3000), null, '만료');
  assert.equal(A.verify(t, 'y'.repeat(40), 1000), null, '다른 비밀값');
  const [body, sig] = t.split('.');
  const forged = A.b64url(JSON.stringify({ uid: 1, exp: 2000 })) + '.' + sig;
  assert.equal(A.verify(forged, SECRET, 1000), null, '내용 바꿔치기');
  assert.equal(A.verify(body, SECRET, 1000), null);
  assert.equal(A.verify('', SECRET, 1000), null);
});

test('authConfig: 스위치와 필수 값이 모두 있어야 켜진다', () => {
  assert.equal(A.authConfig(ENV).enabled, true);
  assert.equal(A.authConfig(Object.assign({}, ENV, { AUTH_ENABLED: '' })).enabled, false, '스위치 꺼짐');
  assert.equal(A.authConfig(Object.assign({}, ENV, { SESSION_SECRET: 'short' })).enabled, false, '비밀값이 짧음');
  assert.equal(A.authConfig(Object.assign({}, ENV, { TRIP_JOIN_CODE: '' })).enabled, false, '참여 코드 없음');
  const onlyKakao = Object.assign({}, ENV, { GOOGLE_CLIENT_ID: '', GOOGLE_CLIENT_SECRET: '' });
  assert.deepEqual(A.authConfig(onlyKakao).providers, { google: false, kakao: true });
  assert.equal(A.authConfig(onlyKakao).enabled, true);
});

test('checkJoinCode: 앞뒤 공백·대소문자 무시, 코드가 없으면 항상 실패', () => {
  assert.equal(A.checkJoinCode(' namhae2026 ', ENV), true);
  assert.equal(A.checkJoinCode('namhae', ENV), false);
  assert.equal(A.checkJoinCode('', Object.assign({}, ENV, { TRIP_JOIN_CODE: '' })), false);
});

// ---- API 보호 -------------------------------------------------------------------

function memberSql(row) {
  return createFakeSql((text) => (text.includes('FROM users u LEFT JOIN travelers') ? { rows: row ? [row] : [] } : { rows: [] }));
}

test('findMember: 로그인 안 함 401, 참여 안 함 403, 참여자는 여행자 id', async () => {
  const req = (cookie) => ({ headers: cookie ? { cookie } : {} });
  assert.equal((await A.findMember(req(), memberSql(null), ENV)).status, 401);
  assert.equal((await A.findMember(req(sessionCookie(3)), memberSql({ user_id: 3, traveler_id: null }), ENV)).code, 'join_required');
  const ok = await A.findMember(req(sessionCookie(3)), memberSql({ user_id: 3, traveler_id: 5, traveler_name: '미솔' }), ENV);
  assert.deepEqual(ok, { ok: true, userId: 3, travelerId: 5, travelerName: '미솔' });
  assert.equal((await A.findMember(req(sessionCookie(3, 'y'.repeat(40))), memberSql({ user_id: 3, traveler_id: 5 }), ENV)).status, 401, '위조 쿠키');
});

test('withMember: 로그인이 켜지면 요청의 travelerId 를 로그인한 사람으로 바꾼다', async () => {
  await withEnv(ENV, async () => {
    const sql = createFakeSql((text) => {
      if (text.includes('FROM users u LEFT JOIN travelers')) return { rows: [{ user_id: 3, traveler_id: 5, traveler_name: '미솔' }] };
      if (text.startsWith('SELECT 1 FROM travelers') || text.startsWith('SELECT 1 FROM photos')) return { rows: [{ ok: 1 }] };
      if (text.startsWith('INSERT INTO photo_likes')) return { rows: [] };
      if (text.includes('FROM photo_likes')) return { rows: [{ like_count: '1', liked_by: [5] }] };
      return { rows: [] };
    });
    const handler = loadHandler('photo-likes.js', sql);
    const anon = await call(handler, { method: 'POST', body: { photoId: 1, travelerId: 2 } });
    assert.equal(anon.statusCode, 401);
    assert.equal(anon.body.code, 'login_required');
    const res = await call(handler, { method: 'POST', body: { photoId: 1, travelerId: 2 }, headers: { cookie: sessionCookie(3) } });
    assert.equal(res.statusCode, 200);
    const insert = sql.calls.find((c) => c.text.startsWith('INSERT INTO photo_likes'));
    assert.deepEqual(insert.values, [1, 5], '다른 사람(2)이 아니라 로그인한 미솔(5)로 저장');
  });
});

test('withMember: 로그인이 꺼져 있으면 지금처럼 그대로 통과', async () => {
  await withEnv({}, async () => {
    const sql = createFakeSql((text) => (text.startsWith('SELECT') ? { rows: [] } : { rows: [] }));
    const res = await call(loadHandler('state.js', sql), { method: 'GET' });
    assert.notEqual(res.statusCode, 401);
  });
});

// ---- /api/auth ---------------------------------------------------------------------

test('GET /api/auth?action=me: 꺼져 있으면 enabled:false, 켜져 있고 로그인 전이면 user:null', async () => {
  await withEnv({}, async () => {
    const res = await call(loadHandler('auth.js', createFakeSql()), { query: { action: 'me' } });
    assert.deepEqual(res.body, { enabled: false });
  });
  await withEnv(ENV, async () => {
    const res = await call(loadHandler('auth.js', createFakeSql()), { query: { action: 'me' } });
    assert.equal(res.body.enabled, true);
    assert.equal(res.body.user, null);
    assert.deepEqual(res.body.providers, { google: true, kakao: true });
  });
});

test('로그인 → 콜백: 새 계정을 만들고 세션 쿠키를 준다 (Google)', async () => {
  await withEnv(Object.assign({}, ENV, { PUBLIC_BASE_URL: 'https://sosodobo.vercel.app' }), async () => {
    const start = await call(loadHandler('auth.js', createFakeSql()), { query: { action: 'login', provider: 'google' } });
    assert.equal(start.statusCode, 302);
    const loc = new URL(start.headers.Location);
    assert.equal(loc.origin + loc.pathname, 'https://accounts.google.com/o/oauth2/v2/auth');
    assert.equal(loc.searchParams.get('redirect_uri'), 'https://sosodobo.vercel.app/api/auth/google/callback');
    assert.equal(loc.searchParams.get('client_id'), 'gid');
    const state = loc.searchParams.get('state');
    const stateCookie = cookiesFrom(start);

    const realFetch = global.fetch;
    global.fetch = async (url, opts) => {
      if (String(url).includes('oauth2.googleapis.com/token')) {
        assert.match(opts.body, /code=abc/);
        return new Response(JSON.stringify({ access_token: 'tok' }), { status: 200 });
      }
      return new Response(JSON.stringify({ sub: 'g-123', email: 'a@example.com', name: '미솔', picture: null }), { status: 200 });
    };
    try {
      const sql = createFakeSql((text) => {
        if (text.startsWith('SELECT user_id FROM user_identities')) return { rows: [] };
        if (text.startsWith('INSERT INTO users')) return { rows: [{ id: 42 }] };
        return { rows: [] };
      });
      const done = await call(loadHandler('auth.js', sql), {
        query: { action: 'callback', provider: 'google', code: 'abc', state },
        headers: { cookie: stateCookie },
      });
      assert.equal(done.statusCode, 302);
      assert.equal(done.headers.Location, '/');
      assert.ok(sql.calls.some((c) => c.text.startsWith('INSERT INTO user_identities') && c.values.includes('g-123') && c.values.includes(42)));
      const session = cookiesFrom(done).split('; ').find((c) => c.startsWith(A.SESSION_COOKIE + '=') && c.length > A.SESSION_COOKIE.length + 1);
      assert.equal(A.sessionUserId({ headers: { cookie: session } }, ENV), 42);
    } finally {
      global.fetch = realFetch;
    }
  });
});

test('콜백: state 가 다르면 로그인하지 않고 돌려보낸다', async () => {
  await withEnv(ENV, async () => {
    const start = await call(loadHandler('auth.js', createFakeSql()), { query: { action: 'login', provider: 'kakao' }, headers: { host: 'sosodobo.vercel.app' } });
    assert.match(start.headers.Location, /^https:\/\/kauth\.kakao\.com\/oauth\/authorize\?/);
    assert.match(start.headers.Location, /redirect_uri=https%3A%2F%2Fsosodobo\.vercel\.app%2Fapi%2Fauth%2Fkakao%2Fcallback/);
    const sql = createFakeSql();
    const res = await call(loadHandler('auth.js', sql), {
      query: { action: 'callback', provider: 'kakao', code: 'abc', state: 'wrong' },
      headers: { cookie: cookiesFrom(start) },
    });
    assert.equal(res.headers.Location, '/?login=expired');
    assert.equal(sql.calls.length, 0);
  });
});

function joinSql({ mine = [], free = [{ id: 3, name: '기아' }], claim = true } = {}) {
  return createFakeSql((text) => {
    if (text.startsWith('SELECT id, name FROM travelers WHERE user_id =')) return { rows: mine };
    if (text.startsWith('SELECT id, name FROM travelers WHERE user_id IS NULL')) return { rows: free };
    if (text.startsWith('UPDATE travelers SET user_id')) return { rows: claim ? [{ id: 3, name: '기아' }] : [] };
    if (text.startsWith('INSERT INTO travelers')) return { rows: [{ id: 9, name: '수진' }] };
    return { rows: [] };
  });
}

test('여행 참여: 코드가 맞아야 목록을 보여 주고, 비어 있는 사람만 고를 수 있다', async () => {
  await withEnv(ENV, async () => {
    const cookie = sessionCookie(42);
    const bad = await call(loadHandler('auth.js', joinSql()), { method: 'POST', query: { action: 'join-options' }, body: { code: 'nope' }, headers: { cookie } });
    assert.equal(bad.statusCode, 403);
    assert.equal(bad.body.code, 'bad_code');
    const anon = await call(loadHandler('auth.js', joinSql()), { method: 'POST', query: { action: 'join-options' }, body: { code: 'namhae2026' } });
    assert.equal(anon.statusCode, 401);
    const opts = await call(loadHandler('auth.js', joinSql()), { method: 'POST', query: { action: 'join-options' }, body: { code: 'namhae2026' }, headers: { cookie } });
    assert.deepEqual(opts.body, { travelers: [{ id: 3, name: '기아' }] });

    const sql = joinSql();
    const ok = await call(loadHandler('auth.js', sql), { method: 'POST', query: { action: 'join' }, body: { code: 'namhae2026', travelerId: 3 }, headers: { cookie } });
    assert.deepEqual(ok.body, { traveler: { id: 3, name: '기아' } });
    assert.ok(sql.calls.some((c) => c.text.includes('WHERE id = $ AND user_id IS NULL') && c.values[0] === 42 && c.values[1] === 3));

    const taken = await call(loadHandler('auth.js', joinSql({ claim: false })), { method: 'POST', query: { action: 'join' }, body: { code: 'namhae2026', travelerId: 3 }, headers: { cookie } });
    assert.equal(taken.statusCode, 409);

    const fresh = await call(loadHandler('auth.js', joinSql()), { method: 'POST', query: { action: 'join' }, body: { code: 'namhae2026', name: ' 수진 ' }, headers: { cookie } });
    assert.equal(fresh.statusCode, 201);
    assert.deepEqual(fresh.body, { traveler: { id: 9, name: '수진' } });
  });
});
