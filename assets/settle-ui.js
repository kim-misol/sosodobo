/**
 * 지출 & 정산 UI.
 *
 * 서버(/api/*)에서 여행자·지출 데이터를 불러오고, 정산 계산은 테스트된
 * settle-core.js(window.Settle)로 처리합니다. 순수 계산 로직은 여기 두지 않아요.
 */
(function () {
  'use strict';

  var $ = function (sel, root) { return (root || document).querySelector(sel); };
  var API = 'api';

  // 원화 표기: 12345 → "12,345원"
  function won(n) { return Number(n).toLocaleString('ko-KR') + '원'; }

  // 간단한 안전 텍스트 삽입용 (사용자 입력 이름/내용을 HTML로 넣지 않도록)
  function esc(s) {
    return String(s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  var state = { travelers: [], expenses: [], loading: true, error: null };

  var els = {
    root: null,
    status: null,
    travelerList: null,
    travelerForm: null,
    travelerName: null,
    expenseForm: null,
    expenseFields: null,
    expenseList: null,
    result: null,
  };

  async function api(path, options) {
    var res = await fetch(API + path, options);
    var data = null;
    try { data = await res.json(); } catch (e) { /* no body */ }
    if (!res.ok) {
      throw new Error((data && data.error) || ('요청 실패 (' + res.status + ')'));
    }
    return data;
  }

  async function load() {
    state.loading = true;
    render();
    try {
      var data = await api('/state');
      state.travelers = data.travelers || [];
      state.expenses = data.expenses || [];
      state.error = null;
    } catch (err) {
      state.error = err.message;
    } finally {
      state.loading = false;
      render();
    }
  }

  // ---- 여행자 ----
  async function addTraveler(name) {
    await api('/travelers', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: name }),
    });
    await load();
  }

  async function deleteTraveler(id) {
    var t = state.travelers.find(function (x) { return x.id === id; });
    if (!confirm('‘' + (t ? t.name : '') + '’ 여행자를 삭제할까요?\n이 사람이 결제했거나 참여한 지출 기록도 함께 정리됩니다.')) return;
    await api('/travelers?id=' + id, { method: 'DELETE' });
    await load();
  }

  // ---- 지출 ----
  async function addExpense(payload) {
    await api('/expenses', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    await load();
  }

  async function deleteExpense(id) {
    if (!confirm('이 지출 기록을 삭제할까요?')) return;
    await api('/expenses?id=' + id, { method: 'DELETE' });
    await load();
  }

  // ---- 렌더링 ----
  function nameOf(id) {
    var t = state.travelers.find(function (x) { return x.id === id; });
    return t ? t.name : '(삭제됨)';
  }

  function renderTravelers() {
    if (state.travelers.length === 0) {
      els.travelerList.innerHTML = '<p class="st-empty">아직 여행자가 없어요. 이름을 추가해 주세요.</p>';
      return;
    }
    els.travelerList.innerHTML = state.travelers.map(function (t) {
      return '<span class="st-chip">' + esc(t.name) +
        '<button type="button" class="st-chip-x" data-del-traveler="' + t.id + '" aria-label="' + esc(t.name) + ' 삭제">×</button></span>';
    }).join('');
  }

  function renderExpenseForm() {
    if (state.travelers.length < 1) {
      els.expenseFields.innerHTML = '<p class="st-empty">여행자를 먼저 추가하면 지출을 기록할 수 있어요.</p>';
      els.expenseForm.querySelector('button[type="submit"]').disabled = true;
      return;
    }
    els.expenseForm.querySelector('button[type="submit"]').disabled = false;
    var payerOptions = state.travelers.map(function (t) {
      return '<option value="' + t.id + '">' + esc(t.name) + '</option>';
    }).join('');
    var checks = state.travelers.map(function (t) {
      return '<label class="st-check"><input type="checkbox" name="participant" value="' + t.id + '" checked> ' + esc(t.name) + '</label>';
    }).join('');

    els.expenseFields.innerHTML =
      '<label class="st-label">지출 내용' +
      '<input type="text" name="description" placeholder="예: 첫째 날 저녁, 택시비" maxlength="60" required></label>' +
      '<div class="st-row2">' +
        '<label class="st-label">금액(원)' +
        '<input type="number" name="amount" inputmode="numeric" min="1" step="1" placeholder="0" required></label>' +
        '<label class="st-label">결제자' +
        '<select name="payer" required>' + payerOptions + '</select></label>' +
      '</div>' +
      '<div class="st-label">함께 정산할 사람 (선택한 인원끼리 1/N)' +
        '<div class="st-checks"><button type="button" class="st-linkbtn" data-toggle-all>전체 선택/해제</button>' + checks + '</div>' +
      '</div>';
  }

  function renderExpenseList() {
    if (state.expenses.length === 0) {
      els.expenseList.innerHTML = '<p class="st-empty">기록된 지출이 없어요.</p>';
      return;
    }
    els.expenseList.innerHTML = state.expenses.map(function (e) {
      var who = e.participantIds.map(nameOf).join(', ');
      var perName = e.participantIds.length
        ? ' · 1인 ' + won(Math.floor(e.amount / e.participantIds.length))
        : '';
      return '<div class="st-exp">' +
        '<div class="st-exp-main">' +
          '<div class="st-exp-desc">' + esc(e.description) + '</div>' +
          '<div class="st-exp-sub">💳 ' + esc(nameOf(e.payerId)) + ' 결제 · 👥 ' + esc(who) + perName + '</div>' +
        '</div>' +
        '<div class="st-exp-amt">' + won(e.amount) +
          '<button type="button" class="st-chip-x" data-del-expense="' + e.id + '" aria-label="지출 삭제">×</button>' +
        '</div>' +
      '</div>';
    }).join('');
  }

  function renderResult() {
    if (state.travelers.length === 0 || state.expenses.length === 0) {
      els.result.innerHTML = '<p class="st-empty">여행자와 지출을 입력하면 여기서 정산 결과를 볼 수 있어요.</p>';
      return;
    }
    var balances = window.Settle.computeBalances(state.travelers, state.expenses);
    var transfers = window.Settle.settleUp(balances);
    var total = state.expenses.reduce(function (a, e) { return a + e.amount; }, 0);

    var perPerson = balances.map(function (b) {
      var cls = b.net > 0 ? 'pos' : (b.net < 0 ? 'neg' : 'zero');
      var label = b.net > 0 ? ('+' + won(b.net) + ' 받을 돈')
        : (b.net < 0 ? (won(-b.net) + ' 낼 돈') : '정산 완료');
      return '<div class="st-bal">' +
        '<div class="st-bal-name">' + esc(b.name) + '</div>' +
        '<div class="st-bal-detail">낸 돈 ' + won(b.paid) + ' · 쓸 몫 ' + won(b.owed) + '</div>' +
        '<div class="st-bal-net ' + cls + '">' + label + '</div>' +
      '</div>';
    }).join('');

    var transferHtml = transfers.length
      ? transfers.map(function (t) {
          return '<div class="st-transfer"><b>' + esc(t.fromName) + '</b> → <b>' + esc(t.toName) + '</b>' +
            '<span class="st-transfer-amt">' + won(t.amount) + '</span></div>';
        }).join('')
      : '<p class="st-empty">서로 주고받을 금액이 없어요. 정산 완료!</p>';

    els.result.innerHTML =
      '<div class="st-total">총 지출 <b>' + won(total) + '</b></div>' +
      '<div class="st-bals">' + perPerson + '</div>' +
      '<h4 class="st-sub-h">💸 이렇게 보내면 정산 끝</h4>' +
      '<div class="st-transfers">' + transferHtml + '</div>';
  }

  function render() {
    if (state.loading) {
      els.status.textContent = '불러오는 중…';
      els.status.className = 'st-status loading';
      els.status.style.display = 'block';
      return;
    }
    if (state.error) {
      els.status.innerHTML = '⚠️ ' + esc(state.error) +
        '<button type="button" class="st-linkbtn" data-retry>다시 시도</button>';
      els.status.className = 'st-status error';
      els.status.style.display = 'block';
    } else {
      els.status.style.display = 'none';
    }
    renderTravelers();
    renderExpenseForm();
    renderExpenseList();
    renderResult();
  }

  function bind() {
    els.travelerForm.addEventListener('submit', function (ev) {
      ev.preventDefault();
      var name = els.travelerName.value.trim();
      if (!name) return;
      els.travelerName.value = '';
      addTraveler(name).catch(function (e) { alert(e.message); });
    });

    els.expenseForm.addEventListener('submit', function (ev) {
      ev.preventDefault();
      var f = els.expenseForm;
      var participants = Array.prototype.slice
        .call(f.querySelectorAll('input[name="participant"]:checked'))
        .map(function (c) { return parseInt(c.value, 10); });
      if (participants.length === 0) { alert('정산에 참여할 사람을 한 명 이상 선택해 주세요.'); return; }
      var payload = {
        description: f.description.value.trim(),
        amount: parseInt(f.amount.value, 10),
        payerId: parseInt(f.payer.value, 10),
        participantIds: participants,
      };
      if (!payload.description) { alert('지출 내용을 입력해 주세요.'); return; }
      if (!(payload.amount > 0)) { alert('금액을 올바르게 입력해 주세요.'); return; }
      addExpense(payload).then(function () {
        f.description.value = '';
        f.amount.value = '';
      }).catch(function (e) { alert(e.message); });
    });

    // 이벤트 위임: 삭제/토글/재시도 버튼
    els.root.addEventListener('click', function (ev) {
      var el = ev.target;
      if (el.hasAttribute('data-del-traveler')) {
        deleteTraveler(parseInt(el.getAttribute('data-del-traveler'), 10)).catch(function (e) { alert(e.message); });
      } else if (el.hasAttribute('data-del-expense')) {
        deleteExpense(parseInt(el.getAttribute('data-del-expense'), 10)).catch(function (e) { alert(e.message); });
      } else if (el.hasAttribute('data-retry')) {
        load();
      } else if (el.hasAttribute('data-toggle-all')) {
        var boxes = els.expenseForm.querySelectorAll('input[name="participant"]');
        var anyUnchecked = Array.prototype.some.call(boxes, function (b) { return !b.checked; });
        Array.prototype.forEach.call(boxes, function (b) { b.checked = anyUnchecked; });
      }
    });
  }

  function init() {
    els.root = $('#settle');
    if (!els.root || !window.Settle) return;
    els.status = $('#st-status', els.root);
    els.travelerList = $('#st-traveler-list', els.root);
    els.travelerForm = $('#st-traveler-form', els.root);
    els.travelerName = $('#st-traveler-name', els.root);
    els.expenseForm = $('#st-expense-form', els.root);
    els.expenseFields = $('#st-expense-fields', els.root);
    els.expenseList = $('#st-expense-list', els.root);
    els.result = $('#st-result', els.root);
    bind();
    load();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
