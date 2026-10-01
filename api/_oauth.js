// Google · 카카오 · Apple OAuth (authorization code 방식). 네트워크 호출은 fetchImpl 로 받아 테스트에서 바꿔 끼워요.
const crypto = require('node:crypto');

const PROVIDERS = {
  google: {
    authUrl: 'https://accounts.google.com/o/oauth2/v2/auth',
    tokenUrl: 'https://oauth2.googleapis.com/token',
    userUrl: 'https://openidconnect.googleapis.com/v1/userinfo',
    scope: 'openid email profile',
  },
  kakao: {
    authUrl: 'https://kauth.kakao.com/oauth/authorize',
    tokenUrl: 'https://kauth.kakao.com/oauth/token',
    userUrl: 'https://kapi.kakao.com/v2/user/me',
    scope: '', // 닉네임·프로필 사진은 카카오 앱 동의항목에서 켭니다
  },
  // Apple: 이름 · 이메일을 받으려면 결과를 form_post(POST)로 돌려줘요. 이름은 처음 로그인할 때 한 번만 와요.
  apple: {
    authUrl: 'https://appleid.apple.com/auth/authorize',
    tokenUrl: 'https://appleid.apple.com/auth/token',
    scope: 'name email',
  },
};

function b64url(buf) {
  return Buffer.from(buf).toString('base64').replace(/=+$/, '').replace(/\+/g, '-').replace(/\//g, '_');
}

/**
 * Vercel 환경변수에 넣은 .p8 키 → 서명용 키.
 * 붙여 넣다 줄바꿈이 사라지거나(공백 · \\n 글자로 바뀜), 따옴표가 붙거나, BEGIN/END 줄이 빠져도 읽히게
 * 가운데 base64 본문만 골라 PKCS#8 DER 로 다시 읽어요.
 */
function applePrivateKey(e) {
  const body = String(e.APPLE_PRIVATE_KEY || '')
    .replace(/\\n/g, '\n')
    .replace(/-----(BEGIN|END)[^-]*-----/g, '')
    .replace(/[^A-Za-z0-9+/=]/g, '');
  return crypto.createPrivateKey({ key: Buffer.from(body, 'base64'), format: 'der', type: 'pkcs8' });
}

/**
 * Apple 은 client_secret 대신 .p8 키로 서명한 짧은 JWT(ES256)를 받아요.
 * https://developer.apple.com/documentation/accountorganizationaldatasharing/creating-a-client-secret
 */
function appleClientSecret(env, nowMs) {
  const e = env || process.env;
  const now = Math.floor((nowMs || Date.now()) / 1000);
  const head = b64url(JSON.stringify({ alg: 'ES256', kid: e.APPLE_KEY_ID }));
  const body = b64url(JSON.stringify({ iss: e.APPLE_TEAM_ID, iat: now, exp: now + 300, aud: 'https://appleid.apple.com', sub: e.APPLE_CLIENT_ID }));
  const sig = crypto.sign('sha256', Buffer.from(head + '.' + body), { key: applePrivateKey(e), dsaEncoding: 'ieee-p1363' });
  return head + '.' + body + '.' + b64url(sig);
}

/** JWT 의 가운데(payload)만 읽기 — 서명 확인은 하지 않아요 (Apple 토큰 주소에서 TLS 로 바로 받은 것만 이걸로) */
function decodeJwtPayload(token) {
  const part = String(token || '').split('.')[1];
  if (!part) return null;
  try { return JSON.parse(Buffer.from(part.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8')); } catch { return null; }
}

function credentials(provider, env) {
  const e = env || process.env;
  if (provider === 'google') return { clientId: e.GOOGLE_CLIENT_ID, clientSecret: e.GOOGLE_CLIENT_SECRET };
  if (provider === 'kakao') return { clientId: e.KAKAO_REST_API_KEY, clientSecret: e.KAKAO_CLIENT_SECRET || '' };
  if (provider === 'apple') return { clientId: e.APPLE_CLIENT_ID, clientSecret: null }; // 비밀값은 그때그때 appleClientSecret 으로
  return null;
}

/** 로그인 후 돌아올 주소. PUBLIC_BASE_URL 이 있으면 그걸, 없으면 지금 요청한 주소 기준. */
function redirectUri(req, provider, env) {
  const e = env || process.env;
  let base = e.PUBLIC_BASE_URL;
  if (!base) {
    const h = req.headers || {};
    const host = String(h['x-forwarded-host'] || h.host || '').split(',')[0].trim();
    const proto = String(h['x-forwarded-proto'] || (/^(localhost|127\.0\.0\.1)(:\d+)?$/.test(host) ? 'http' : 'https')).split(',')[0].trim();
    base = proto + '://' + host;
  }
  return base.replace(/\/+$/, '') + '/api/auth/' + provider + '/callback';
}

function authorizeUrl(provider, { clientId, redirect, state }) {
  const p = PROVIDERS[provider];
  const q = new URLSearchParams({ client_id: clientId, redirect_uri: redirect, response_type: 'code', state });
  if (p.scope) q.set('scope', p.scope);
  if (provider === 'google') q.set('prompt', 'select_account');
  if (provider === 'apple') q.set('response_mode', 'form_post');
  return p.authUrl + '?' + q.toString();
}

/**
 * code → { provider, providerUserId, email, name, avatarUrl }
 * extra.user: Apple 이 처음 로그인 때만 같이 보내는 이름 JSON ({"name":{"firstName","lastName"}})
 */
async function fetchProfile(provider, code, redirect, env, fetchImpl, extra) {
  const f = fetchImpl || fetch;
  const p = PROVIDERS[provider];
  const cred = credentials(provider, env);
  const form = new URLSearchParams({ grant_type: 'authorization_code', code, redirect_uri: redirect, client_id: cred.clientId });
  if (provider === 'apple') form.set('client_secret', appleClientSecret(env));
  else if (cred.clientSecret) form.set('client_secret', cred.clientSecret);
  const tokenRes = await f(p.tokenUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded;charset=utf-8' },
    body: form.toString(),
  });
  const token = await tokenRes.json().catch(() => ({}));
  if (provider === 'apple') {
    // id_token 은 Apple 토큰 주소에서 우리 비밀값으로 바로 받은 것이라 내용만 확인해요
    const claims = decodeJwtPayload(token.id_token);
    if (!tokenRes.ok || !claims || !claims.sub) throw new Error('로그인 토큰을 받지 못했어요' + (token.error ? ' (' + token.error + ')' : ''));
    if (claims.iss !== 'https://appleid.apple.com' || claims.aud !== cred.clientId) throw new Error('Apple 로그인 정보가 이 앱 것이 아니에요.');
    let name = null;
    try {
      const u = typeof (extra && extra.user) === 'string' ? JSON.parse(extra.user) : (extra && extra.user) || null;
      const n = u && u.name;
      if (n) name = [n.lastName, n.firstName].filter(Boolean).join('') || null; // 한국식: 성+이름
    } catch { /* 이름은 없어도 돼요 */ }
    return { provider, providerUserId: String(claims.sub), email: claims.email || null, name, avatarUrl: null };
  }
  if (!tokenRes.ok || !token.access_token) {
    throw new Error('로그인 토큰을 받지 못했어요' + (token.error ? ' (' + token.error + ')' : ''));
  }
  const userRes = await f(p.userUrl, { headers: { Authorization: 'Bearer ' + token.access_token } });
  const u = await userRes.json().catch(() => ({}));
  if (!userRes.ok) throw new Error('계정 정보를 받지 못했어요.');
  if (provider === 'google') {
    if (!u.sub) throw new Error('계정 정보를 받지 못했어요.');
    return { provider, providerUserId: String(u.sub), email: u.email || null, name: u.name || u.given_name || null, avatarUrl: u.picture || null };
  }
  const acc = u.kakao_account || {};
  const prof = acc.profile || {};
  if (u.id === undefined || u.id === null) throw new Error('계정 정보를 받지 못했어요.');
  return {
    provider,
    providerUserId: String(u.id),
    email: acc.email || null,
    name: prof.nickname || (u.properties && u.properties.nickname) || null,
    avatarUrl: prof.profile_image_url || (u.properties && u.properties.profile_image) || null,
  };
}

module.exports = { PROVIDERS, credentials, redirectUri, authorizeUrl, fetchProfile, appleClientSecret, decodeJwtPayload };
