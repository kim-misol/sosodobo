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
  assert.match(I.validateItem('move', { memo: 'x', mode: 'rocket' }).error, /이동 수단/);
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

// ---- 숙소 ----------------------------------------------------------------------

const ctx = { startDate: '2026-09-24', days: 3, travelerIds: [2, 3, 4, 5] };

test('validateLodging: 기본값(1박 · 전원) · 체크인은 기간 안 · 마지막 날 밤까지', () => {
  const ok = I.validateLodging({ name: ' 남해는, 지금 ', checkIn: '2026-09-24', cost: '170000', mapUrl: 'https://naver.me/x' }, ctx);
  assert.deepEqual(ok.value, { name: '남해는, 지금', memo: null, address: null, checkIn: '2026-09-24', nights: 1, cost: 170000, guestIds: [2, 3, 4, 5], mapUrl: 'https://naver.me/x', linkUrl: null, addExpense: false });
  assert.match(I.validateLodging({ name: 'a', checkIn: '2026-09-23' }, ctx).error, /기간 안/);
  assert.match(I.validateLodging({ name: 'a', checkIn: '2026-09-27' }, ctx).error, /기간 안/);
  assert.equal(I.validateLodging({ name: 'a', checkIn: '2026-09-25', nights: 2 }, ctx).value.nights, 2);
  assert.match(I.validateLodging({ name: 'a', checkIn: '2026-09-25', nights: 3 }, ctx).error, /마지막 날 밤/);
  assert.match(I.validateLodging({ name: 'a', checkIn: '2026-09-24', nights: 0 }, ctx).error, /1박 이상/);
  assert.match(I.validateLodging({ name: '', checkIn: '2026-09-24' }, ctx).error, /숙소 이름/);
});

test('validateLodging: 비용 · 함께 묵는 사람 · 지출 추가 조건', () => {
  assert.match(I.validateLodging({ name: 'a', checkIn: '2026-09-24', cost: '십칠만' }, ctx).error, /숫자로 입력/);
  assert.match(I.validateLodging({ name: 'a', checkIn: '2026-09-24', guestIds: [2, 99] }, ctx).error, /이 여행에 없는/);
  assert.deepEqual(I.validateLodging({ name: 'a', checkIn: '2026-09-24', guestIds: ['3', 3, 5] }, ctx).value.guestIds, [3, 5]);
  assert.match(I.validateLodging({ name: 'a', checkIn: '2026-09-24', addExpense: true }, ctx).error, /비용을 입력/);
  assert.match(I.validateLodging({ name: 'a', checkIn: '2026-09-24', addExpense: true, cost: 300000, guestIds: [] }, ctx).error, /한 명 이상/);
  assert.match(I.validateLodging({ name: 'a', checkIn: '2026-09-24', addExpense: true, cost: 300000, payerId: 99 }, ctx).error, /결제한 사람/);
  const v = I.validateLodging({ name: 'a', checkIn: '2026-09-24', addExpense: true, cost: 300000, payerId: '2', guestIds: [2, 4, 5] }, ctx).value;
  assert.equal(v.addExpense, true);
  assert.equal(v.payerId, 2);
});

test('perPersonCost · lodgingExpenseDescription', () => {
  assert.equal(I.perPersonCost(300000, 3), 100000);
  assert.equal(I.perPersonCost(170000, 4), 42500);
  assert.equal(I.perPersonCost(100000, 3), 33333);
  assert.equal(I.perPersonCost(null, 3), null);
  assert.equal(I.perPersonCost(1000, 0), null);
  assert.equal(I.lodgingExpenseDescription({ name: '파도가 머무는 정원', nights: 1 }), '숙소 · 파도가 머무는 정원');
  assert.equal(I.lodgingExpenseDescription({ name: '한옥', nights: 2 }), '숙소 · 한옥 (2박)');
});

