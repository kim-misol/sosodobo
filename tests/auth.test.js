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
  const keys = Object.keys(ENV).concat(['PUBLIC_BASE_URL', 'APPLE_TEAM_ID', 'APPLE_KEY_ID', 'APPLE_CLIENT_ID', 'APPLE_PRIVATE_KEY']);
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
  assert.equal(A.authConfig(Object.assign({}, ENV, { TRIP_JOIN_CODE: '' })).enabled, true, '참여 코드는 여행마다 DB 에 있어 환경변수는 선택');
  const onlyKakao = Object.assign({}, ENV, { GOOGLE_CLIENT_ID: '', GOOGLE_CLIENT_SECRET: '' });
  assert.deepEqual(A.authConfig(onlyKakao).providers, { google: false, kakao: true, apple: false });
  assert.equal(A.authConfig(onlyKakao).enabled, true);
});

test('checkJoinCode: 앞뒤 공백·대소문자 무시, 기대 코드가 없으면 항상 실패', () => {
  assert.equal(A.checkJoinCode(' namhae2026 ', 'Namhae2026'), true);
  assert.equal(A.checkJoinCode('namhae', 'Namhae2026'), false);
  assert.equal(A.checkJoinCode('', ''), false);
});

// ---- API 보호 -------------------------------------------------------------------

function memberSql(row) {
  return createFakeSql((text) => (text.includes('FROM users u LEFT JOIN travelers') ? { rows: row ? [row] : [] } : { rows: [] }));
}

