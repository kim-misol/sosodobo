/**
 * 지출 & 정산 + 준비물 메모 UI.
 *
 * 서버(/api/*)에서 여행자·지출·준비물 데이터를 불러오고, 정산 계산은 테스트된
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

  var state = {
    travelers: [],
    expenses: [],
    notes: [],
    loading: true,
    error: null,
    editingNoteId: null,     // 수정 중인 준비물 id
    editingExpenseId: null,  // 수정 중인 지출 id
  };

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
    noteList: null,
    noteForm: null,
    noteInput: null,
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

  function jsonOpts(method, payload) {
    return {
      method: method,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    };
  }

  async function load() {
    state.loading = true;
    render();
    try {
      var data = await api('/state');
      state.travelers = data.travelers || [];
      state.expenses = data.expenses || [];
      state.notes = data.notes || [];
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
    await api('/travelers', jsonOpts('POST', { name: name }));
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
    await api('/expenses', jsonOpts('POST', payload));
    await load();
  }

  async function updateExpense(id, payload) {
    await api('/expenses?id=' + id, jsonOpts('PATCH', payload));
    state.editingExpenseId = null;
    await load();
  }

  async function deleteExpense(id) {
    if (!confirm('이 지출 기록을 삭제할까요?')) return;
    await api('/expenses?id=' + id, { method: 'DELETE' });
    await load();
  }

  // ---- 준비물 메모 ----
  async function addNote(content) {
    await api('/notes', jsonOpts('POST', { content: content }));
    await load();
  }

  async function updateNote(id, content) {
    await api('/notes?id=' + id, jsonOpts('PATCH', { content: content }));
    state.editingNoteId = null;
    await load();
  }

  async function deleteNote(id) {
    if (!confirm('이 준비물 항목을 삭제할까요?')) return;
    await api('/notes?id=' + id, { method: 'DELETE' });
    await load();
  }

  // ---- 렌더링 ----
  function nameOf(id) {
    var t = state.travelers.find(function (x) { return x.id === id; });
    return t ? t.name : '(삭제됨)';
  }

  function payerOptionsHtml(selectedId) {
    return state.travelers.map(function (t) {
      var sel = t.id === selectedId ? ' selected' : '';
      return '<option value="' + t.id + '"' + sel + '>' + esc(t.name) + '</option>';
    }).join('');
  }

  function participantChecksHtml(selectedIds, name) {
    var set = {};
    (selectedIds || []).forEach(function (id) { set[id] = true; });
    return state.travelers.map(function (t) {
      var checked = set[t.id] ? ' checked' : '';
      return '<label class="st-check"><input type="checkbox" name="' + name + '" value="' + t.id + '"' + checked + '> ' + esc(t.name) + '</label>';
    }).join('');
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
    var payerOptions = payerOptionsHtml(null);
    var checks = participantChecksHtml(state.travelers.map(function (t) { return t.id; }), 'participant');

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
        '<div class="st-checks"><button type="button" class="st-linkbtn" data-toggle-all="participant">전체 선택/해제</button>' + checks + '</div>' +
      '</div>';
  }

  // 지출 한 건을 '보기' 모드로 렌더
  function expenseRowHtml(e) {
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
        '<button type="button" class="st-iconbtn" data-edit-expense="' + e.id + '" aria-label="지출 수정">✎</button>' +
        '<button type="button" class="st-chip-x" data-del-expense="' + e.id + '" aria-label="지출 삭제">×</button>' +
      '</div>' +
    '</div>';
  }

  // 지출 한 건을 '수정' 모드로 렌더 (인라인 편집 폼)
  function expenseEditHtml(e) {
    return '<div class="st-exp editing">' +
      '<div class="st-exp-edit">' +
        '<label class="st-label">지출 내용' +
        '<input type="text" class="st-e-desc" maxlength="60" value="' + esc(e.description) + '"></label>' +
        '<div class="st-row2">' +
          '<label class="st-label">금액(원)' +
          '<input type="number" class="st-e-amount" inputmode="numeric" min="1" step="1" value="' + e.amount + '"></label>' +
          '<label class="st-label">결제자' +
          '<select class="st-e-payer">' + payerOptionsHtml(e.payerId) + '</select></label>' +
        '</div>' +
        '<div class="st-label">함께 정산할 사람' +
          '<div class="st-checks"><button type="button" class="st-linkbtn" data-toggle-all="edit-participant">전체 선택/해제</button>' +
            participantChecksHtml(e.participantIds, 'edit-participant') + '</div>' +
        '</div>' +
        '<div class="st-edit-actions">' +
          '<button type="button" class="st-btn sm" data-save-expense="' + e.id + '">저장</button>' +
          '<button type="button" class="st-linkbtn" data-cancel-edit>취소</button>' +
        '</div>' +
      '</div>' +
    '</div>';
  }

  function renderExpenseList() {
    if (state.expenses.length === 0) {
      els.expenseList.innerHTML = '<p class="st-empty">기록된 지출이 없어요.</p>';
      return;
    }
    els.expenseList.innerHTML = state.expenses.map(function (e) {
      return e.id === state.editingExpenseId ? expenseEditHtml(e) : expenseRowHtml(e);
    }).join('');
  }

  function renderNotes() {
    if (state.notes.length === 0) {
      els.noteList.innerHTML = '<p class="st-empty">아직 준비물이 없어요. 아래에서 추가해 주세요.</p>';
      return;
    }
    els.noteList.innerHTML = state.notes.map(function (n) {
      if (n.id === state.editingNoteId) {
        return '<div class="st-note editing">' +
          '<input type="text" class="st-note-input" data-note-input="' + n.id + '" maxlength="200" value="' + esc(n.content) + '">' +
          '<div class="st-note-actions">' +
            '<button type="button" class="st-btn sm" data-save-note="' + n.id + '">저장</button>' +
            '<button type="button" class="st-linkbtn" data-cancel-edit>취소</button>' +
          '</div>' +
        '</div>';
      }
      return '<div class="st-note">' +
        '<div class="st-note-text">' + esc(n.content) + '</div>' +
        '<div class="st-note-actions">' +
          '<button type="button" class="st-iconbtn" data-edit-note="' + n.id + '" aria-label="수정">✎</button>' +
          '<button type="button" class="st-chip-x" data-del-note="' + n.id + '" aria-label="삭제">×</button>' +
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
        '<div class="st-bal-detail">지출 ' + won(b.paid) + ' · 몫 ' + won(b.owed) + '</div>' +
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
    renderNotes();
    renderResult();
  }

  // 수정 모드에서 지출 편집 폼 값을 읽어옵니다.
  function readExpenseEdit() {
    var box = els.expenseList;
    var descEl = box.querySelector('.st-e-desc');
    var amountEl = box.querySelector('.st-e-amount');
    var payerEl = box.querySelector('.st-e-payer');
    if (!descEl || !amountEl || !payerEl) return null;
    var participants = Array.prototype.slice
      .call(box.querySelectorAll('input[name="edit-participant"]:checked'))
      .map(function (c) { return parseInt(c.value, 10); });
    return {
      description: descEl.value.trim(),
      amount: parseInt(amountEl.value, 10),
      payerId: parseInt(payerEl.value, 10),
      participantIds: participants,
    };
  }

  function saveNoteFrom(id) {
    var input = els.noteList.querySelector('[data-note-input="' + id + '"]');
    if (!input) return;
    var content = input.value.trim();
    if (!content) { alert('준비물 내용을 입력해 주세요.'); return; }
    updateNote(id, content).catch(function (e) { alert(e.message); });
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

    els.noteForm.addEventListener('submit', function (ev) {
      ev.preventDefault();
      var content = els.noteInput.value.trim();
      if (!content) return;
      els.noteInput.value = '';
      addNote(content).catch(function (e) { alert(e.message); });
    });

    // 이벤트 위임: 각종 버튼 클릭
    els.root.addEventListener('click', function (ev) {
      var el = ev.target;
      var attr = function (name) { return el.getAttribute(name); };

      if (el.hasAttribute('data-del-traveler')) {
        deleteTraveler(parseInt(attr('data-del-traveler'), 10)).catch(function (e) { alert(e.message); });

      } else if (el.hasAttribute('data-del-expense')) {
        deleteExpense(parseInt(attr('data-del-expense'), 10)).catch(function (e) { alert(e.message); });
      } else if (el.hasAttribute('data-edit-expense')) {
        state.editingExpenseId = parseInt(attr('data-edit-expense'), 10);
        render();
      } else if (el.hasAttribute('data-save-expense')) {
        var payload = readExpenseEdit();
        if (!payload) return;
        if (!payload.description) { alert('지출 내용을 입력해 주세요.'); return; }
        if (!(payload.amount > 0)) { alert('금액을 올바르게 입력해 주세요.'); return; }
        if (payload.participantIds.length === 0) { alert('정산에 참여할 사람을 한 명 이상 선택해 주세요.'); return; }
        updateExpense(parseInt(attr('data-save-expense'), 10), payload).catch(function (e) { alert(e.message); });

      } else if (el.hasAttribute('data-edit-note')) {
        state.editingNoteId = parseInt(attr('data-edit-note'), 10);
        render();
        var input = els.noteList.querySelector('[data-note-input]');
        if (input) { input.focus(); input.setSelectionRange(input.value.length, input.value.length); }
      } else if (el.hasAttribute('data-save-note')) {
        saveNoteFrom(parseInt(attr('data-save-note'), 10));
      } else if (el.hasAttribute('data-del-note')) {
        deleteNote(parseInt(attr('data-del-note'), 10)).catch(function (e) { alert(e.message); });

      } else if (el.hasAttribute('data-cancel-edit')) {
        state.editingNoteId = null;
        state.editingExpenseId = null;
        render();
      } else if (el.hasAttribute('data-retry')) {
        load();
      } else if (el.hasAttribute('data-toggle-all')) {
        var group = attr('data-toggle-all');
        var boxes = els.root.querySelectorAll('input[name="' + group + '"]');
        var anyUnchecked = Array.prototype.some.call(boxes, function (b) { return !b.checked; });
        Array.prototype.forEach.call(boxes, function (b) { b.checked = anyUnchecked; });
      }
    });

    // 준비물 수정 입력창에서 Enter → 저장, Esc → 취소
    els.root.addEventListener('keydown', function (ev) {
      var el = ev.target;
      if (!el.hasAttribute || !el.hasAttribute('data-note-input')) return;
      if (ev.key === 'Enter') {
        ev.preventDefault();
        saveNoteFrom(parseInt(el.getAttribute('data-note-input'), 10));
      } else if (ev.key === 'Escape') {
        state.editingNoteId = null;
        render();
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
    els.noteList = $('#st-note-list', els.root);
    els.noteForm = $('#st-note-form', els.root);
    els.noteInput = $('#st-note-input', els.root);
    bind();
    load();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
