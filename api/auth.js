// /api/auth  (계정 로그인 · 여행 참여)
//   GET  ?action=me                          → 로그인 상태, 내 계정, 참여한 여행 수
//   GET  ?action=login&provider=google|kakao → 로그인 화면으로 이동 (&link=1 이면 지금 계정에 이어 붙이기)
//   GET  /api/auth/:provider/callback        → (vercel.json 이 ?action=callback 으로 넘김) 로그인 마치고 홈으로
//                                              (Apple 은 같은 주소로 POST — 결과가 form 본문에 와요)
//   POST /api/auth/apple/notify              → Apple 서버 알림: 사용자가 Apple 로그인 연결을 끊거나 Apple 계정을 지움
//   POST ?action=logout                      → 로그아웃
//   POST ?action=delete-account { confirm: '삭제', deletePhotos? } → 계정 삭제 (App Store 요구사항)
//   --- iOS 앱 (Capacitor): 구글은 앱 안 웹뷰 로그인을 막아서, 로그인은 시스템 로그인 창(ASWebAuthenticationSession)에서
//   GET  ?action=login&provider=..&app=1[&ticket=]  → 끝나면 sosodobo://auth?code=.. 로 돌아옴 (ticket = 계정 이어 붙이기)
//   POST ?action=app-link-ticket             → 지금 계정에 이어 붙일 때 쓰는 2분짜리 표
//   GET  ?action=app-exchange&code=..        → 앱 웹뷰에서 한 번만 쓰는 코드로 로그인 쿠키 받기
//   POST ?action=join-options { code }       → 코드가 가리키는 여행 + 아직 계정과 연결 안 된 여행자 목록
//   POST ?action=join { code, travelerId } | { code, name } → 그 여행에서 "이게 나" 연결, 또는 새 이름으로 합류
//        (그 여행에 관리자가 아직 없으면 참여한 사람이 관리자)
const { sql, ensureSchema, sendError } = require('./_db');
const A = require('./_auth');
const O = require('./_oauth');
const crypto = require('node:crypto');
const { del } = require('@vercel/blob');
const { findBlobToken } = require('./_blob-token');

const APP_SCHEME = 'sosodobo';
const APP_CODE_SECONDS = 120;

function readBody(req) {
  if (!req.body) return {};
  if (typeof req.body === 'string') {
    try { return JSON.parse(req.body); } catch { /* form 본문일 수도 */ }
    return Object.fromEntries(new URLSearchParams(req.body));
  }
  return req.body;
}

/**
 * 계정 지우기 (프로필의 "계정 삭제", Apple 의 계정 삭제 알림이 같이 씀).
 * 내가 관리자인 여행은 계정이 있는 다른 참여자 중 가장 먼저 들어온 사람에게 넘기고,
 * 여행 안의 이름 · 지출 기록은 함께 쓰는 정산이라 이름만 남겨요. → 지운 사진 수
 */
