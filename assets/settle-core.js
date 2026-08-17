/**
 * 여행 지출 정산 계산 코어 (순수 함수).
 *
 * 서버/브라우저 어디서도 돌아가도록 DOM/네트워크에 의존하지 않게 짜서
 * node --test 로 단위 테스트할 수 있게 했습니다. (assets/carousel.js 와 동일한 방식)
 *
 * 원화(정수 원) 기준으로 계산합니다. 1원 단위 반올림 오차가 생기지 않도록
 * 나머지를 참여자에게 결정적으로(deterministic) 배분합니다.
 */

/**
 * 한 건의 지출을 참여자 수(n)로 1/N 분배한 결과를 정수 배열로 돌려줍니다.
 * 예) 10000원을 3명이 나누면 [3334, 3333, 3333] (합계는 정확히 원금과 일치).
 * 나머지 1원들은 앞쪽 참여자부터 한 명당 1원씩 얹습니다.
 */
function splitEqually(amount, n) {
  if (!Number.isInteger(amount) || amount < 0) {
    throw new RangeError('amount must be a non-negative integer');
  }
  if (!Number.isInteger(n) || n <= 0) {
    throw new RangeError('n must be a positive integer');
  }
  const base = Math.floor(amount / n);
  let remainder = amount - base * n; // 0..n-1
  const shares = [];
  for (let i = 0; i < n; i += 1) {
    shares.push(base + (remainder > 0 ? 1 : 0));
    if (remainder > 0) remainder -= 1;
  }
  return shares;
}

/**
 * 여행자별 순잔액(net balance)을 계산합니다.
 *   순잔액 = (내가 결제한 총액) - (내가 부담해야 할 총액)
 * 양수면 "돌려받을 돈", 음수면 "내야 할 돈".
 *
 * travelers: [{ id, name }]
 * expenses:  [{ id, description, amount, payerId, participantIds: [id, ...] }]
 *
 * 반환: [{ id, name, paid, owed, net }]  (travelers 순서 유지)
 * 참여자가 없는(=0명) 지출은 분배 대상이 없으므로 무시합니다.
 */
function computeBalances(travelers, expenses) {
  const paid = new Map();
  const owed = new Map();
  travelers.forEach((t) => {
    paid.set(t.id, 0);
    owed.set(t.id, 0);
  });

  expenses.forEach((exp) => {
    const participants = (exp.participantIds || []).filter((id) => owed.has(id));
    if (participants.length === 0) return;

    if (paid.has(exp.payerId)) {
      paid.set(exp.payerId, paid.get(exp.payerId) + exp.amount);
    }

    const shares = splitEqually(exp.amount, participants.length);
    participants.forEach((id, i) => {
      owed.set(id, owed.get(id) + shares[i]);
    });
  });

  return travelers.map((t) => {
    const p = paid.get(t.id);
    const o = owed.get(t.id);
    return { id: t.id, name: t.name, paid: p, owed: o, net: p - o };
  });
}

/**
 * 순잔액 목록을 받아 "누가 누구에게 얼마를 보내면 정산이 끝나는지"를
 * 최소에 가까운 이체 건수로 계산합니다(그리디: 가장 많이 낼 사람 ↔ 가장 많이 받을 사람 매칭).
 *
 * balances: [{ id, name, net }]
 * 반환: [{ fromId, fromName, toId, toName, amount }]
 */
function settleUp(balances) {
  const debtors = []; // net < 0 (내야 할 사람)
  const creditors = []; // net > 0 (받을 사람)
  balances.forEach((b) => {
    if (b.net < 0) debtors.push({ id: b.id, name: b.name, amount: -b.net });
    else if (b.net > 0) creditors.push({ id: b.id, name: b.name, amount: b.net });
  });

  // 금액 큰 순으로 정렬하면 이체 건수가 줄어드는 경향이 있습니다.
  debtors.sort((a, b) => b.amount - a.amount);
  creditors.sort((a, b) => b.amount - a.amount);

  const transfers = [];
  let i = 0;
  let j = 0;
  while (i < debtors.length && j < creditors.length) {
    const d = debtors[i];
    const c = creditors[j];
    const amount = Math.min(d.amount, c.amount);
    if (amount > 0) {
      transfers.push({
        fromId: d.id,
        fromName: d.name,
        toId: c.id,
        toName: c.name,
        amount,
      });
    }
    d.amount -= amount;
    c.amount -= amount;
    if (d.amount === 0) i += 1;
    if (c.amount === 0) j += 1;
  }
  return transfers;
}

const Settle = {
  splitEqually,
  computeBalances,
  settleUp,
};

// Node (tests, `require('../assets/settle-core.js')`) vs. browser (`<script src>`).
if (typeof module !== 'undefined' && module.exports) {
  module.exports = Settle;
}
if (typeof window !== 'undefined') {
  window.Settle = Settle;
}
