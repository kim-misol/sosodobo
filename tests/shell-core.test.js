const test = require('node:test');
const assert = require('node:assert/strict');
const S = require('../assets/shell-core.js');

const at = (iso) => Date.parse(iso);

test('tripPhase: 한국 날짜로 출발 전 / 여행 중 / 끝남', () => {
  assert.equal(S.tripPhase('2026-09-24', 3, at('2026-09-23T14:59:00Z')), 'before'); // 9/23 23:59 KST
  assert.equal(S.tripPhase('2026-09-24', 3, at('2026-09-23T15:00:00Z')), 'during'); // 9/24 00:00 KST
  assert.equal(S.tripPhase('2026-09-24', 3, at('2026-09-26T14:00:00Z')), 'during'); // 9/26 23:00 KST
  assert.equal(S.tripPhase('2026-09-24', 3, at('2026-09-26T15:00:00Z')), 'after');  // 9/27 00:00 KST
  assert.equal(S.tripPhase(null, 3, at('2026-09-29T00:00:00Z')), 'before');
});

test('defaultTab: 끝난 여행은 사진첩, 아니면 홈', () => {
  assert.equal(S.defaultTab('after'), 'photos');
  assert.equal(S.defaultTab('during'), 'home');
  assert.equal(S.defaultTab('before'), 'home');
});

test('tabFromHash / dateRangeLabel', () => {
  assert.equal(S.tabFromHash('#people'), 'people');
  assert.equal(S.tabFromHash('#settle'), null);
  assert.equal(S.dateRangeLabel('2026-09-24', 3), '2026.9.24 – 9.26');
  assert.equal(S.dateRangeLabel('2026-12-31', 2), '2026.12.31 – 2027.1.1');
  assert.equal(S.dateRangeLabel(null, 3), '');
});

test('tripStatus: 남은 날 / n일차 / 끝', () => {
  assert.deepEqual(S.tripStatus('2026-11-14', 3, at('2026-09-29T03:00:00Z')), { phase: 'before', days: 46 });
  assert.deepEqual(S.tripStatus('2026-09-24', 3, at('2026-09-25T03:00:00Z')), { phase: 'during', day: 2 });
  assert.deepEqual(S.tripStatus('2026-09-24', 3, at('2026-09-29T03:00:00Z')), { phase: 'after' });
  assert.deepEqual(S.tripStatus(null, 3, at('2026-09-29T03:00:00Z')), { phase: 'before' });
});
