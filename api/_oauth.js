// Google · 카카오 OAuth (authorization code 방식). 네트워크 호출은 fetchImpl 로 받아 테스트에서 바꿔 끼워요.
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
};

function credentials(provider, env) {
  const e = env || process.env;
  if (provider === 'google') return { clientId: e.GOOGLE_CLIENT_ID, clientSecret: e.GOOGLE_CLIENT_SECRET };
  if (provider === 'kakao') return { clientId: e.KAKAO_REST_API_KEY, clientSecret: e.KAKAO_CLIENT_SECRET || '' };
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
  return p.authUrl + '?' + q.toString();
}

/** code → { provider, providerUserId, email, name, avatarUrl } */
async function fetchProfile(provider, code, redirect, env, fetchImpl) {
  const f = fetchImpl || fetch;
  const p = PROVIDERS[provider];
  const cred = credentials(provider, env);
  const form = new URLSearchParams({ grant_type: 'authorization_code', code, redirect_uri: redirect, client_id: cred.clientId });
  if (cred.clientSecret) form.set('client_secret', cred.clientSecret);
  const tokenRes = await f(p.tokenUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded;charset=utf-8' },
    body: form.toString(),
  });
  const token = await tokenRes.json().catch(() => ({}));
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

module.exports = { PROVIDERS, credentials, redirectUri, authorizeUrl, fetchProfile };