test('findMember: 로그인 안 함 401, 이 여행에 참여 안 함 403, 참여자는 여행자 id · 역할', async () => {
  const req = (cookie) => ({ headers: cookie ? { cookie } : {} });
  assert.equal((await A.findMember(req(), memberSql(null), ENV, 1)).status, 401);
  assert.equal((await A.findMember(req(sessionCookie(3)), memberSql({ user_id: 3, traveler_id: null }), ENV, 1)).code, 'join_required');
  const sql = memberSql({ user_id: 3, traveler_id: 5, traveler_name: '미솔', role: 'admin' });
  const ok = await A.findMember(req(sessionCookie(3)), sql, ENV, 7);
  assert.deepEqual(ok, { ok: true, userId: 3, travelerId: 5, travelerName: '미솔', role: 'admin' });
  assert.deepEqual(sql.calls[0].values, [7, 3], '그 여행(7)에서의 참여만 찾음');
  assert.equal((await A.findMember(req(sessionCookie(3, 'y'.repeat(40))), memberSql({ user_id: 3, traveler_id: 5 }), ENV, 1)).status, 401, '위조 쿠키');
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
    assert.deepEqual(res.body.providers, { google: true, kakao: true, apple: false });
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

function joinSql({ mine = [], free = [{ id: 3, name: '기아' }], claim = true, hasAdmin = true } = {}) {
  return createFakeSql((text) => {
    if (text.includes('FROM trips WHERE lower(join_code) = lower(')) {
      return { rows: [{ id: 7, title: '남해 바래길', join_code: 'Namhae2026', start_date: '2026-09-24', end_date: '2026-09-26' }] };
    }
    if (text.startsWith('SELECT id, name FROM travelers WHERE user_id =')) return { rows: mine };
    if (text.startsWith('SELECT id, name FROM travelers WHERE trip_id =')) return { rows: free };
    if (text.startsWith("SELECT 1 FROM travelers WHERE trip_id = $ AND role = 'admin'")) return { rows: hasAdmin ? [{ ok: 1 }] : [] };
    if (text.startsWith('UPDATE travelers SET user_id')) return { rows: claim ? [{ id: 3, name: '기아' }] : [] };
    if (text.startsWith('INSERT INTO travelers')) return { rows: [{ id: 9, name: '수진' }] };
    return { rows: [] };
  });
}

const TRIP_OUT = { id: 7, title: '남해 바래길', startDate: '2026-09-24', endDate: '2026-09-26' };

test('여행 참여: 코드가 가리키는 여행에서, 비어 있는 사람만 고를 수 있다', async () => {
  await withEnv(ENV, async () => {
    const cookie = sessionCookie(42);
    const bad = await call(loadHandler('auth.js', createFakeSql()), { method: 'POST', query: { action: 'join-options' }, body: { code: 'nope' }, headers: { cookie } });
    assert.equal(bad.statusCode, 403);
    assert.equal(bad.body.code, 'bad_code');
    const anon = await call(loadHandler('auth.js', joinSql()), { method: 'POST', query: { action: 'join-options' }, body: { code: 'namhae2026' } });
    assert.equal(anon.statusCode, 401);
    const opts = await call(loadHandler('auth.js', joinSql()), { method: 'POST', query: { action: 'join-options' }, body: { code: 'namhae2026' }, headers: { cookie } });
    assert.deepEqual(opts.body, { trip: TRIP_OUT, travelers: [{ id: 3, name: '기아' }] });

    const sql = joinSql();
    const ok = await call(loadHandler('auth.js', sql), { method: 'POST', query: { action: 'join' }, body: { code: 'namhae2026', travelerId: 3 }, headers: { cookie } });
    assert.deepEqual(ok.body, { trip: TRIP_OUT, traveler: { id: 3, name: '기아' } });
    const claim = sql.calls.find((c) => c.text.startsWith('UPDATE travelers SET user_id'));
    assert.deepEqual(claim.values, [42, 'member', 3, 7], '그 여행(7)의 3번 사람을, 관리자가 이미 있으니 일반 참여자로');

    const taken = await call(loadHandler('auth.js', joinSql({ claim: false })), { method: 'POST', query: { action: 'join' }, body: { code: 'namhae2026', travelerId: 3 }, headers: { cookie } });
    assert.equal(taken.statusCode, 409);

    const sql2 = joinSql({ hasAdmin: false });
    const fresh = await call(loadHandler('auth.js', sql2), { method: 'POST', query: { action: 'join' }, body: { code: 'namhae2026', name: ' 수진 ' }, headers: { cookie } });
    assert.equal(fresh.statusCode, 201);
    assert.deepEqual(fresh.body, { trip: TRIP_OUT, traveler: { id: 9, name: '수진' } });
    assert.deepEqual(sql2.calls.find((c) => c.text.startsWith('INSERT INTO travelers')).values, ['수진', 42, 7, 'admin'], '관리자가 없던 여행이면 관리자로');
  });
});

// ---- iOS 앱 로그인 · 계정 삭제 ---------------------------------------------------

test('앱 로그인: 콜백은 sosodobo://auth?code= 로, 코드는 한 번만 로그인 쿠키로 바뀐다', async () => {
  await withEnv(Object.assign({}, ENV, { PUBLIC_BASE_URL: 'https://sosodobo.vercel.app' }), async () => {
    const start = await call(loadHandler('auth.js', createFakeSql()), { query: { action: 'login', provider: 'google', app: '1' } });
    const state = new URL(start.headers.Location).searchParams.get('state');
    const realFetch = global.fetch;
    global.fetch = async (url) => (String(url).includes('token')
      ? new Response(JSON.stringify({ access_token: 'tok' }), { status: 200 })
      : new Response(JSON.stringify({ sub: 'g-9', email: 'b@example.com', name: '앱', picture: null }), { status: 200 }));
    let code;
    try {
      const sql = createFakeSql((text) => (text.startsWith('SELECT user_id FROM user_identities') ? { rows: [{ user_id: 77 }] } : { rows: [] }));
      const done = await call(loadHandler('auth.js', sql), {
        query: { action: 'callback', provider: 'google', code: 'abc', state }, headers: { cookie: cookiesFrom(start) },
      });
      assert.match(done.headers.Location, /^sosodobo:\/\/auth\?code=/);
      assert.ok(!cookiesFrom(done).includes(A.SESSION_COOKIE + '=e'), '시스템 로그인 창에는 세션을 주지 않음');
      code = decodeURIComponent(done.headers.Location.split('code=')[1]);
    } finally {
      global.fetch = realFetch;
    }
    const usedKeys = new Set();
    const sql2 = createFakeSql((text, values) => {
      if (text.startsWith('INSERT INTO app_meta')) {
        if (usedKeys.has(values[0])) return { rows: [] };
        usedKeys.add(values[0]);
        return { rows: [{ key: values[0] }] };
      }
      return { rows: [] };
    });
    const ex = await call(loadHandler('auth.js', sql2), { query: { action: 'app-exchange', code } });
    assert.equal(ex.headers.Location, '/');
    const session = cookiesFrom(ex).split('; ').find((c) => c.startsWith(A.SESSION_COOKIE + '='));
    assert.equal(A.sessionUserId({ headers: { cookie: session } }, ENV), 77);
    const again = await call(loadHandler('auth.js', sql2), { query: { action: 'app-exchange', code } });
    assert.equal(again.headers.Location, '/?login=expired', '같은 코드는 두 번 못 씀');
    const fake = await call(loadHandler('auth.js', sql2), { query: { action: 'app-exchange', code: A.sign({ uid: 1, purpose: 'link', n: 'x', exp: Date.now() + 9999 }, SECRET) } });
    assert.equal(fake.headers.Location, '/?login=expired', '다른 용도의 표는 안 됨');
  });
});

test('앱 로그인: 이어 붙이기 표(ticket)로 지금 계정에 연결', async () => {
  await withEnv(ENV, async () => {
    const t = await call(loadHandler('auth.js', createFakeSql()), { method: 'POST', query: { action: 'app-link-ticket' }, headers: { cookie: sessionCookie(5) } });
    assert.equal(t.statusCode, 200);
    const start = await call(loadHandler('auth.js', createFakeSql()), { query: { action: 'login', provider: 'kakao', app: '1', ticket: t.body.ticket } });
    const st = A.readOAuthState({ headers: { cookie: cookiesFrom(start) } }, ENV);
    assert.equal(st.link, 5);
    assert.equal(st.app, true);
    const noLogin = await call(loadHandler('auth.js', createFakeSql()), { method: 'POST', query: { action: 'app-link-ticket' } });
    assert.equal(noLogin.statusCode, 401);
  });
});

test('계정 삭제: "삭제" 확인, 관리자는 다른 참여자에게 넘기고 계정을 지운다', async () => {
  await withEnv(ENV, async () => {
    const no = await call(loadHandler('auth.js', createFakeSql()), { method: 'POST', query: { action: 'delete-account' }, headers: { cookie: sessionCookie(5) }, body: {} });
    assert.equal(no.statusCode, 400);
    const sql = createFakeSql((text) => {
      if (text.startsWith('SELECT id, trip_id, role FROM travelers')) return { rows: [{ id: 11, trip_id: 3, role: 'admin' }, { id: 12, trip_id: 4, role: 'member' }] };
      if (text.startsWith('DELETE FROM photos')) return { rows: [{ url: 'https://a.public.blob.vercel-storage.com/photos/x.jpg', thumb_url: null }] };
      return { rows: [] };
    });
    const res = await call(loadHandler('auth.js', sql, { '@vercel/blob': { del: async () => {} } }), {
      method: 'POST', query: { action: 'delete-account' }, headers: { cookie: sessionCookie(5) }, body: { confirm: '삭제', deletePhotos: true },
    });
    assert.equal(res.statusCode, 200);
    assert.equal(res.body.removedPhotos, 1);
    const promote = sql.calls.find((c) => c.text.startsWith("UPDATE travelers SET role = 'admin'"));
    assert.deepEqual(promote.values, [3, 5], '여행 3 에서 나(5) 말고 다른 계정에게');
    assert.ok(sql.calls.some((c) => c.text.startsWith('DELETE FROM users') && c.values[0] === 5));
    assert.ok(cookiesFrom(res).includes(A.SESSION_COOKIE + '='), '로그아웃 쿠키');
  });
});

// ---- Apple 로그인 ---------------------------------------------------------------

const crypto = require('node:crypto');
const O = require('../api/_oauth.js');

function appleEnv() {
  const { privateKey, publicKey } = crypto.generateKeyPairSync('ec', { namedCurve: 'P-256' });
  return {
    env: Object.assign({}, ENV, {
      PUBLIC_BASE_URL: 'https://sosodobo.vercel.app',
      APPLE_TEAM_ID: 'TEAM123456', APPLE_KEY_ID: 'KEY1234567', APPLE_CLIENT_ID: 'com.sosodobo.web',
      APPLE_PRIVATE_KEY: privateKey.export({ type: 'pkcs8', format: 'pem' }).replace(/\n/g, '\\n'), // Vercel 에 \n 글자로 들어온 경우
    }),
    publicKey,
  };
}
const jwtPart = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');

test('Apple client_secret: .p8 키로 서명한 ES256 JWT (팀 · 키 · 서비스 ID)', () => {
  const { env, publicKey } = appleEnv();
  const t = O.appleClientSecret(env, Date.parse('2026-10-01T00:00:00Z'));
  const [h, p, s] = t.split('.');
  assert.deepEqual(JSON.parse(Buffer.from(h, 'base64url')), { alg: 'ES256', kid: 'KEY1234567' });
  const claims = JSON.parse(Buffer.from(p, 'base64url'));
  assert.equal(claims.iss, 'TEAM123456');
  assert.equal(claims.sub, 'com.sosodobo.web');
  assert.equal(claims.aud, 'https://appleid.apple.com');
  assert.ok(crypto.verify('sha256', Buffer.from(h + '.' + p), { key: publicKey, dsaEncoding: 'ieee-p1363' }, Buffer.from(s, 'base64url')));
});

test('Apple 로그인: form_post 로 시작, state 쿠키는 SameSite=None, POST 콜백으로 계정 만들기 (이름은 첫 로그인 때만)', async () => {
  const { env } = appleEnv();
  await withEnv(env, async () => {
    const me = await call(loadHandler('auth.js', createFakeSql()), { query: { action: 'me' } });
    assert.equal(me.body.providers.apple, true);
    const start = await call(loadHandler('auth.js', createFakeSql()), { query: { action: 'login', provider: 'apple' } });
    const loc = new URL(start.headers.Location);
    assert.equal(loc.origin + loc.pathname, 'https://appleid.apple.com/auth/authorize');
    assert.equal(loc.searchParams.get('response_mode'), 'form_post');
    assert.equal(loc.searchParams.get('scope'), 'name email');
    assert.equal(loc.searchParams.get('redirect_uri'), 'https://sosodobo.vercel.app/api/auth/apple/callback');
    const setCookie = [].concat(start.headers['Set-Cookie']).join(' ');
    assert.match(setCookie, /SameSite=None/);
    assert.match(setCookie, /Secure/);
    const state = loc.searchParams.get('state');

    const realFetch = global.fetch;
    global.fetch = async (url, opts) => {
      assert.match(String(url), /appleid\.apple\.com\/auth\/token/);
      assert.match(opts.body, /client_secret=ey/);
      const idToken = jwtPart({ alg: 'RS256' }) + '.' + jwtPart({ iss: 'https://appleid.apple.com', aud: 'com.sosodobo.web', sub: 'apple-001', email: 'x@privaterelay.appleid.com' }) + '.sig';
      return new Response(JSON.stringify({ id_token: idToken, access_token: 'a' }), { status: 200 });
    };
    try {
      const sql = createFakeSql((text) => {
        if (text.startsWith('SELECT user_id FROM user_identities')) return { rows: [] };
        if (text.startsWith('INSERT INTO users')) return { rows: [{ id: 55 }] };
        return { rows: [] };
      });
      const done = await call(loadHandler('auth.js', sql), {
        method: 'POST',
        query: { action: 'callback', provider: 'apple' },
        headers: { cookie: cookiesFrom(start) },
        body: 'code=c1&state=' + encodeURIComponent(state) + '&user=' + encodeURIComponent(JSON.stringify({ name: { firstName: '미솔', lastName: '김' } })),
      });
      assert.equal(done.headers.Location, '/');
      const ins = sql.calls.find((c) => c.text.startsWith('INSERT INTO users'));
      assert.ok(ins.values.includes('김미솔'), '성+이름');
      assert.ok(sql.calls.some((c) => c.text.startsWith('INSERT INTO user_identities') && c.values.includes('apple-001')));
    } finally {
      global.fetch = realFetch;
    }
  });
});

test('Apple 서버 알림: 서명이 맞는 연결 끊기 알림이면 Apple 연결을 지우고, 다른 로그인이 없으면 계정도 지운다', async () => {
  const { env } = appleEnv();
  const { privateKey, publicKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
  const jwk = Object.assign(publicKey.export({ format: 'jwk' }), { kid: 'k1', alg: 'RS256' });
  const sign = (claims) => {
    const h = jwtPart({ alg: 'RS256', kid: 'k1' });
    const p = jwtPart(claims);
    return h + '.' + p + '.' + crypto.sign('RSA-SHA256', Buffer.from(h + '.' + p), privateKey).toString('base64url');
  };
  await withEnv(env, async () => {
    const realFetch = global.fetch;
    global.fetch = async () => new Response(JSON.stringify({ keys: [jwk] }), { status: 200 });
    try {
      const sql = createFakeSql((text) => {
        if (text.startsWith('SELECT user_id FROM user_identities')) return { rows: [{ user_id: 55 }] };
        if (text.startsWith('SELECT 1 FROM user_identities')) return { rows: [] };
        if (text.startsWith('SELECT id, trip_id, role FROM travelers')) return { rows: [] };
        return { rows: [] };
      });
      const events = JSON.stringify({ type: 'consent-revoked', sub: 'apple-001' });
      const ok = await call(loadHandler('auth.js', sql), { method: 'POST', query: { action: 'apple-notify' },
        body: { payload: sign({ iss: 'https://appleid.apple.com', aud: 'com.sosodobo.app', events }) } });
      assert.equal(ok.statusCode, 200);
      assert.ok(sql.calls.some((c) => c.text.startsWith("DELETE FROM user_identities WHERE provider = 'apple'")));
      assert.ok(sql.calls.some((c) => c.text.startsWith('DELETE FROM users') && c.values[0] === 55));

      const forged = await call(loadHandler('auth.js', createFakeSql()), { method: 'POST', query: { action: 'apple-notify' },
        body: { payload: sign({ iss: 'https://appleid.apple.com', aud: 'com.other.app', events }) } });
      assert.equal(forged.statusCode, 400, '다른 앱 알림은 무시');
      const bad = await call(loadHandler('auth.js', createFakeSql()), { method: 'POST', query: { action: 'apple-notify' },
        body: { payload: 'x.y.z' } });
      assert.equal(bad.statusCode, 400);
    } finally {
      global.fetch = realFetch;
    }
  });
});

test('Apple .p8 키: 줄바꿈이 사라지거나 · 따옴표 · BEGIN/END 없이 넣어도 서명된다', () => {
  const { privateKey, publicKey } = crypto.generateKeyPairSync('ec', { namedCurve: 'P-256' });
  const pem = privateKey.export({ type: 'pkcs8', format: 'pem' });
  const body = pem.replace(/-----(BEGIN|END) PRIVATE KEY-----/g, '').replace(/\s+/g, '');
  const variants = [pem, pem.replace(/\n/g, ' '), '"' + pem.replace(/\n/g, '\\n') + '"', body, '  ' + pem + '\n\n'];
  for (const v of variants) {
    const t = O.appleClientSecret({ APPLE_PRIVATE_KEY: v, APPLE_KEY_ID: 'K', APPLE_TEAM_ID: 'T', APPLE_CLIENT_ID: 'C' });
    const [h, p, s] = t.split('.');
    assert.ok(crypto.verify('sha256', Buffer.from(h + '.' + p), { key: publicKey, dsaEncoding: 'ieee-p1363' }, Buffer.from(s, 'base64url')), JSON.stringify(v.slice(0, 30)));
  }
});
