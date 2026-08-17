const test = require('node:test');
const assert = require('node:assert/strict');

const { splitEqually, computeBalances, settleUp } = require('../assets/settle-core.js');

test('splitEqually divides evenly when it divides cleanly', () => {
  assert.deepEqual(splitEqually(9000, 3), [3000, 3000, 3000]);
});

test('splitEqually pushes leftover won to the front participants', () => {
  // 10000 / 3 = 3333.33 → 3334 + 3333 + 3333, 합계는 정확히 10000
  assert.deepEqual(splitEqually(10000, 3), [3334, 3333, 3333]);
});

test('splitEqually always sums back to the original amount', () => {
  for (const [amount, n] of [[10000, 3], [17000, 4], [1, 3], [999999, 7], [0, 5]]) {
    const shares = splitEqually(amount, n);
    assert.equal(shares.length, n);
    assert.equal(shares.reduce((a, b) => a + b, 0), amount);
  }
});

test('splitEqually rejects invalid inputs', () => {
  assert.throws(() => splitEqually(1000, 0));
  assert.throws(() => splitEqually(-1, 3));
  assert.throws(() => splitEqually(1000.5, 3));
});

const travelers = [
  { id: 1, name: '가' },
  { id: 2, name: '나' },
  { id: 3, name: '다' },
];

test('computeBalances: single expense split among all', () => {
  // 가가 30000 결제, 셋이 1/N → 각자 10000 부담
  const balances = computeBalances(travelers, [
    { id: 10, amount: 30000, payerId: 1, participantIds: [1, 2, 3] },
  ]);
  assert.deepEqual(balances.map((b) => b.net), [20000, -10000, -10000]);
});

test('computeBalances: payer not among participants still credited', () => {
  // 가가 20000 결제하지만 정산 대상은 나·다 둘뿐
  const balances = computeBalances(travelers, [
    { id: 11, amount: 20000, payerId: 1, participantIds: [2, 3] },
  ]);
  const byId = Object.fromEntries(balances.map((b) => [b.id, b]));
  assert.equal(byId[1].net, 20000); // 낸 돈 전액 돌려받음
  assert.equal(byId[2].net, -10000);
  assert.equal(byId[3].net, -10000);
});

test('computeBalances: net balances always sum to zero', () => {
  const balances = computeBalances(travelers, [
    { id: 1, amount: 10000, payerId: 1, participantIds: [1, 2, 3] },
    { id: 2, amount: 17000, payerId: 2, participantIds: [1, 2] },
    { id: 3, amount: 5500, payerId: 3, participantIds: [2, 3] },
  ]);
  assert.equal(balances.reduce((a, b) => a + b.net, 0), 0);
});

test('computeBalances: expense with no participants is ignored', () => {
  const balances = computeBalances(travelers, [
    { id: 1, amount: 10000, payerId: 1, participantIds: [] },
  ]);
  assert.deepEqual(balances.map((b) => b.net), [0, 0, 0]);
});

test('settleUp: produces transfers that zero everyone out', () => {
  const balances = computeBalances(travelers, [
    { id: 1, amount: 30000, payerId: 1, participantIds: [1, 2, 3] },
    { id: 2, amount: 9000, payerId: 2, participantIds: [1, 2, 3] },
  ]);
  const transfers = settleUp(balances);

  // 이체를 적용한 뒤 모두의 net 이 0 이 되어야 함
  const net = Object.fromEntries(balances.map((b) => [b.id, b.net]));
  transfers.forEach((t) => {
    assert.ok(t.amount > 0);
    net[t.fromId] += t.amount; // 낼 사람이 돈을 보내면 그만큼 잔액 회복
    net[t.toId] -= t.amount;
  });
  Object.values(net).forEach((v) => assert.equal(v, 0));
});

test('settleUp: minimal case is a single transfer', () => {
  const transfers = settleUp([
    { id: 1, name: '가', net: 10000 },
    { id: 2, name: '나', net: -10000 },
  ]);
  assert.equal(transfers.length, 1);
  assert.deepEqual(
    { from: transfers[0].fromId, to: transfers[0].toId, amount: transfers[0].amount },
    { from: 2, to: 1, amount: 10000 },
  );
});

test('settleUp: everyone settled returns no transfers', () => {
  assert.deepEqual(settleUp([
    { id: 1, name: '가', net: 0 },
    { id: 2, name: '나', net: 0 },
  ]), []);
});
