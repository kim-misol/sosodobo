/**
 * 폰(폭 768px 미만)에서만 쓰는 앱 모양: 위쪽 여행 바, 하단 탭(홈 · 사진첩 · 📷 · 사람 · 프로필),
 * 사람 탭과 프로필 탭 화면. PC 에서는 아무것도 보이지 않아요 (CSS 가 .m-only 를 숨김).
 *
 * 어떤 탭을 보여줄지는 <body data-mtab="..."> 하나로 정하고, 어느 요소가 어느 탭에 속하는지는
 * index.html 의 data-m 속성으로 표시합니다. 처음 탭은 <head> 의 짧은 스크립트가 미리 정해 깜빡임을 막아요.
 *
 * 필요 전역: ShellCore, TripPlaces, PhotoUI, SettleUI, Settle
 */
(function () {
  'use strict';

  var SC = window.ShellCore;
  // 주소에 처음부터 #탭이 있었는지 (없으면 여행을 불러온 뒤 그 여행 기준 처음 탭으로 바꿈)
  var hashTabAtLoad = window.ShellCore ? window.ShellCore.tabFromHash(location.hash) : null;
  var $ = function (sel, root) { return (root || document).querySelector(sel); };
  var scrollByTab = {};
  var els = {};

  function esc(s) {
    return String(s === null || s === undefined ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function won(n) { return Number(n).toLocaleString('ko-KR') + '원'; }

  function trip() { return window.TripPlaces || {}; }
  function tripDays() { return (window.PhotoCore && window.PhotoCore.LIMITS.tripDays) || 3; }
  function photoState() { return (window.PhotoUI && window.PhotoUI.state) || { photos: [], travelers: [], me: null }; }
  function settleState() { return (window.SettleUI && window.SettleUI.state) || { travelers: [], expenses: [], loading: true }; }

  /** 여행자 목록: 정산 쪽이 원본, 아직 안 불러왔으면 사진 쪽 목록으로. */
  function travelers() {
    var s = settleState();
    return s.travelers.length ? s.travelers : photoState().travelers;
  }

  var AVATAR_COLORS = ['#c2703f', '#2f5233', '#4e6f8f', '#8a6aa0', '#a0763a', '#3f7f7a', '#9a4f5c'];
  function avatar(id, name, cls) {
    var color = Number.isInteger(id) ? AVATAR_COLORS[Math.abs(id) % AVATAR_COLORS.length] : '#9a917c';
    return '<span class="m-avatar ' + (cls || '') + '" style="background:' + color + '">' + esc(String(name || '?').slice(0, 1)) + '</span>';
  }

  function statusText() {
    var st = SC.tripStatus(trip().TRIP_START_DATE, tripDays(), Date.now());
    var count = photoState().photos.length;
    if (st.phase === 'before') return st.days ? '출발까지 ' + st.days + '일' : '출발 전';
    if (st.phase === 'during') return '여행 중 · ' + st.day + '일차';
    return '여행 끝' + (count ? ' · 사진 ' + count + '장이 모였어요' : '');
  }

  // ---------------------------------------------------------------------------
  // 탭
  // ---------------------------------------------------------------------------
  function isPhone() { return !!(window.matchMedia && window.matchMedia('(max-width: 767px)').matches); }

  function currentTab() { return document.body.getAttribute('data-mtab') || 'home'; }

  function setTab(tab, opts) {
    var prev = currentTab();
    if (prev !== tab) scrollByTab[prev] = window.scrollY;
    document.body.setAttribute('data-mtab', tab);
    if (isPhone()) {
      try { history.replaceState(null, '', '#' + tab); } catch (e) { /* file:// 등 */ }
    }
    renderChrome();
    if (tab === 'people') renderPeople();
    if (tab === 'profile') renderProfile();
    if (!(opts && opts.keepScroll)) window.scrollTo(0, prev === tab ? 0 : (scrollByTab[tab] || 0));
  }

  var ICONS = {
    home: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round" aria-hidden="true"><path d="M4 10.5 12 4l8 6.5V20a1 1 0 0 1-1 1h-4.5v-6h-5v6H5a1 1 0 0 1-1-1z"/></svg>',
    photos: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round" aria-hidden="true"><rect x="3.5" y="4.5" width="17" height="15" rx="3"/><path d="m4 16 4.5-4.5 3.5 3.5 2.5-2.5L20 17"/><circle cx="15.5" cy="9" r="1.5"/></svg>',
    people: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" aria-hidden="true"><circle cx="9" cy="8.5" r="3.2"/><path d="M3.5 19c.6-3.2 2.8-5 5.5-5s4.9 1.8 5.5 5"/><circle cx="16.8" cy="9.2" r="2.5"/><path d="M16.5 14c2.2.2 3.6 1.8 4 4.5"/></svg>',
    profile: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true"><circle cx="12" cy="12" r="8.5"/><circle cx="12" cy="10" r="3"/><path d="M6.5 18c1.3-2 3.2-3 5.5-3s4.2 1 5.5 3"/></svg>',
    camera: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linejoin="round" aria-hidden="true"><path d="M4 8.5a2 2 0 0 1 2-2h2l1.5-2h5L16 6.5h2a2 2 0 0 1 2 2V18a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2z"/><circle cx="12" cy="13" r="3.6"/></svg>',
  };
  var TABS = [['home', '홈'], ['photos', '사진첩'], ['camera', ''], ['people', '사람'], ['profile', '프로필']];

  function renderChrome() {
    var tab = currentTab();
    var t = trip();
    var n = travelers().length;
    els.top.innerHTML = tab === 'profile'
      ? '<div class="m-top-title"><b>프로필</b><span>나와 내 여행</span></div>'
      : '<button type="button" class="m-top-title m-switch" data-m-switch aria-label="여행 바꾸기"><b>' + esc(t.TRIP_TITLE || '우리 여행') + '</b><span>' +
        esc(SC.dateRangeLabel(t.TRIP_START_DATE, tripDays())) + (n ? ' · ' + n + '명' : '') + '</span></button>';
    els.tabbar.innerHTML = TABS.map(function (x) {
      if (x[0] === 'camera') {
        return '<button type="button" class="m-fab" data-m-upload aria-label="사진·영상 올리기">' + ICONS.camera + '</button>';
      }
      return '<button type="button" role="tab" data-m-tab="' + x[0] + '" aria-selected="' + (tab === x[0]) + '">' + ICONS[x[0]] + '<span>' + x[1] + '</span></button>';
    }).join('');
    if (els.status) els.status.textContent = statusText();
    document.documentElement.style.setProperty('--m-top-h', els.top.offsetHeight + 'px');
  }

  // ---------------------------------------------------------------------------
  // 사람 탭
  // ---------------------------------------------------------------------------
  /**
   * 함께 가는 사람 목록 (사진 수 · 결제 금액 · 관리자 · 추가/빼기).
   * 폰의 "사람" 탭과 PC 의 "여행자" 칸이 같은 내용을 씀 — idPrefix 로 입력칸 id 를 나눔.
   */
  function peopleHtml(idPrefix, compact) {
    var list = travelers();
    var me = photoState().me;
    var s = settleState();
    var paid = {};
    if (window.Settle && s.expenses.length) {
      window.Settle.computeBalances(list, s.expenses).forEach(function (b) { paid[b.id] = b.paid; });
    }
    var photos = {};
    photoState().photos.forEach(function (p) { photos[p.uploaderId] = (photos[p.uploaderId] || 0) + 1; });

    var manage = !window.SettleUI || !window.SettleUI.canManagePeople || window.SettleUI.canManagePeople();
    var rows = list.length ? list.map(function (t) {
      var bits = [(photos[t.id] ? '사진 ' + photos[t.id] + '장' : '사진 없음'), (paid[t.id] ? '결제 ' + won(paid[t.id]) : '결제 없음')];
      return '<div class="m-person">' + avatar(t.id, t.name) +
        '<div class="t"><b>' + esc(t.name) + (t.id === me ? ' <span class="m-chip">나</span>' : '') +
        (t.role === 'admin' ? ' <span class="m-chip line">관리자</span>' : '') + '</b><span>' + bits.join(' · ') + '</span></div>' +
        (manage && !(t.role === 'admin' && t.hasAccount)
          ? '<button type="button" class="m-textbtn" data-m-remove="' + t.id + '" aria-label="' + esc(t.name) + ' 여행에서 빼기">빼기</button>' : '') + '</div>';
    }).join('') : '<p class="m-empty">' + (s.loading ? '불러오는 중…' : '아직 등록된 사람이 없어요. 아래에서 이름을 추가해 주세요.') + '</p>';

    var addForm = manage ? '<form class="m-add" data-m-add autocomplete="off"><label class="m-sr" for="' + idPrefix + '-add-name">이름</label>' +
        '<input id="' + idPrefix + '-add-name" name="name" maxlength="40" placeholder="이름 추가 (예: 수진)" required>' +
        '<button type="submit">추가</button></form>' : '<p class="m-note" style="margin:8px 0 0">사람 추가·빼기는 여행 관리자만 할 수 있어요.</p>';
    var invite = '<div class="m-invite"><span class="m-invite-ico" aria-hidden="true">🔗</span><div><b>초대 링크로 부르기</b>' +
      '<span>링크를 받은 사람이 로그인하면 바로 합류 · 준비 중</span></div></div>';
    var note = '<p class="m-note">계정이 없어도 이름만으로 추가할 수 있어요. 지출 기록에 들어 있는 사람은 정산이 달라지기 때문에 뺄 수 없어요.</p>';
    if (compact) {
      return '<div class="pc-people-list">' + rows + '</div>' + addForm + '<div class="pc-people-foot">' + invite + note + '</div>';
    }
    return '<section class="m-block"><div class="m-block-head"><h2>함께 가는 사람 <span class="m-muted">' + list.length + '명</span></h2></div>' +
      '<div>' + rows + '</div>' + addForm + '</section>' +
      '<section class="m-block">' + invite + '</section>' + note;
  }

  function renderPeople() {
    els.people.innerHTML = peopleHtml('m', false);
  }

  /** PC: 정산 칸의 여행자 목록도 같은 내용으로 (입력 중이면 그대로 둠) */
  function renderPcPeople() {
    if (!els.pcPeople) return;
    var active = document.activeElement;
    if (active && els.pcPeople.contains(active) && active.value) return;
    els.pcPeople.innerHTML = peopleHtml('pc', true);
  }

  async function addPerson(form) {
    var name = form.name.value.trim();
    if (!name) return;
    var btn = form.querySelector('button');
    btn.disabled = true;
    try {
      await window.SettleUI.addTraveler(name);
      if (window.PhotoUI) window.PhotoUI.load({ quiet: true });
      form.name.value = '';
    } catch (err) {
      alert(err.message);
    } finally {
      btn.disabled = false;
    }
  }

  async function removePerson(id) {
    try {
      await window.SettleUI.deleteTraveler(id);
      if (window.PhotoUI) window.PhotoUI.load({ quiet: true });
    } catch (err) {
      alert(err.message);
    }
  }

  // ---------------------------------------------------------------------------
  // 프로필 탭
  // ---------------------------------------------------------------------------
  function renderProfile() {
    var list = travelers();
    var me = photoState().me;
    var mine = list.find(function (t) { return t.id === me; });
    var t = trip();
    var st = SC.tripStatus(t.TRIP_START_DATE, tripDays(), Date.now());
    var chip = st.phase === 'after' ? '지난 여행' : st.phase === 'during' ? '여행 중' : '다가오는 여행';
    var select = '<select id="m-me" aria-label="나는 누구?"><option value="">나는 누구?</option>' + list.map(function (x) {
      return '<option value="' + x.id + '"' + (x.id === me ? ' selected' : '') + '>' + esc(x.name) + '</option>';
    }).join('') + '</select>';

    var auth = window.AuthUI && window.AuthUI.member;
    var meBlock = auth
      ? '<section class="m-block m-me">' + avatar(auth.traveler.id, auth.traveler.name, 'lg') +
        '<div class="t"><b>' + esc(auth.traveler.name) + '</b><span class="m-muted">' +
        esc(auth.user.email || auth.user.name || '') + '</span></div></section>' + window.AuthUI.accountHtml()
      : '<section class="m-block m-me">' + (mine ? avatar(mine.id, mine.name, 'lg') : '<span class="m-avatar lg empty">?</span>') +
        '<div class="t"><b>' + (mine ? esc(mine.name) : '아직 누군지 몰라요') + '</b>' +
        '<label class="m-field" for="m-me">나는 누구?' + select + '</label></div></section>' +
        '<p class="m-note">좋아요 · 댓글 · 사진 올리기는 여기서 고른 이름으로 남아요.</p>';
    els.profile.innerHTML = meBlock +
      '<section class="m-block"><div class="m-block-head"><h2>내 여행</h2></div>' +
      (window.TripUI && window.TripContext && window.TripContext.trips
        ? window.TripUI.tripListHtml(window.TripContext.trips, 'manage')
        : '<p class="m-empty">불러오는 중…</p>') +
      '<div class="tui-actions" style="margin-top:10px"><button type="button" class="tui-btn primary" data-tui="create">＋ 새 여행 만들기</button>' +
      (window.AuthUI && window.AuthUI.enabled ? '<button type="button" class="tui-btn" data-tui="join">참여 코드로 참여</button>' : '') + '</div></section>' +
      (auth ? window.AuthUI.logoutHtml() : '');
  }

  // ---------------------------------------------------------------------------
  // 연결
  // ---------------------------------------------------------------------------
  function bind() {
    els.top.addEventListener('click', function (e) {
      if (e.target.closest('[data-m-switch]') && window.TripUI) window.TripUI.openSwitcher();
    });
    els.tabbar.addEventListener('click', function (e) {
      if (e.target.closest('[data-m-upload]')) {
        setTab('photos');
        if (window.PhotoUI) window.PhotoUI.pickFiles();
        return;
      }
      var b = e.target.closest('[data-m-tab]');
      if (b) setTab(b.getAttribute('data-m-tab'));
    });
    [els.people, els.pcPeople].filter(Boolean).forEach(function (box) {
      box.addEventListener('submit', function (e) {
        if (!e.target.matches('[data-m-add]')) return;
        e.preventDefault();
        addPerson(e.target);
      });
      box.addEventListener('click', function (e) {
        var b = e.target.closest('[data-m-remove]');
        if (b) removePerson(Number(b.getAttribute('data-m-remove')));
      });
    });
    els.profile.addEventListener('change', function (e) {
      if (e.target.id !== 'm-me' || !window.PhotoUI) return;
      var v = parseInt(e.target.value, 10);
      window.PhotoUI.setMe(Number.isInteger(v) ? v : null);
    });

    // 데이터가 바뀌면 지금 보이는 탭만 다시 그립니다 (입력 중인 칸은 건드리지 않게).
    function refresh() {
      renderChrome();
      var active = document.activeElement;
      var typing = active && active.matches && active.matches('input, select, textarea');
      if (currentTab() === 'people' && !(typing && els.people.contains(active))) renderPeople();
      if (currentTab() === 'profile' && !(typing && els.profile.contains(active))) renderProfile();
      renderPcPeople();
    }
    if (window.PhotoUI && window.PhotoUI.onChange) window.PhotoUI.onChange(refresh);
    if (window.SettleUI && window.SettleUI.onChange) window.SettleUI.onChange(refresh);
    document.addEventListener('sosodobo:auth', refresh);
    // 여행을 불러오면: 주소에 #탭이 없으면 그 여행 기준 처음 탭(끝난 여행은 사진첩), 프로필의 여행 목록도 불러오기
    document.addEventListener('sosodobo:trip', function (e) {
      var t = e.detail;
      if (!hashTabAtLoad) setTab(SC.defaultTab(SC.tripPhase(t.startDate, t.days, Date.now())), { keepScroll: true });
      else refresh();
      if (window.TripContext) window.TripContext.loadTrips().then(refresh);
    });
    window.addEventListener('resize', function () {
      document.documentElement.style.setProperty('--m-top-h', els.top.offsetHeight + 'px');
    });
  }

  function init() {
    els.top = $('#m-top');
    els.tabbar = $('#m-tabbar');
    els.people = $('#m-people');
    els.profile = $('#m-profile');
    els.status = $('#m-trip-status');
    els.pcPeople = $('#pc-people');
    if (!els.top || !els.tabbar || !SC) return;
    bind();
    setTab(currentTab(), { keepScroll: true });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
