const test = require('node:test');
const assert = require('node:assert/strict');

const W = require('../assets/weather-core.js');

test('codeInfo: WMO 코드 → 아이콘 · 이름, 모르는 코드는 기본값', () => {
  assert.deepEqual(W.codeInfo(0), { icon: '☀️', label: '맑음' });
  assert.equal(W.codeInfo(63).label, '비');
  assert.equal(W.codeInfo(95).icon, '⛈');
  assert.equal(W.codeInfo(1234).label, '날씨');
  assert.equal(W.isWet(3), false);
  assert.equal(W.isWet(61), true);
});

test('todayKst: 한국 시간 기준 날짜', () => {
  assert.equal(W.todayKst(Date.parse('2026-09-30T15:30:00Z')), '2026-10-01');
  assert.equal(W.todayKst(Date.parse('2026-09-30T14:59:00Z')), '2026-09-30');
});

test('planRanges: 가까운 날은 예보, 먼 미래는 far, 아주 오래된 날은 기록(archive)', () => {
  const soon = W.planRanges('2026-10-10', 3, '2026-10-01');
  assert.deepEqual(soon.forecast, ['2026-10-10', '2026-10-12']);
  assert.equal(soon.archive, null);
  assert.deepEqual(soon.far, []);
  assert.equal(soon.forecastOpensOn, null);

  const edge = W.planRanges('2026-10-15', 3, '2026-10-01'); // 10/16 까지 예보
  assert.deepEqual(edge.forecast, ['2026-10-15', '2026-10-16']);
  assert.deepEqual(edge.far, ['2026-10-17']);
  assert.equal(edge.forecastOpensOn, '2026-10-02');

  const far = W.planRanges('2026-12-06', 2, '2026-10-01');
  assert.equal(far.forecast, null);
  assert.deepEqual(far.far, ['2026-12-06', '2026-12-07']);
  assert.equal(far.forecastOpensOn, '2026-11-21');

  const recent = W.planRanges('2026-09-24', 3, '2026-10-01');
  assert.deepEqual(recent.forecast, ['2026-09-24', '2026-09-26'], '최근 지난 여행은 예보 API 의 기록');

  const old = W.planRanges('2025-05-01', 2, '2026-10-01');
  assert.deepEqual(old.archive, ['2025-05-01', '2025-05-02']);
  assert.equal(old.forecast, null);
});

test('sunTimes: Open-Meteo 값과 몇 분 안으로 맞다 (남해 2026-09-24 06:17 / 18:25 KST)', () => {
  const t = W.sunTimes('2026-09-24', 34.85, 128.0, 540);
  const mins = (s) => Number(s.slice(0, 2)) * 60 + Number(s.slice(3));
  assert.ok(Math.abs(mins(t.sunrise) - mins('06:17')) <= 3, t.sunrise);
  assert.ok(Math.abs(mins(t.sunset) - mins('18:25')) <= 3, t.sunset);
  assert.equal(W.sunTimes('2026-12-21', 80, 0, 0), null, '극야');
});

test('parseDaily · clockOf: 날짜별로 정리', () => {
  const d = W.parseDaily({
    time: ['2026-09-24', '2026-09-25'],
    weather_code: [3, 61],
    temperature_2m_max: [27.3, 24.1],
    temperature_2m_min: [20.5, null],
    precipitation_probability_max: [6, 70],
    sunrise: ['2026-09-24T06:17', '2026-09-25T06:18'],
    sunset: ['2026-09-24T18:25', '2026-09-25T18:24'],
  });
  assert.equal(d['2026-09-24'].code, 3);
  assert.equal(d['2026-09-24'].sunrise, '06:17');
  assert.equal(d['2026-09-25'].tmin, null);
  assert.equal(d['2026-09-25'].pop, 70);
  assert.equal(d['2026-09-25'].precip, null);
});

test('regionQueries: 지역 이름에서 검색어 후보', () => {
  assert.deepEqual(W.regionQueries('남해 · 창선면 일대'), ['남해 창선면', '남해', '창선면']);
  assert.deepEqual(W.regionQueries('부산'), ['부산']);
  assert.deepEqual(W.regionQueries(''), []);
});

test('weatherText: 예보는 비 확률, 지난 날은 강수량', () => {
  assert.equal(W.weatherText({ kind: 'forecast', code: 0, tmax: 27.4, tmin: 19.6, pop: 10 }), '☀️ 맑음 27°/20° · 강수확률 10%');
  assert.equal(W.weatherText({ kind: 'past', code: 63, tmax: 22, tmin: 19, precip: 12.34 }), '🌧 비 22°/19° · 강수 12.3mm');
  assert.equal(W.weatherText({ kind: 'far', code: null }), '');
});

test('summarize: 표지 요약', () => {
  const past = W.summarize([
    { dayNo: 1, kind: 'past', code: 3, tmax: 27.3, tmin: 20.5 },
    { dayNo: 2, kind: 'past', code: 61, tmax: 24.1, tmin: 21.7 },
    { dayNo: 3, kind: 'past', code: 63, tmax: 21.8, tmin: 19.7 },
  ], null);
  assert.equal(past.text, '그때 날씨 🌧 20~27° · 비: DAY 2, DAY 3');

  const sunny = W.summarize([
    { dayNo: 1, kind: 'forecast', code: 0, tmax: 25, tmin: 17, pop: 0 },
    { dayNo: 2, kind: 'forecast', code: 1, tmax: 24, tmin: 16, pop: 20 },
  ], null);
  assert.equal(sunny.text, '날씨 ☀️ 16~25° · 비 소식 없음');

  const far = W.summarize([{ dayNo: 1, kind: 'far', code: null }], '2026-11-21');
  assert.equal(far.text, '🌤 날씨 예보는 11/21부터 보여요');

  const partly = W.summarize([
    { dayNo: 1, kind: 'forecast', code: 0, tmax: 25, tmin: 17, pop: 0 },
    { dayNo: 2, kind: 'far', code: null },
  ], '2026-10-02');
  assert.equal(partly.note, '나머지 날은 10/2부터 예보');
  assert.equal(W.summarize([], null), null);
});
