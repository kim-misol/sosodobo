/**
 * 계정 로그인 화면 (Google · 카카오) + 첫 로그인 때 "이 여행에서 나는 누구" 고르기.
 *
 * 서버에서 로그인이 켜져 있지 않으면(/api/auth?action=me → enabled:false) 아무것도 하지 않아요.
 * 켜져 있으면:
 *   - 로그인 전 → 로그인 화면으로 전체를 가림
 *   - 로그인했지만 여행에 아직 연결 안 됨 → 참여 코드 + "이게 나" 고르기 화면
 *   - 참여자 → window.AuthUI.member 에 정보를 두고 'sosodobo:auth' 이벤트로 알림
 *     (사진 화면은 "나는 누구" 대신 로그인한 사람으로 고정, 프로필 탭은 계정 정보를 보여줌)
 * 세션이 끝나 API 가 401/403 을 돌려주면 그때도 해당 화면을 다시 띄웁니다.
 *
 * <head> 에서 불러와 다른 스크립트보다 먼저 fetch 를 감쌉니다.
 */
(function () {
  'use strict';

  var API = 'api/auth';
  var AuthUI = { enabled: null, member: null, me: null };
  var resolveReady;
  /** 로그인 확인이 끝나 여행을 불러와도 될 때 (로그인이 꺼져 있거나, 로그인한 사람) → me */
  AuthUI.ready = new Promise(function (r) { resolveReady = r; });
  window.AuthUI = AuthUI;

  function esc(s) {
    return String(s === null || s === undefined ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  function reveal() { document.documentElement.classList.remove('auth-checking'); }

  // ---------------------------------------------------------------------------
  // 세션이 끝났을 때: 다른 화면의 API 호출이 401/403 을 받으면 로그인·참여 화면을 다시 띄움
  // ---------------------------------------------------------------------------
  var realFetch = window.fetch ? window.fetch.bind(window) : null;
  if (realFetch) {
    window.fetch = function (input, init) {
      return realFetch(input, init).then(function (res) {
        // 구경 중(링크 공개 · 참여 안 함)에는 참여자 전용 요청이 거절돼도 화면을 가리지 않아요.
        if (AuthUI.enabled && !AuthUI.viewer && (res.status === 401 || res.status === 403)) {
          var url = typeof input === 'string' ? input : (input && input.url) || '';
          if (/(^|\/)api\//.test(url) && url.indexOf('api/auth') < 0) {
            res.clone().json().then(function (d) {
              if (d && d.code === 'login_required') showLogin();
              else if (d && d.code === 'join_required') AuthUI.showJoin({ back: '내 여행으로' });
            }).catch(function () { /* 본문 없음 */ });
          }
        }
        return res;
      });
    };
  }

  function post(action, body) {
    return (realFetch || fetch)(API + '?action=' + action, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body || {}),
    }).then(function (res) {
      return res.json().catch(function () { return {}; }).then(function (data) {
        if (!res.ok) { var e = new Error(data.error || '요청 실패 (' + res.status + ')'); e.code = data.code; throw e; }
        return data;
      });
    });
  }

  // ---------------------------------------------------------------------------
  // 화면
  // ---------------------------------------------------------------------------
  var gate = null;
  function ensureGate() {
    if (!gate) {
      gate = document.createElement('div');
      gate.className = 'auth-gate';
      gate.setAttribute('role', 'dialog');
      gate.setAttribute('aria-modal', 'true');
      document.body.appendChild(gate);
      gate.addEventListener('submit', onSubmit);
      gate.addEventListener('click', onClick);
    }
    document.body.classList.add('auth-locked');
    return gate;
  }

  function closeGate() {
    if (gate) { gate.remove(); gate = null; }
    document.body.classList.remove('auth-locked');
  }

  var GOOGLE_G = '<svg viewBox="0 0 48 48" width="18" height="18" aria-hidden="true"><path fill="#EA4335" d="M24 9.5c3.5 0 6.6 1.2 9.1 3.6l6.8-6.8C35.8 2.4 30.3 0 24 0 14.6 0 6.6 5.4 2.7 13.3l7.9 6.1C12.5 13.7 17.8 9.5 24 9.5z"/><path fill="#4285F4" d="M46.1 24.5c0-1.6-.1-3.1-.4-4.5H24v9h12.4c-.5 2.9-2.2 5.3-4.6 6.9l7.4 5.7c4.3-4 6.9-9.9 6.9-17.1z"/><path fill="#FBBC05" d="M10.6 28.6A14.5 14.5 0 0 1 9.5 24c0-1.6.3-3.2.8-4.6l-7.9-6.1A24 24 0 0 0 0 24c0 3.9.9 7.5 2.7 10.7l7.9-6.1z"/><path fill="#34A853" d="M24 48c6.5 0 11.9-2.1 15.9-5.8l-7.4-5.7c-2.1 1.4-4.8 2.3-8.5 2.3-6.2 0-11.5-4.2-13.4-9.9l-7.9 6.1C6.6 42.6 14.6 48 24 48z"/></svg>';
  var KAKAO_BUBBLE = '<svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><path fill="#191600" d="M12 3C6.5 3 2 6.6 2 11c0 2.8 1.9 5.3 4.7 6.7l-1 3.6c-.1.3.3.6.6.4l4.3-2.8c.5.1 1 .1 1.4.1 5.5 0 10-3.6 10-8S17.5 3 12 3z"/></svg>';

  var LOGIN_ERRORS = {
    cancelled: '로그인을 취소했어요.',
    expired: '로그인 시간이 지났어요. 다시 시도해 주세요.',
    failed: '로그인하지 못했어요. 잠시 뒤 다시 시도해 주세요.',
    already_linked: '그 계정은 이미 다른 사람과 이어져 있어요.',
  };

  function takeLoginError() {
    var m = /[?&]login=([a-z_]+)/.exec(location.search);
    if (!m) return null;
    try { history.replaceState(null, '', location.pathname + location.hash); } catch (e) { /* 무시 */ }
    return LOGIN_ERRORS[m[1]] || null;
  }

  function brandHtml(sub) {
    return '<div class="auth-brand"><span class="auth-mark" aria-hidden="true">🐾</span>' +
      '<h1>같이 걷고,<br>같이 남기는 여행</h1><p>' + esc(sub) + '</p></div>';
  }

  function showLogin(errorText) {
    var p = (AuthUI.me && AuthUI.me.providers) || { google: true, kakao: true };
    var g = ensureGate();
    g.setAttribute('aria-label', '로그인');
    g.innerHTML = '<div class="auth-card">' + brandHtml('일정 · 정산 · 사진을 함께 보려면 로그인해 주세요.') +
      (errorText ? '<p class="auth-err" role="alert">' + esc(errorText) + '</p>' : '') +
      '<div class="auth-buttons">' +
      (p.google ? '<a class="auth-sso google" href="' + API + '?action=login&amp;provider=google">' + GOOGLE_G + 'Google로 계속하기</a>' : '') +
      (p.kakao ? '<a class="auth-sso kakao" href="' + API + '?action=login&amp;provider=kakao">' + KAKAO_BUBBLE + '카카오로 계속하기</a>' : '') +
      '</div><p class="auth-fine">처음이면 계정이 바로 만들어지고, 여행 참여 코드를 한 번 입력해요.</p></div>';
    reveal();
  }

  var joinState = { code: '', options: null, busy: false, error: null };

  /** 참여 코드 → 이름 고르기. opts.tripTitle 이 있으면 "○○ 여행에 참여" 로 안내, opts.back 이면 "내 여행으로" 버튼 */
  function showJoin(opts) {
    if (opts) joinState.opts = opts;
    var o = joinState.opts || {};
    var g = ensureGate();
    g.setAttribute('aria-label', '여행 참여');
    var who = AuthUI.me && AuthUI.me.user && AuthUI.me.user.name;
    var body;
    if (!joinState.options) {
      body = '<form class="auth-form" data-join="code" autocomplete="off">' +
        '<label for="auth-code">여행 참여 코드</label>' +
        '<input id="auth-code" name="code" required value="' + esc(joinState.code) + '" placeholder="여행을 만든 사람에게 받은 코드" autocapitalize="off">' +
        '<button type="submit" class="auth-primary"' + (joinState.busy ? ' disabled' : '') + '>' + (joinState.busy ? '확인 중…' : '확인') + '</button></form>';
    } else {
      var list = joinState.options;
      body = '<form class="auth-form" data-join="pick" autocomplete="off"><fieldset><legend>이 여행에서 나는 누구예요?</legend>' +
        (list.length ? list.map(function (t, i) {
          return '<label class="auth-pick"><input type="radio" name="traveler" value="' + t.id + '"' + (i === 0 ? ' required' : '') + '><span>' + esc(t.name) + '</span></label>';
        }).join('') : '<p class="auth-fine">고를 수 있는 이름이 없어요. 아래에 새 이름을 적어 주세요.</p>') +
        '<label class="auth-pick"><input type="radio" name="traveler" value="new"' + (list.length ? '' : ' checked required') + '><span>목록에 없어요 · 새 이름으로 참여</span></label>' +
        '<input name="name" maxlength="40" placeholder="내 이름" class="auth-newname"' + (list.length ? ' hidden' : '') + (who ? ' value="' + esc(who) + '"' : '') + '>' +
        '</fieldset><p class="auth-fine">한 번 고르면 좋아요 · 댓글 · 사진이 이 이름으로 남아요. 이미 다른 계정이 고른 이름은 목록에 없어요.</p>' +
        '<button type="submit" class="auth-primary"' + (joinState.busy ? ' disabled' : '') + '>' + (joinState.busy ? '저장 중…' : '이 이름으로 참여') + '</button></form>';
    }
    var title = joinState.trip ? joinState.trip.title : o.tripTitle;
    g.innerHTML = '<div class="auth-card">' + brandHtml((who ? who + '님, ' : '') + (title ? '「' + title + '」에 참여할 차례예요.' : '여행에 참여할 차례예요.')) +
      (joinState.error ? '<p class="auth-err" role="alert">' + esc(joinState.error) + '</p>' : '') + body +
      (o.back ? '<button type="button" class="auth-link" data-auth="back">' + esc(o.back) + '</button>' : '') +
      '<button type="button" class="auth-link" data-auth="logout">다른 계정으로 로그인</button></div>';
    reveal();
    var first = g.querySelector('input:not([type=radio]):not([hidden])');
    if (first && !joinState.options) first.focus();
  }

  /** 로그인했지만 참여한 여행이 하나도 없을 때: 코드로 참여 / 새 여행 만들기 */
  function showStart() {
    var g = ensureGate();
    g.setAttribute('aria-label', '여행 시작');
    var who = AuthUI.me && AuthUI.me.user && AuthUI.me.user.name;
    g.innerHTML = '<div class="auth-card">' + brandHtml((who ? who + '님, ' : '') + '아직 참여한 여행이 없어요.') +
      '<div class="auth-buttons">' +
      '<button type="button" class="auth-primary" data-auth="join">참여 코드로 여행에 참여</button>' +
      '<button type="button" class="auth-sso google" data-auth="create">＋ 새 여행 만들기</button></div>' +
      '<p class="auth-fine">친구가 만든 여행이면 참여 코드를, 내가 계획하는 여행이면 새로 만들어 주세요.</p>' +
      '<button type="button" class="auth-link" data-auth="logout">다른 계정으로 로그인</button></div>';
    reveal();
  }

  function showCreate() {
    var g = ensureGate();
    g.setAttribute('aria-label', '새 여행 만들기');
    g.innerHTML = '<div class="auth-card">' + brandHtml('새 여행을 만들어요. 만든 사람이 관리자가 돼요.') +
      (window.TripUI ? window.TripUI.formHtml(null) : '') +
      '<button type="button" class="auth-link" data-auth="start">뒤로</button></div>';
    reveal();
    var first = g.querySelector('input');
    if (first) first.focus();
  }

  function onClick(e) {
    if (e.target.closest('[data-auth="logout"]')) { logout(); return; }
    if (e.target.closest('[data-auth="join"]')) { joinState = { code: '', options: null, busy: false, error: null }; showJoin({ back: '뒤로' }); return; }
    if (e.target.closest('[data-auth="create"]')) { showCreate(); return; }
    if (e.target.closest('[data-auth="start"]')) { showStart(); return; }
    if (e.target.closest('[data-auth="back"]')) {
      if (AuthUI.viewer) { closeGate(); reveal(); return; }
      if (AuthUI.me && AuthUI.me.tripCount) { location.href = location.pathname; } else { showStart(); }
      return;
    }
    var radio = e.target.closest('input[name="traveler"]');
    if (radio) {
      var nameInput = gate.querySelector('.auth-newname');
      if (nameInput) { nameInput.hidden = radio.value !== 'new'; if (!nameInput.hidden) nameInput.focus(); }
    }
  }

  function onSubmit(e) {
    var form = e.target;
    var kind = form.getAttribute('data-join');
    if (!kind) return;
    e.preventDefault();
    if (joinState.busy) return;
    joinState.error = null;
    if (kind === 'code') {
      joinState.code = form.code.value.trim();
      joinState.busy = true;
      showJoin();
      post('join-options', { code: joinState.code }).then(function (d) {
        joinState.options = d.travelers || [];
        joinState.trip = d.trip || null;
      }).catch(function (err) {
        joinState.error = err.message;
      }).then(function () { joinState.busy = false; showJoin(); });
      return;
    }
    var picked = form.querySelector('input[name="traveler"]:checked');
    if (!picked) { joinState.error = '이름을 하나 골라 주세요.'; showJoin(); return; }
    var body = { code: joinState.code };
    if (picked.value === 'new') {
      body.name = (form.name.value || '').trim();
      if (!body.name) { joinState.error = '새 이름을 적어 주세요.'; showJoin(); return; }
    } else {
      body.travelerId = Number(picked.value);
    }
    joinState.busy = true;
    showJoin();
    post('join', body).then(function (d) {
      location.href = location.pathname + '?trip=' + d.trip.id;
    }).catch(function (err) {
      joinState.busy = false;
      joinState.error = err.message;
      if (err.code === 'taken') {
        post('join-options', { code: joinState.code }).then(function (d) { joinState.options = d.travelers || []; showJoin(); });
      } else {
        showJoin();
      }
    });
  }

  function logout() {
    post('logout').catch(function () { /* 그래도 새로고침 */ }).then(function () { location.href = location.pathname; });
  }

  // ---------------------------------------------------------------------------
  // 참여자: 계정 정보 공개 · PC 상단 계정 표시
  // ---------------------------------------------------------------------------
  var PROVIDER_LABEL = { google: 'Google', kakao: '카카오' };

  function renderNavAccount() {
    var box = document.getElementById('nav-account');
    if (!box || !AuthUI.member) return;
    var who = AuthUI.member.traveler ? AuthUI.member.traveler.name : (AuthUI.member.user.name || '');
    box.innerHTML = '<span class="nav-me">' + esc(who) + '</span>' +
      '<button type="button" class="nav-logout" data-auth-logout>로그아웃</button>';
  }

  /** 프로필 탭 등에서 쓰는 계정 정보 HTML (mobile-shell.js 가 불러 씀). */
  AuthUI.accountHtml = function () {
    var m = AuthUI.member;
    if (!m) return '';
    var providers = (AuthUI.me && AuthUI.me.providers) || {};
    var rows = ['google', 'kakao'].filter(function (p) { return providers[p] || m.linked.indexOf(p) >= 0; }).map(function (p) {
      var on = m.linked.indexOf(p) >= 0;
      return '<div class="m-account"><span class="m-account-dot ' + p + '" aria-hidden="true">' + (p === 'google' ? 'G' : 'K') + '</span>' +
        PROVIDER_LABEL[p] + (on ? '<span class="m-account-state on">연결됨 ✓</span>'
          : '<a class="m-account-state" href="' + API + '?action=login&amp;provider=' + p + '&amp;link=1">연결하기 ›</a>') + '</div>';
    }).join('');
    return '<section class="m-block"><div class="m-block-head"><h2>로그인 계정</h2></div>' + rows +
      '<p class="m-note" style="margin:8px 0 0">둘 다 이어 두면 어느 쪽으로 로그인해도 같은 사람으로 들어와요.</p></section>';
  };

  AuthUI.logoutHtml = function () {
    return AuthUI.member ? '<section class="m-block"><button type="button" class="m-logout" data-auth-logout>로그아웃</button></section>' : '';
  };

  document.addEventListener('click', function (e) {
    if (e.target.closest('[data-auth-logout]')) logout();
  });

  /** 링크 공개 여행을 참여하지 않고 볼 때(로그인 전이거나, 로그인했지만 참여 안 함): 위쪽 안내 + 참여/로그인 버튼 */
  AuthUI.enterViewer = function () {
    AuthUI.viewer = true;
    if (document.querySelector('.auth-viewer-bar')) return;
    var loggedIn = !!(AuthUI.me && AuthUI.me.user);
    var bar = document.createElement('div');
    bar.className = 'auth-viewer-bar';
    bar.innerHTML = '<span>링크로 구경하는 중이에요 · 지출·정산·준비물과 좋아요·댓글·올리기는 참여한 사람만</span>' +
      '<button type="button" data-auth="' + (loggedIn ? 'viewer-join' : 'to-login') + '">' + (loggedIn ? '참여하기' : '로그인') + '</button>';
    bar.addEventListener('click', function (e) {
      if (e.target.closest('[data-auth="to-login"]')) showLogin();
      if (e.target.closest('[data-auth="viewer-join"]')) AuthUI.showJoin({ back: '구경 계속하기' });
    });
    document.body.prepend(bar);
  };

  /** 지금 여행에서의 나 (trip-context.js 가 여행을 불러온 뒤 알려 줌). traveler 가 없으면 구경만(링크 공개). */
  AuthUI.setMember = function (traveler) {
    if (!AuthUI.enabled || !AuthUI.me || !AuthUI.me.user) return;
    AuthUI.member = { user: AuthUI.me.user, linked: AuthUI.me.linked || [], traveler: traveler || null };
    closeGate();
    reveal();
    renderNavAccount();
    if (traveler) document.dispatchEvent(new CustomEvent('sosodobo:auth', { detail: AuthUI.member }));
  };
  AuthUI.showJoin = function (opts) { joinState = { code: '', options: null, busy: false, error: null }; showJoin(opts); };
  AuthUI.showStart = showStart;
  AuthUI.showLogin = function () { showLogin(); };
  AuthUI.reveal = reveal;

  function start() {
    (realFetch || fetch)(API + '?action=me', { credentials: 'same-origin' })
      .then(function (r) { return r.ok ? r.json() : { enabled: false }; })
      .catch(function () { return { enabled: false }; })
      .then(function (me) {
        AuthUI.me = me;
        AuthUI.enabled = !!me.enabled;
        if (!me.enabled) { reveal(); resolveReady(me); return; }
        var err = takeLoginError();
        if (!me.user) {
          // 로그인 전: 주소의 여행이 링크 공개면 구경(읽기)만 하게 두고, 아니면 로그인 화면
          var m = /[?&]trip=(\d+)/.exec(location.search);
          if (!m || err) { showLogin(err); return; }
          (realFetch || fetch)('api/trips?id=' + m[1]).then(function (r) { return r.ok ? r.json() : null; }).catch(function () { return null; })
            .then(function (d) {
              if (d && d.trip && d.trip.visibility === 'link') {
                AuthUI.viewer = true; // 배너는 trip-context 가 여행을 불러온 뒤 enterViewer 로
                reveal();
                resolveReady(me);
              } else {
                showLogin();
              }
            });
          return;
        }
        resolveReady(me);
      });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start);
  else start();
})();
