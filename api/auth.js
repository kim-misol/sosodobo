// /api/auth  (계정 로그인 · 여행 참여)
//   GET  ?action=me                          → 로그인 상태, 내 계정, 참여한 여행 수
//   GET  ?action=login&provider=google|kakao → 로그인 화면으로 이동 (&link=1 이면 지금 계정에 이어 붙이기)
//   GET  /api/auth/:provider/callback        → (vercel.json 이 ?action=callback 으로 넘김) 로그인 마치고 홈으로
//   POST ?action=logout                      → 로그아웃
//   POST ?action=join-options { code }       → 코드가 가리키는 여행 + 아직 계정과 연결 안 된 여행자 목록
//   POST ?action=join { code, travelerId } | { code, name } → 그 여행에서 "이게 나" 연결, 또는 새 이름으로 합류
//        (그 여행에 관리자가 아직 없으면 참여한 사람이 관리자)
const { sql, ensureSchema, sendError } = require('./_db');
const A = require('./_auth');
const O = require('./_oauth');
const crypto = require('node:crypto');

function readBody(req) {
  if (!req.body) return {};
  if (typeof req.body === 'string') {
    try { return JSON.parse(req.body); } catch { return {}; }
  }
  return req.body;
}

function redirect(res, location) {
  res.statusCode = 302;
  res.setHeader('Location', location);
  res.setHeader('Cache-Control', 'no-store');
  res.end();
}

function fail(res, status, error, code) {
  return res.status(status).json(code ? { error, code } : { error });
}

async function loadMe(uid) {
  const u = await sql`SELECT id, name, email, avatar_url FROM users WHERE id = ${uid}`;
  if (!u.rows.length) return null;
  const ids = await sql`SELECT provider FROM user_identities WHERE user_id = ${uid} ORDER BY created_at`;
  const t = await sql`SELECT COUNT(*) AS n FROM travelers WHERE user_id = ${uid}`;
  const row = u.rows[0];
  return {
    user: { id: row.id, name: row.name, email: row.email, avatarUrl: row.avatar_url },
    linked: ids.rows.map((r) => r.provider),
    tripCount: Number(t.rows[0].n),
  };
}

/** 로그인 결과(profile)로 계정을 찾거나 만들기. linkTo 가 있으면 그 계정에 이어 붙임. → user id */
async function upsertUser(profile, linkTo) {
  const found = await sql`
    SELECT user_id FROM user_identities WHERE provider = ${profile.provider} AND provider_user_id = ${profile.providerUserId}`;
  if (found.rows.length) {
    const uid = found.rows[0].user_id;
    if (linkTo && linkTo !== uid) {
      const err = new Error('이 계정은 이미 다른 사람의 로그인에 이어져 있어요.');
      err.code = 'already_linked';
      throw err;
    }
    await sql`UPDATE users SET last_login_at = now(), avatar_url = COALESCE(avatar_url, ${profile.avatarUrl}) WHERE id = ${uid}`;
    return uid;
  }
  let uid = linkTo;
  if (!uid) {
    const created = await sql`
      INSERT INTO users (name, email, avatar_url, last_login_at)
      VALUES (${profile.name}, ${profile.email}, ${profile.avatarUrl}, now())
      RETURNING id`;
    uid = created.rows[0].id;
  }
  await sql`
    INSERT INTO user_identities (provider, provider_user_id, user_id, email)
    VALUES (${profile.provider}, ${profile.providerUserId}, ${uid}, ${profile.email})`;
  return uid;
}

