// 계정 로그인 공용 도구 (파일명이 _ 로 시작해 API 경로로 노출되지 않아요).
//
// - 세션: 서버 비밀값(SESSION_SECRET)으로 서명한 쿠키 하나 (DB 세션 테이블 없음). 30일 유지.
// - 로그인은 환경변수가 모두 준비됐을 때만 켜져요 (AUTH_ENABLED=1 + SESSION_SECRET + Google 또는 카카오 키).
//   여행 참여 코드는 여행마다 DB 에 있어요 (TRIP_JOIN_CODE 는 남해 여행을 옮길 때 초기값으로만 씀).
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
  const ready = !!(e.SESSION_SECRET && String(e.SESSION_SECRET).length >= 32 && (providers.google || providers.kakao));
  const flag = /^(1|true|yes|on)$/i.test(String(e.AUTH_ENABLED || ''));
  return { enabled: flag && ready, ready, flag, providers };
}

function authEnabled(env) {
  return authConfig(env).enabled;
}

/** 참여 코드 비교 (앞뒤 공백·대소문자 무시). 기대값이 비어 있으면 항상 실패. */
function checkJoinCode(input, expected) {
  const want = String(expected || '').trim().toLowerCase();
  const given = String(input || '').trim().toLowerCase();
  return !!want && safeEqual(given, want);
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

/** 여행 행을 화면·검증에 쓰기 좋은 모양으로 (날짜는 'YYYY-MM-DD' 문자열, 일수 계산). */
function tripInfo(row) {
  if (!row) return null;
  const start = Date.parse(row.start_date + 'T00:00:00Z');
  const end = Date.parse(row.end_date + 'T00:00:00Z');
  return {
    id: row.id,
    title: row.title,
    summary: row.summary,
    region: row.region,
    startDate: row.start_date,
    endDate: row.end_date,
    days: Math.round((end - start) / 86400000) + 1,
    visibility: row.visibility,
    membersCanEdit: row.members_can_edit,
    coverUrl: row.cover_url,
    legacyKey: row.legacy_key,
  };
}

/**
 * 요청이 가리키는 여행: ?trip= (또는 본문 tripId). 없으면 예전 주소 호환을 위해 처음 옮겨 온 남해 여행.
 * 날짜는 DB 시간대에 흔들리지 않게 문자열로 꺼냅니다.
 */
async function loadTrip(req, sql) {
  const raw = (req.query && req.query.trip) !== undefined ? req.query.trip : req.body && req.body.tripId;
  let id = parseInt(raw, 10);
  if (!Number.isInteger(id)) {
    const meta = await sql`SELECT value FROM app_meta WHERE key = 'legacy_trip_id'`;
    id = meta.rows.length ? parseInt(meta.rows[0].value, 10) : NaN;
  }
  if (!Number.isInteger(id)) return null;
  const r = await sql`
    SELECT id, title, summary, region, to_char(start_date, 'YYYY-MM-DD') AS start_date, to_char(end_date, 'YYYY-MM-DD') AS end_date,
           visibility, members_can_edit, cover_url, legacy_key, join_code
    FROM trips WHERE id = ${id}`;
  return r.rows[0] || null;
}

/**
 * 로그인한 사람이 이 여행에서 누구인지. → { ok: true, userId, travelerId, travelerName, role }
 * 또는 { ok: false, status, code, error } (401 로그인 필요 / 403 이 여행에 참여 필요).
 * sql 은 테스트에서 바꿔 끼울 수 있게 인자로 받아요.
 */
async function findMember(req, sql, env, tripId) {
  const uid = sessionUserId(req, env);
  if (!uid) return { ok: false, status: 401, code: 'login_required', error: '로그인이 필요해요.' };
  const r = await sql`
    SELECT u.id AS user_id, t.id AS traveler_id, t.name AS traveler_name, t.role
    FROM users u LEFT JOIN travelers t ON t.user_id = u.id AND t.trip_id = ${tripId}
    WHERE u.id = ${uid}`;
  if (!r.rows.length) return { ok: false, status: 401, code: 'login_required', error: '로그인이 필요해요.' };
  const row = r.rows[0];
  if (row.traveler_id === null || row.traveler_id === undefined) {
    return { ok: false, status: 403, code: 'join_required', error: '이 여행에 참여한 뒤에 볼 수 있어요.' };
  }
  return { ok: true, userId: uid, travelerId: Number(row.traveler_id), travelerName: row.traveler_name, role: row.role || 'member' };
}

/**
 * API 핸들러 감싸기.
 * - 요청이 가리키는 여행을 찾아 req.trip (tripInfo) · req.tripId 에 둡니다 (없으면 404).
 * - 로그인이 켜져 있으면 그 여행의 참여자만 통과시키고, 요청의 travelerId · uploaderId 를
 *   로그인한 사람의 여행자 id 로 바꿔 줍니다. opts.publicRead 인 GET 은 링크 공개 여행이면 누구나 읽기 가능.
 */
function withMember(handler, opts) {
  const options = opts || {};
  return async function guarded(req, res) {
    // 여행과 상관없는 기능(업로드 준비 상태 확인 등)은 로그인이 꺼져 있으면 DB 없이 바로
    if (options.tripOptionalWhenOpen && !authEnabled()) return handler(req, res);
    try {
      const { sql, ensureSchema } = require('./_db');
      await ensureSchema();
      normalizeBody(req);
      const row = await loadTrip(req, sql);
      if (!row) return res.status(404).json({ error: '여행을 찾을 수 없어요.', code: 'no_trip' });
      req.trip = tripInfo(row);
      req.tripId = row.id;
      if (!authEnabled()) return handler(req, res);
      const m = await findMember(req, sql, undefined, row.id);
      if (!m.ok) {
        if (options.publicRead && req.method === 'GET' && row.visibility === 'link') {
          req.member = null;
          return handler(req, res);
        }
        return res.status(m.status).json({ error: m.error, code: m.code });
      }
      req.member = m;
      req.query = Object.assign({}, req.query, { travelerId: String(m.travelerId) });
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

/** 로그인이 켜져 있을 때 관리자만 (꺼져 있으면 누구나). */
function isAdmin(req) {
  return !authEnabled() || !!(req.member && req.member.role === 'admin');
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
  loadTrip,
  tripInfo,
  isAdmin,
  b64url,
};
