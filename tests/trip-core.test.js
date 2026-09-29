const test = require('node:test');
const assert = require('node:assert/strict');
const T = require('../assets/trip-core.js');

const base = { title: '제주 올레 7코스', region: '제주 서귀포', startDate: '2026-11-14', endDate: '2026-11-16' };

test('tripDays: 둘 다 포함한 일수, 없는 날짜는 NaN', () => {
  assert.equal(T.tripDays('2026-09-24', '2026-09-26'), 3);
  assert.equal(T.tripDays('2026-12-31', '2027-01-01'), 2);
  assert.equal(T.tripDays('2028-02-28', '2028-03-01'), 3); // 윤년
  assert.ok(Number.isNaN(T.tripDays('2026-02-30', '2026-03-01')));
});

test('validateTrip: 필수값 · 길이 · 기간 1~90일 · 공개 값', () => {
  const ok = T.validateTrip(Object.assign({}, base, { summary: '  바다 따라 걷기 ' }));
  assert.deepEqual(ok.value, Object.assign({}, base, { summary: '바다 따라 걷기', visibility: 'private', membersCanEdit: true }));
  assert.match(T.validateTrip(Object.assign({}, base, { title: ' ' })).error, /여행 이름/);
  assert.match(T.validateTrip(Object.assign({}, base, { region: '' })).error, /지역/);
  assert.match(T.validateTrip(Object.assign({}, base, { endDate: '2026-11-13' })).error, /시작일과 같거나 뒤/);
  assert.equal(T.validateTrip(Object.assign({}, base, { endDate: '2026-11-14' })).value.endDate, '2026-11-14'); // 당일치기
  assert.equal(T.validateTrip(Object.assign({}, base, { startDate: '2026-01-01', endDate: '2026-03-31' })).error, undefined); // 90일
  assert.match(T.validateTrip(Object.assign({}, base, { startDate: '2026-01-01', endDate: '2026-04-01' })).error, /최대 90일/);
  assert.match(T.validateTrip(Object.assign({}, base, { visibility: 'public' })).error, /공개 설정/);
  assert.match(T.validateTrip(Object.assign({}, base, { title: 'x'.repeat(41) })).error, /40자/);
});

test('validateTrip partial: 들어온 항목만, 날짜 하나만 바꿔도 다른 쪽은 지금 값으로 확인', () => {
  const current = { startDate: '2026-09-24', endDate: '2026-09-26' };
  assert.deepEqual(T.validateTrip({ visibility: 'link' }, { partial: true, current }).value, { visibility: 'link' });
  assert.deepEqual(T.validateTrip({ membersCanEdit: false }, { partial: true, current }).value, { membersCanEdit: false });
  assert.deepEqual(T.validateTrip({ endDate: '2026-09-27' }, { partial: true, current }).value, { startDate: '2026-09-24', endDate: '2026-09-27' });
  assert.match(T.validateTrip({ endDate: '2026-09-20' }, { partial: true, current }).error, /시작일과 같거나 뒤/);
  assert.match(T.validateTrip({}, { partial: true, current }).error, /바꿀 내용/);
  assert.match(T.validateTrip({ membersCanEdit: 'yes' }, { partial: true, current }).error, /수정 권한/);
});

const trips = [
  { id: 1, startDate: '2026-09-24', endDate: '2026-09-26' },
  { id: 2, startDate: '2026-11-14', endDate: '2026-11-16' },
  { id: 3, startDate: '2026-05-02', endDate: '2026-05-03' },
  { id: 4, startDate: '2026-09-28', endDate: '2026-10-02' }, // 여행 중
];

test('splitTrips: 끝난 여행과 다가오는(여행 중 포함) 여행', () => {
  const g = T.splitTrips(trips, '2026-09-29');
  assert.deepEqual(g.upcoming.map((t) => t.id), [4, 2]);
  assert.deepEqual(g.past.map((t) => t.id), [1, 3]);
});

test('pickTrip: 주소 → 지난번 → 가까운 다가오는 → 최근 지난 여행', () => {
  assert.equal(T.pickTrip(trips, 3, 1, '2026-09-29').id, 3);
  assert.equal(T.pickTrip(trips, 99, 1, '2026-09-29').id, 1);
  assert.equal(T.pickTrip(trips, null, null, '2026-09-29').id, 4);
  assert.equal(T.pickTrip(trips.slice(0, 1), null, null, '2026-12-01').id, 1);
  assert.equal(T.pickTrip([], null, null, '2026-09-29'), null);
});
