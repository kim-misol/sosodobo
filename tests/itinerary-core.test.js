const test = require('node:test');
const assert = require('node:assert/strict');
const I = require('../assets/itinerary-core.js');

test('detectMapProvider: 카카오 · 네이버 · 구글 · 그 밖 · 잘못된 링크', () => {
  assert.equal(I.detectMapProvider('https://kko.to/abc'), 'kakao');
  assert.equal(I.detectMapProvider('https://place.map.kakao.com/123'), 'kakao');
  assert.equal(I.detectMapProvider('https://naver.me/5V8TldZP'), 'naver');
  assert.equal(I.detectMapProvider('https://map.naver.com/p/entry/place/1'), 'naver');
  assert.equal(I.detectMapProvider('https://m.place.naver.com/restaurant/1'), 'naver');
  assert.equal(I.detectMapProvider('https://maps.app.goo.gl/xyz'), 'google');
  assert.equal(I.detectMapProvider('https://www.google.com/maps/place/x'), 'google');
  assert.equal(I.detectMapProvider('https://goo.gl/maps/x'), 'google');
  assert.equal(I.detectMapProvider('https://www.google.com/search?q=x'), 'other');
  assert.equal(I.detectMapProvider('https://example.com/map'), 'other');
  assert.equal(I.detectMapProvider('javascript:alert(1)'), null);
  assert.equal(I.detectMapProvider(''), null);
});

test('safeUrl: http(s) 만, 이 사이트 assets 경로는 허용할 때만', () => {
  assert.equal(I.safeUrl(' https://a.b/c '), 'https://a.b/c');
  assert.equal(I.safeUrl(''), null);
  assert.equal(I.safeUrl('ftp://a'), undefined);
  assert.equal(I.safeUrl('assets/map03.png'), undefined);
  assert.equal(I.safeUrl('assets/map03.png', { allowAssets: true }), 'assets/map03.png');
  assert.equal(I.safeUrl('assets/../api/x', { allowAssets: true }), undefined);
});

test('stars: 1~5 를 ★☆ 로', () => {
  assert.equal(I.stars(3), '★★★☆☆');
  assert.equal(I.stars(5), '★★★★★');
  assert.equal(I.stars(null), '');
  assert.equal(I.stars(9), '★★★★★');
});

test('validateDay: 들어온 항목만, 길이 · 코스 방식', () => {
  assert.deepEqual(I.validateDay({ title: ' 동대만길 ', planMode: 'free' }).value, { title: '동대만길', planMode: 'free' });
  assert.deepEqual(I.validateDay({ summary: '' }).value, { summary: null });
  assert.match(I.validateDay({ title: 'x'.repeat(41) }).error, /40자/);
  assert.match(I.validateDay({ planMode: 'yolo' }).error, /코스 방식/);
  assert.match(I.validateDay({}).error, /바꿀 내용/);
});

test('validateItem course: 이름 필수, 거리 km 숫자, 난이도 1~5, 링크 검사', () => {
  const ok = I.validateItem('course', { name: '동대만길', subtitle: '남파랑길 36코스', fromPlace: '창선대교', toPlace: '창선면', distanceKm: '15', durationText: '5시간 30분', difficulty: '3' });
  assert.deepEqual(ok.value, { name: '동대만길', subtitle: '남파랑길 36코스', fromPlace: '창선대교', toPlace: '창선면', durationText: '5시간 30분', memo: null, distanceKm: 15, difficulty: 3, mapUrl: null, linkUrl: null });
  assert.equal(I.validateItem('course', { name: 'a', distanceKm: '11,9' }).value.distanceKm, 11.9);
  assert.match(I.validateItem('course', { name: '' }).error, /코스 이름/);
  assert.match(I.validateItem('course', { name: 'a', distanceKm: '열키로' }).error, /km/);
  assert.match(I.validateItem('course', { name: 'a', difficulty: 6 }).error, /1~5/);
  assert.match(I.validateItem('course', { name: 'a', linkUrl: 'javascript:x' }).error, /https/);
});

