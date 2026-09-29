// 계정 로그인 공용 도구 (파일명이 _ 로 시작해 API 경로로 노출되지 않아요).
//
// - 세션: 서버 비밀값(SESSION_SECRET)으로 서명한 쿠키 하나 (DB 세션 테이블 없음). 30일 유지.
// - 로그인은 환경변수가 모두 준비됐을 때만 켜져요 (AUTH_ENABLED=1 + SESSION_SECRET + TRIP_JOIN_CODE + Google 또는 카카오 키).
//   준비 전에는 지금처럼 로그인 없이 동작하므로, 배포해도 아무도 잠기지 않아요.
// - 켜지면 모든 API 는 "로그인 + 여행자와 연결된 계정"만 쓸 수 있고, 요청에 들어온 travelerId 는
//   무시하고 로그인한 사람의 여행자 id 로 바꿔 씁니다 (다른 사람 이름으로 좋아요·댓글을 못 달게).
const crypto = require('node:crypto');

const SESSION_COOKIE = 'sd_session';
const STATE_COOKIE = 'sd_oauth';
const SESSION_DAYS = 30;
const STATE_MINUTES = 10;

function b64url(buf) {
  return Buffer.from(buf).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
function fromB64url(s) {
  return Buffer.from(String(s).replace(/-/g, '+').replace(/_/g, '/'), 'base64');
}

function hmac(secret, data) {
  return b64url(crypto.createHmac('sha256', secret).update(data).digest());
}

function safeEqual(a, b) {
  const x = Buffer.from(String(a));
  const y = Buffer.from(String(b));
  return x.length === y.length && crypto.timingSafeEqual(x, y);
}

/** { ...payload, exp } 를 서명한 문자열로. */
function sign(payload, secret) {
  const body = b64url(JSON.stringify(payload));
  return body + '.' + hmac(secret, body);
}

/** 서명·만료 확인. 틀리거나 지났으면 null. */
function verify(token, secret, nowMs) {
  if (!token || !secret || typeof token !== 'string') return null;
  const dot = token.lastIndexOf('.');
  if (dot <= 0) return null;
  const body = token.slice(0, dot);
  if (!safeEqual(hmac(secret, body), token.slice(dot + 1))) return null;
  let payload;
  try {
    payload = JSON.parse(fromB64url(body).toString('utf8'));
  } catch {
    return null;
  }
  const now = Number.isFinite(nowMs) ? nowMs : Date.now();
  if (!payload || typeof payload.exp !== 'number' || payload.exp < now) return null;
  return payload;
}

function parseCookies(header) {
  const out = {};
  String(header || '').split(';').forEach((part) => {
    const i = part.indexOf('=');
    if (i < 0) return;
    const k = part.slice(0, i).trim();
    if (k) out[k] = decodeURIComponent(part.slice(i + 1).trim());
  });
  return out;
}

function isHttps(req) {
  const proto = String((req.headers && req.headers['x-forwarded-proto']) || '').split(',')[0].trim();
  if (proto) return proto === 'https';
  const host = String((req.headers && req.headers.host) || '');
  return !/^(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/.test(host);
}

function cookieString(name, value, { maxAgeSec, secure }) {
  const parts = [name + '=' + encodeURIComponent(value), 'Path=/', 'HttpOnly', 'SameSite=Lax', 'Max-Age=' + maxAgeSec];
  if (secure) parts.push('Secure');
  return parts.join('; ');
}

function appendCookie(res, cookie) {
  const prev = res.getHeader ? res.getHeader('Set-Cookie') : undefined;
  const list = prev ? (Array.isArray(prev) ? prev.concat(cookie) : [prev, cookie]) : [cookie];
  res.setHeader('Set-Cookie', list);
}

// ---------------------------------------------------------------------------
// 설정
// ---------------------------------------------------------------------------
function providersConfigured(env) {
  const e = env || process.env;
  return {
    google: !!(e.GOOGLE_CLIENT_ID && e.GOOGLE_CLIENT_SECRET),
    kakao: !!e.KAKAO_REST_API_KEY,
  };
}

/** 로그인을 켤 수 있는 상태인지 + 켜져 있는지. */
function authConfig(env) {
  const e = env || process.env;
  const providers = providersConfigured(e);
  const ready = !!(e.SESSION_SECRET && String(e.SESSION_SECRET).length >= 32 && e.TRIP_JOIN_CODE && (providers.google || providers.kakao));
  const flag = /^(1|true|yes|on)$/i.test(String(e.AUTH_ENABLED || ''));
  return { enabled: flag && ready, ready, flag, providers };
}

function authEnabled(env) {
  return authConfig(env).enabled;
}

/** 여행 참여 코드 확인 (앞뒤 공백·대소문자 무시). */
function checkJoinCode(input, env) {
  const expected = String((env || process.env).TRIP_JOIN_CODE || '').trim().toLowerCase();
  const given = String(input || '').trim().toLowerCase();
  return !!expected && safeEqual(given, expected);
}

// ---------------------------------------------------------------------------
// 세션 쿠키
// ---------------------------------------------------------------------------
function setSession(res, req, userId, env) {
  const secret = (env || process.env).SESSION_SECRET;
  const exp = Date.now() + SESSION_DAYS * 24 * 60 * 60 * 1000;
  appendCookie(res, cookieString(SESSION_COOKIE, sign({ uid: userId, exp }, secret), { maxAgeSec: SESSION_DAYS * 86400, secure: isHttps(req) }));
}

function clearSession(res, req) {
  appendCookie(res, cookieString(SESSION_COOKIE, '', { maxAgeSec: 0, secure: isHttps(req) }));
}

/** 쿠키의 로그인 사용자 id (없거나 틀리면 null). */
function sessionUserId(req, env) {
  const token = parseCookies(req.headers && req.headers.cookie)[SESSION_COOKIE];
  const payload = verify(token, (env || process.env).SESSION_SECRET);
  return payload && Number.isInteger(payload.uid) ? payload.uid : null;
}

function setOAuthState(res, req, data, env) {
  const secret = (env || process.env).SESSION_SECRET;
  const exp = Date.now() + STATE_MINUTES * 60 * 1000;
  appendCookie(res, cookieString(STATE_COOKIE, sign(Object.assign({}, data, { exp }), secret), { maxAgeSec: STATE_MINUTES * 60, secure: isHttps(req) }));
}

function readOAuthState(req, env) {
  const token = parseCookies(req.headers && req.headers.cookie)[STATE_COOKIE];
  return verify(token, (env || process.env).SESSION_SECRET);
}

function clearOAuthState(res, req) {
  appendCookie(res, cookieString(STATE_COOKIE, '', { maxAgeSec: 0, secure: isHttps(req) }));
}

// ---------------------------------------------------------------------------
// API 보호
// ---------------------------------------------------------------------------
function normalizeBody(req) {
  if (typeof req.body === 'string') {
    try { req.body = JSON.parse(req.body); } catch { req.body = {}; }
  }
  if (!req.body || typeof req.body !== 'object' || Array.isArray(req.body)) req.body = {};
}

/**
 * 로그인한 사람의 여행자 정보. → { ok: true, userId, travelerId, travelerName }
 * 또는 { ok: false, status, code, error } (401 로그인 필요 / 403 여행 참여 필요).
 * sql 은 테스트에서 바꿔 끼울 수 있게 인자로 받아요.
 */
async function findMember(req, sql, env) {
  const uid = sessionUserId(req, env);
  if (!uid) return { ok: false, status: 401, code: 'login_required', error: '로그인이 필요해요.' };
  const r = await sql`
    SELECT u.id AS user_id, t.id AS traveler_id, t.name AS traveler_name
    FROM users u LEFT JOIN travelers t ON t.user_id = u.id
    WHERE u.id = ${uid}`;
  if (!r.rows.length) return { ok: false, status: 401, code: 'login_required', error: '로그인이 필요해요.' };
  const row = r.rows[0];
  if (row.traveler_id === null || row.traveler_id === undefined) {
    return { ok: false, status: 403, code: 'join_required', error: '여행에 참여한 뒤에 볼 수 있어요.' };
  }
  return { ok: true, userId: uid, travelerId: Number(row.traveler_id), travelerName: row.traveler_name };
}

/**
 * API 핸들러 감싸기: 로그인이 켜져 있으면 여행 참여자만 통과시키고,
 * 요청의 travelerId · uploaderId 를 로그인한 사람의 여행자 id 로 바꿔 줍니다.
 */
function withMember(handler) {
  return async function guarded(req, res) {
    if (!authEnabled()) return handler(req, res);
    try {
      const { sql } = require('./_db');
      const m = await findMember(req, sql);
      if (!m.ok) return res.status(m.status).json({ error: m.error, code: m.code });
      req.member = m;
      req.query = Object.assign({}, req.query, { travelerId: String(m.travelerId) });
      normalizeBody(req);
      if (req.method !== 'GET') {
        req.body.travelerId = m.travelerId;
        if (Object.prototype.hasOwnProperty.call(req.body, 'uploaderId')) req.body.uploaderId = m.travelerId;
      }
      return handler(req, res);
    } catch (err) {
      console.error(err);
      return res.status(500).json({ error: '로그인 정보를 확인하지 못했어요.' });
    }
  };
}

module.exports = {
  SESSION_COOKIE,
  STATE_COOKIE,
  sign,
  verify,
  parseCookies,
  isHttps,
  authConfig,
  authEnabled,
  providersConfigured,
  checkJoinCode,
  setSession,
  clearSession,
  sessionUserId,
  setOAuthState,
  readOAuthState,
  clearOAuthState,
  findMember,
  withMember,
  b64url,
};