async function deleteUserAccount(uid, opts) {
  const mine = await sql`SELECT id, trip_id, role FROM travelers WHERE user_id = ${uid}`;
  const ids = mine.rows.map((r) => r.id);
  let removedPhotos = 0;
  if (opts && opts.deletePhotos && ids.length) {
    const photos = await sql`DELETE FROM photos WHERE uploader_id = ANY(${ids}) RETURNING url, thumb_url`;
    removedPhotos = photos.rows.length;
    const urls = [];
    photos.rows.forEach((p) => { urls.push(p.url); if (p.thumb_url) urls.push(p.thumb_url); });
    const blobUrls = urls.filter((u) => /\.blob\.vercel-storage\.com\//.test(String(u)));
    if (blobUrls.length) {
      try { await del(blobUrls, { token: findBlobToken(process.env) || undefined }); } catch (err) { console.error('Blob 파일 삭제 실패', err); }
    }
  }
  for (const t of mine.rows.filter((r) => r.role === 'admin')) {
    await sql`
      UPDATE travelers SET role = 'admin'
      WHERE id = (SELECT id FROM travelers WHERE trip_id = ${t.trip_id} AND user_id IS NOT NULL AND user_id <> ${uid} ORDER BY id LIMIT 1)`;
    await sql`UPDATE travelers SET role = 'member' WHERE id = ${t.id}`;
  }
  await sql`DELETE FROM users WHERE id = ${uid}`;
  return removedPhotos;
}

// Apple 서버 알림의 서명 확인용 공개키 (몇 시간 기억)
let appleKeys = { at: 0, keys: [] };
async function verifyAppleJwt(token, fetchImpl) {
  const [h, p, s] = String(token || '').split('.');
  if (!h || !p || !s) return null;
  const head = JSON.parse(Buffer.from(h, 'base64url').toString('utf8'));
  if (head.alg !== 'RS256') return null;
  if (!appleKeys.keys.length || Date.now() - appleKeys.at > 6 * 3600000) {
    const r = await (fetchImpl || fetch)('https://appleid.apple.com/auth/keys');
    appleKeys = { at: Date.now(), keys: ((await r.json()) || {}).keys || [] };
  }
  const jwk = appleKeys.keys.find((k) => k.kid === head.kid);
  if (!jwk) return null;
  const ok = crypto.verify('RSA-SHA256', Buffer.from(h + '.' + p), crypto.createPublicKey({ key: jwk, format: 'jwk' }), Buffer.from(s, 'base64url'));
  if (!ok) return null;
  const claims = JSON.parse(Buffer.from(p, 'base64url').toString('utf8'));
  if (claims.iss !== 'https://appleid.apple.com') return null;
  if (claims.exp && claims.exp * 1000 < Date.now()) return null;
  return claims;
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
      const app = req.query.app === '1';
      let linkTo = null;
      if (app && req.query.ticket) {
        const t = A.verify(String(req.query.ticket), process.env.SESSION_SECRET);
        linkTo = t && t.purpose === 'link' ? t.uid : null;
      } else if (req.query.link) {
        linkTo = A.sessionUserId(req);
      }
      const nonce = A.b64url(crypto.randomBytes(18));
      A.setOAuthState(res, req, { p: provider, n: nonce, link: linkTo || null, app: app || undefined });
      const cred = O.credentials(provider);
      return redirect(res, O.authorizeUrl(provider, { clientId: cred.clientId, redirect: O.redirectUri(req, provider), state: nonce }));
    }

    if (action === 'callback') {
      const provider = String(req.query.provider || '');
      // Apple 은 결과를 POST 본문으로, 나머지는 주소(query)로
      const q = Object.assign({}, req.query, req.method === 'POST' ? readBody(req) : {});
      const st = A.readOAuthState(req);
      A.clearOAuthState(res, req);
      const back = (result) => (st && st.app ? APP_SCHEME + '://auth?error=' + result : '/?login=' + result);
      if (q.error) return redirect(res, back('cancelled'));
      if (!st || st.p !== provider || !q.state || st.n !== String(q.state) || !q.code) {
        return redirect(res, back('expired'));
      }
      let uid;
      try {
        const profile = await O.fetchProfile(provider, String(q.code), O.redirectUri(req, provider), undefined, undefined, { user: q.user });
        uid = await upsertUser(profile, st.link || null);
      } catch (err) {
        console.error(err);
        return redirect(res, back(err.code === 'already_linked' ? 'already_linked' : 'failed'));
      }
      if (st.app) {
        // 앱: 시스템 로그인 창의 쿠키는 앱 웹뷰와 따로라서, 한 번만 쓰는 짧은 코드를 앱으로 넘김
        const code = A.sign({ uid, purpose: 'app', n: A.b64url(crypto.randomBytes(12)), link: st.link ? 1 : 0,
          exp: Date.now() + APP_CODE_SECONDS * 1000 }, process.env.SESSION_SECRET);
        return redirect(res, APP_SCHEME + '://auth?code=' + encodeURIComponent(code));
      }
      A.setSession(res, req, uid);
      return redirect(res, st.link ? '/#profile' : '/');
    }

    if (action === 'apple-notify') {
      if (req.method !== 'POST') return fail(res, 405, 'POST만 지원합니다.');
      const claims = await verifyAppleJwt(readBody(req).payload).catch(() => null);
      const allowed = [process.env.APPLE_CLIENT_ID, process.env.APPLE_APP_ID || 'com.sosodobo.app'];
      if (!claims || allowed.indexOf(claims.aud) < 0) return fail(res, 400, '확인할 수 없는 알림이에요.');
      let ev = claims.events;
      if (typeof ev === 'string') { try { ev = JSON.parse(ev); } catch { ev = null; } }
      if (ev && ev.sub && (ev.type === 'consent-revoked' || ev.type === 'account-delete')) {
        const found = await sql`SELECT user_id FROM user_identities WHERE provider = 'apple' AND provider_user_id = ${String(ev.sub)}`;
        await sql`DELETE FROM user_identities WHERE provider = 'apple' AND provider_user_id = ${String(ev.sub)}`;
        // 다른 로그인(구글 · 카카오)이 없으면 들어올 방법이 없는 계정이라 지워요
        for (const r of found.rows) {
          const left = await sql`SELECT 1 FROM user_identities WHERE user_id = ${r.user_id} LIMIT 1`;
          if (!left.rows.length) await deleteUserAccount(r.user_id, { deletePhotos: false });
        }
      }
      return res.status(200).json({ ok: true });
    }

    if (action === 'app-link-ticket') {
      if (req.method !== 'POST') return fail(res, 405, 'POST만 지원합니다.');
      const uid = A.sessionUserId(req);
      if (!uid) return fail(res, 401, '로그인이 필요해요.', 'login_required');
      const ticket = A.sign({ uid, purpose: 'link', exp: Date.now() + APP_CODE_SECONDS * 1000 }, process.env.SESSION_SECRET);
      res.setHeader('Cache-Control', 'no-store');
      return res.status(200).json({ ticket });
    }

    if (action === 'app-exchange') {
      const t = A.verify(String(req.query.code || ''), process.env.SESSION_SECRET);
      if (!t || t.purpose !== 'app' || !t.uid || !t.n) return redirect(res, '/?login=expired');
      // 한 번만: 쓴 코드는 기록해 두고 다시 오면 막음
      const used = await sql`
        INSERT INTO app_meta (key, value) VALUES (${'appcode:' + t.n}, ${String(t.exp)})
        ON CONFLICT (key) DO NOTHING RETURNING key`;
      if (!used.rows.length) return redirect(res, '/?login=expired');
      await sql`DELETE FROM app_meta WHERE key LIKE 'appcode:%' AND value::bigint < ${Date.now() - 86400000}`;
      A.setSession(res, req, t.uid);
      return redirect(res, t.link ? '/#profile' : '/');
    }

    if (action === 'delete-account') {
      if (req.method !== 'POST') return fail(res, 405, 'POST만 지원합니다.');
      const uid = A.sessionUserId(req);
      if (!uid) return fail(res, 401, '로그인이 필요해요.', 'login_required');
      const b = readBody(req);
      if (String(b.confirm || '').trim() !== '삭제') return fail(res, 400, '확인을 위해 "삭제"라고 입력해 주세요.', 'confirm_required');
      const removedPhotos = await deleteUserAccount(uid, { deletePhotos: !!b.deletePhotos });
      A.clearSession(res, req);
      return res.status(200).json({ ok: true, removedPhotos });
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