module.exports = async function handler(req, res) {
  const action = String((req.query && req.query.action) || '');
  const cfg = A.authConfig();
  try {
    if (action === 'me') {
      res.setHeader('Cache-Control', 'no-store');
      if (!cfg.enabled) return res.status(200).json({ enabled: false });
      await ensureSchema();
      const uid = A.sessionUserId(req);
      const me = uid ? await loadMe(uid) : null;
      return res.status(200).json(Object.assign({ enabled: true, providers: cfg.providers, user: null, linked: [], tripCount: 0 }, me || {}));
    }

    if (!cfg.enabled) return fail(res, 404, '로그인 기능이 아직 켜지지 않았어요.');
    await ensureSchema();

    if (action === 'login') {
      const provider = String(req.query.provider || '');
      if (!cfg.providers[provider]) return fail(res, 400, '지원하지 않는 로그인 방식이에요.');
      const linkTo = req.query.link ? A.sessionUserId(req) : null;
      const nonce = A.b64url(crypto.randomBytes(18));
      A.setOAuthState(res, req, { p: provider, n: nonce, link: linkTo || null });
      const cred = O.credentials(provider);
      return redirect(res, O.authorizeUrl(provider, { clientId: cred.clientId, redirect: O.redirectUri(req, provider), state: nonce }));
    }

    if (action === 'callback') {
      const provider = String(req.query.provider || '');
      const st = A.readOAuthState(req);
      A.clearOAuthState(res, req);
      if (req.query.error) return redirect(res, '/?login=cancelled');
      if (!st || st.p !== provider || !req.query.state || st.n !== String(req.query.state) || !req.query.code) {
        return redirect(res, '/?login=expired');
      }
      let uid;
      try {
        const profile = await O.fetchProfile(provider, String(req.query.code), O.redirectUri(req, provider));
        uid = await upsertUser(profile, st.link || null);
      } catch (err) {
        console.error(err);
        return redirect(res, '/?login=' + (err.code === 'already_linked' ? 'already_linked' : 'failed'));
      }
      A.setSession(res, req, uid);
      return redirect(res, st.link ? '/#profile' : '/');
    }

    if (action === 'logout') {
      if (req.method !== 'POST') return fail(res, 405, 'POST만 지원합니다.');
      A.clearSession(res, req);
      return res.status(200).json({ ok: true });
    }

    if (action === 'join-options' || action === 'join') {
      if (req.method !== 'POST') return fail(res, 405, 'POST만 지원합니다.');
      const uid = A.sessionUserId(req);
      if (!uid) return fail(res, 401, '로그인이 필요해요.', 'login_required');
      const b = readBody(req);
      const code = String(b.code || '').trim();
      const found = code ? await sql`
        SELECT id, title, join_code, to_char(start_date, 'YYYY-MM-DD') AS start_date, to_char(end_date, 'YYYY-MM-DD') AS end_date
        FROM trips WHERE lower(join_code) = lower(${code})` : { rows: [] };
      const trip = found.rows[0];
      if (!trip || !A.checkJoinCode(code, trip.join_code)) {
        return fail(res, 403, '참여 코드가 맞지 않아요. 여행을 만든 사람에게 코드를 물어봐 주세요.', 'bad_code');
      }
      const tripOut = { id: trip.id, title: trip.title, startDate: trip.start_date, endDate: trip.end_date };
      const mine = await sql`SELECT id, name FROM travelers WHERE user_id = ${uid} AND trip_id = ${trip.id}`;
      if (mine.rows.length) {
        return action === 'join'
          ? res.status(200).json({ trip: tripOut, traveler: mine.rows[0] })
          : fail(res, 409, '이미 이 여행에 참여했어요.', 'already_joined');
      }
      if (action === 'join-options') {
        const free = await sql`SELECT id, name FROM travelers WHERE trip_id = ${trip.id} AND user_id IS NULL ORDER BY id`;
        return res.status(200).json({ trip: tripOut, travelers: free.rows.map((r) => ({ id: r.id, name: r.name })) });
      }
      const hasAdmin = await sql`SELECT 1 FROM travelers WHERE trip_id = ${trip.id} AND role = 'admin' AND user_id IS NOT NULL`;
      const role = hasAdmin.rows.length ? 'member' : 'admin';
      const travelerId = parseInt(b.travelerId, 10);
      if (Number.isInteger(travelerId)) {
        const claimed = await sql`
          UPDATE travelers SET user_id = ${uid}, role = CASE WHEN ${role} = 'admin' THEN 'admin' ELSE role END
          WHERE id = ${travelerId} AND trip_id = ${trip.id} AND user_id IS NULL RETURNING id, name`;
        if (!claimed.rows.length) return fail(res, 409, '이미 다른 계정과 연결된 사람이에요. 목록에서 다시 골라 주세요.', 'taken');
        return res.status(200).json({ trip: tripOut, traveler: claimed.rows[0] });
      }
      const name = String(b.name || '').trim();
      if (!name) return fail(res, 400, '이름을 입력하거나 목록에서 골라 주세요.');
      if (name.length > 40) return fail(res, 400, '이름은 40자 이하로 입력해 주세요.');
      const created = await sql`
        INSERT INTO travelers (name, user_id, trip_id, role) VALUES (${name}, ${uid}, ${trip.id}, ${role}) RETURNING id, name`;
      return res.status(201).json({ trip: tripOut, traveler: created.rows[0] });
    }

    return fail(res, 400, '알 수 없는 요청이에요.');
  } catch (err) {
    return sendError(res, err);
  }
};