test('validateItem move: 수단 · 언제(기본 코스 전) · 셋 중 하나는 필요', () => {
  assert.deepEqual(I.validateItem('move', { fromPlace: '창선면', toPlace: '숙소', mode: 'taxi', timing: 'after', memo: '약 10분' }).value,
    { fromPlace: '창선면', toPlace: '숙소', memo: '약 10분', mode: 'taxi', timing: 'after', mapUrl: null, linkUrl: null });
  assert.equal(I.validateItem('move', { memo: '버스 801번' }).value.timing, 'before');
  assert.equal(I.validateItem('move', { memo: '버스' }).value.mode, 'other');
  assert.match(I.validateItem('move', {}).error, /하나는/);
  assert.match(I.validateItem('move', { memo: 'x', mode: 'plane' }).error, /이동 수단/);
});

test('validateItem parking · partial 수정', () => {
  assert.deepEqual(I.validateItem('parking', { name: '공영주차장', mapUrl: 'https://naver.me/x' }).value, { name: '공영주차장', memo: null, mapUrl: 'https://naver.me/x', linkUrl: null });
  assert.match(I.validateItem('parking', { memo: 'x' }).error, /주차 장소/);
  assert.deepEqual(I.validateItem('course', { difficulty: 2 }, { partial: true }).value, { difficulty: 2 });
  assert.match(I.validateItem('course', {}, { partial: true }).error, /바꿀 내용/);
  assert.match(I.validateItem('hotel', {}).error, /알 수 없는/);
});

const items = [
  { id: 1, kind: 'parking', position: 1 },
  { id: 2, kind: 'move', timing: 'before', position: 2 },
  { id: 3, kind: 'course', position: 3 },
  { id: 4, kind: 'course', position: 4 },
  { id: 5, kind: 'move', timing: 'after', position: 5 },
  { id: 6, kind: 'move', timing: 'before', position: 6 },
];

test('groupItems: 주차 · 코스 전 이동 · 코스 · 코스 후 이동', () => {
  const g = I.groupItems(items);
  assert.deepEqual(g.parking.map((i) => i.id), [1]);
  assert.deepEqual(g.movesBefore.map((i) => i.id), [2, 6]);
  assert.deepEqual(g.courses.map((i) => i.id), [3, 4]);
  assert.deepEqual(g.movesAfter.map((i) => i.id), [5]);
});

test('moveItem: 같은 종류(같은 때 이동) 안에서만 자리 바꾸기', () => {
  assert.deepEqual(I.moveItem(items, 4, -1), [{ id: 4, position: 3 }, { id: 3, position: 4 }]);
  assert.deepEqual(I.moveItem(items, 3, -1), [], '맨 위 코스는 더 못 올라감 (주차·이동과 섞이지 않음)');
  assert.deepEqual(I.moveItem(items, 2, 1), [{ id: 2, position: 6 }, { id: 6, position: 2 }]);
  assert.deepEqual(I.moveItem(items, 5, -1), [], '코스 후 이동은 코스 전 이동과 안 섞임');
  assert.deepEqual(I.moveItem([{ id: 1, kind: 'course', position: 0 }, { id: 2, kind: 'course', position: 0 }], 1, 1), [{ id: 1, position: 1 }, { id: 2, position: 0 }]);
});

test('buildDays: 여행 기간만큼, 저장된 날짜 정보 합치기 · dayHasContent', () => {
  const days = I.buildDays('2026-09-24', 3, [{ dayNo: 2, id: 7, title: '말발굽길', items: [{ id: 1 }] }, { dayNo: 5, title: '범위 밖' }]);
  assert.deepEqual(days.map((d) => [d.dayNo, d.date, d.dateLabel, d.title]), [
    [1, '2026-09-24', '9/24 (목)', null], [2, '2026-09-25', '9/25 (금)', '말발굽길'], [3, '2026-09-26', '9/26 (토)', null],
  ]);
  assert.equal(I.dayHasContent(days[0]), false);
  assert.equal(I.dayHasContent(days[1]), true);
});

test('lodgingNights · shortWon', () => {
  assert.deepEqual(I.lodgingNights('2026-12-31', 2), ['2026-12-31', '2027-01-01']);
  assert.equal(I.shortWon(170000), '17만원');
  assert.equal(I.shortWon(125000), '12.5만원');
  assert.equal(I.shortWon(8000), '8,000원');
});