test('nightlyCoverage: 하룻밤 여러 숙소 · 겹친 사람 · 숙소 미정인 사람', () => {
  const lodgings = [
    { id: 1, checkIn: '2026-09-24', nights: 2, guestIds: [2, 3] },
    { id: 2, checkIn: '2026-09-25', nights: 1, guestIds: [3, 4] },
  ];
  const c = I.nightlyCoverage(['2026-09-24', '2026-09-25', '2026-09-26'], lodgings, [2, 3, 4, 5]);
  assert.deepEqual(c['2026-09-24'], { lodgingIds: [1], doubled: [], missing: [4, 5] });
  assert.deepEqual(c['2026-09-25'], { lodgingIds: [1, 2], doubled: [3], missing: [5] });
  assert.deepEqual(c['2026-09-26'], { lodgingIds: [], doubled: [], missing: [] }, '숙소가 없는 밤은 아직 안 정한 것으로');
});

test('parseWon: 쉼표 · 원 · 만 단위', () => {
  assert.equal(I.parseWon('170,000원'), 170000);
  assert.equal(I.parseWon('17만'), 170000);
  assert.equal(I.parseWon('12.5만원'), 125000);
  assert.equal(I.parseWon(' 300000 '), 300000);
  assert.equal(I.parseWon(''), null);
  assert.ok(Number.isNaN(I.parseWon('십칠만')));
  assert.equal(I.validateLodging({ name: 'a', checkIn: '2026-09-24', cost: '30만' }, ctx).value.cost, 300000);
});

// ---- 미리보기 사진 ------------------------------------------------------------------

const B = 'https://abc123.public.blob.vercel-storage.com';

test('isPreviewUrl: 이 여행의 trips/<id>/preview/ 파일만', () => {
  assert.equal(I.isPreviewUrl(B + '/trips/5/preview/1-ab.jpg', 5), true);
  assert.equal(I.isPreviewUrl(B + '/trips/6/preview/1-ab.jpg', 5), false, '다른 여행');
  assert.equal(I.isPreviewUrl(B + '/photos/1-ab.jpg', 5), false, '앨범 경로');
  assert.equal(I.isPreviewUrl('https://evil.example.com/trips/5/preview/1.jpg', 5), false);
  assert.equal(I.isPreviewUrl('assets/day2-carousel/slide-01.jpg', 5), false);
});

test('validateDayPhoto: 하루 10장 · 주소 · 설명 길이', () => {
  const ok = I.validateDayPhoto({ url: B + '/trips/5/preview/1-ab.jpg', thumbUrl: B + '/trips/5/preview/1-ab-t.jpg', caption: ' 창선대교 ', width: 1600, height: 1200 }, 5, 3);
  assert.deepEqual(ok.value, { url: B + '/trips/5/preview/1-ab.jpg', thumbUrl: B + '/trips/5/preview/1-ab-t.jpg', caption: '창선대교', width: 1600, height: 1200 });
  assert.match(I.validateDayPhoto({ url: B + '/trips/5/preview/1.jpg' }, 5, 10).error, /10장/);
  assert.match(I.validateDayPhoto({ url: B + '/trips/9/preview/1.jpg' }, 5, 0).error, /주소/);
  assert.match(I.validateDayPhoto({ url: B + '/trips/5/preview/1.jpg', caption: 'x'.repeat(101) }, 5, 0).error, /100자/);
  assert.equal(I.previewPath(5, 'thumb', 1700000000000, 'a/b!c'), 'trips/5/preview/1700000000000-abc-t.jpg');
});

test('이동 수단: 비행기 · 배도 고를 수 있다', () => {
  assert.equal(I.validateItem('move', { fromPlace: '김포', toPlace: '제주', mode: 'plane' }).value.mode, 'plane');
  assert.equal(I.validateItem('move', { fromPlace: '삼천포항', toPlace: '제주항', mode: 'ship' }).value.mode, 'ship');
  assert.deepEqual(I.MOVE_MODES.map((m) => m.label), ['자가용', '택시', '버스', '기차', '비행기', '배', '도보', '기타']);
});
