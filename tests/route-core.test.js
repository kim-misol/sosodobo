const test = require('node:test');
const assert = require('node:assert/strict');

const R = require('../assets/route-core.js');

test('nameKey: 공백 · 대소문자 · 문장부호 무시', () => {
  assert.equal(R.nameKey(' 외돌개 공영 주차장 '), R.nameKey('외돌개공영주차장'));
  assert.equal(R.nameKey('Jeju Airport'), 'jejuairport');
  assert.equal(R.nameKey(''), '');
});

test('dayPoints: 주차 · 코스 전 이동(넣은 순서) → 코스 → 코스 후 이동 → 숙소, 연달아 같은 곳은 한 번', () => {
  const day = { items: [
    { id: 3, position: 3, kind: 'course', name: 'Olle 7', fromPlace: '외돌개', toPlace: '월평마을' },
    { id: 4, position: 4, kind: 'move', timing: 'after', fromPlace: '월평마을', toPlace: '서귀포 오션 스테이' },
    { id: 1, position: 1, kind: 'move', timing: 'before', fromPlace: '김포공항', toPlace: '제주공항' },
    { id: 2, position: 2, kind: 'parking', name: '외돌개 공영주차장', mapUrl: 'https://map.kakao.com/link/map/x,33.24,126.54' },
  ] };
  const pts = R.dayPoints(day, [{ name: '서귀포 오션 스테이', mapUrl: 'https://naver.me/abc' }]);
  assert.deepEqual(pts.map((p) => p.name), ['김포공항', '제주공항', '외돌개 공영주차장', '외돌개', '월평마을', '서귀포 오션 스테이']);
  assert.deepEqual(pts.map((p) => p.role), ['이동 출발', '이동 도착', '주차', '코스 출발', '코스 도착 · 이동 출발', '이동 도착 · 숙소']);
  assert.equal(pts[2].url, 'https://map.kakao.com/link/map/x,33.24,126.54');
  assert.equal(pts[5].url, 'https://naver.me/abc', '숙소 링크가 같은 곳(이동 도착)에 붙음');
});

test('dayPoints: 이동의 "1일차 숙소"는 그날 밤 숙소 이름으로', () => {
  const pts = R.dayPoints({ items: [{ id: 1, position: 1, kind: 'move', timing: 'after', fromPlace: '창선면', toPlace: '1일차 숙소' }] },
    [{ name: '남해는, 지금', mapUrl: 'https://naver.me/x' }]);
  assert.deepEqual(pts.map((p) => p.name), ['창선면', '남해는, 지금']);
  assert.equal(pts[1].url, 'https://naver.me/x');
  assert.equal(pts.length, 2, '숙소가 한 번만');
});

test('dayPoints: 코스가 여러 개면 지도 링크가 있는 코스를 순서대로 모두', () => {
  const day = { items: [
    { id: 1, position: 1, kind: 'course', name: '용머리 해안', mapUrl: 'https://kko.to/a' },
    { id: 2, position: 2, kind: 'course', name: '송악산 둘레길', mapUrl: 'https://naver.me/b' },
    { id: 3, position: 3, kind: 'course', name: '물 커피 로스터스', mapUrl: 'https://maps.app.goo.gl/c' },
    { id: 4, position: 4, kind: 'course', name: '올레 10코스', fromPlace: '화순', toPlace: '모슬포', mapUrl: 'https://kko.to/d' },
  ] };
  const pts = R.dayPoints(day, []);
  assert.deepEqual(pts.map((p) => p.name), ['용머리 해안', '송악산 둘레길', '물 커피 로스터스', '화순', '올레 10코스', '모슬포']);
  assert.deepEqual(pts.map((p) => p.url), ['https://kko.to/a', 'https://naver.me/b', 'https://maps.app.goo.gl/c', null, 'https://kko.to/d', null]);
});

test('dayPoints: 출발 · 도착이 없는 코스는 코스 이름으로', () => {
  const pts = R.dayPoints({ items: [{ id: 1, position: 1, kind: 'course', name: '성산일출봉' }] }, []);
  assert.deepEqual(pts, [{ key: '성산일출봉', name: '성산일출봉', kind: 'course', role: '코스', url: null, src: [] }]);
});

test('parseMapUrl: 구글 · 네이버 · 카카오 링크에서 좌표', () => {
  assert.deepEqual(R.parseMapUrl('https://www.google.com/maps/place/%EC%9A%A9%EB%A8%B8%EB%A6%AC/@33.2310,126.3140,15z/data=!3m1!4b1!4m6!3m5!1s0x0:0x0!8m2!3d33.2319!4d126.3148'), { lat: 33.2319, lng: 126.3148 }, '!3d!4d 를 먼저');
  assert.deepEqual(R.parseMapUrl('https://www.google.com/maps/@33.4996,126.5312,12z'), { lat: 33.4996, lng: 126.5312 });
  assert.deepEqual(R.parseMapUrl('https://maps.google.com/?q=33.2,126.5'), { lat: 33.2, lng: 126.5 });
  assert.deepEqual(R.parseMapUrl('https://map.kakao.com/link/map/외돌개,33.2397,126.5450'), { lat: 33.2397, lng: 126.545 });
  assert.deepEqual(R.parseMapUrl('https://map.naver.com/p/entry/place/123?lng=126.31&lat=33.23&placePath=%2Fhome'), { lat: 33.23, lng: 126.31 });
  assert.deepEqual(R.parseMapUrl('https://map.naver.com/v5/?c=126.3148,33.2319,15,0,0,0,dh'), { lat: 33.2319, lng: 126.3148 });
  const merc = R.parseMapUrl('https://map.naver.com/v5/?c=14061093.5,3926000.0,15,0,0,0,dh');
  assert.ok(merc && Math.abs(merc.lng - 126.31) < 0.01 && Math.abs(merc.lat - 33.24) < 0.05, JSON.stringify(merc));
  assert.equal(R.parseMapUrl('https://place.map.kakao.com/12345'), null);
  assert.equal(R.parseMapUrl('https://naver.me/xyz'), null);
  assert.equal(R.parseMapUrl(''), null);
});

test('isShortMapUrl: 따라가야 하는 공유 링크', () => {
  assert.equal(R.isShortMapUrl('https://maps.app.goo.gl/abc'), true);
  assert.equal(R.isShortMapUrl('https://naver.me/abc'), true);
  assert.equal(R.isShortMapUrl('https://kko.to/abc'), true);
  assert.equal(R.isShortMapUrl('https://www.google.com/maps/@1,2'), false);
});

test('distanceKm · googleDirectionsUrl · placeUrl', () => {
  const jeju = { lat: 33.5, lng: 126.53 };
  const gimpo = { lat: 37.56, lng: 126.79 };
  assert.ok(Math.abs(R.distanceKm(jeju, gimpo) - 451) < 10);
  const pts = [{ name: 'a', lat: 33.1, lng: 126.1 }, { name: 'b', lat: null, lng: null }, { name: 'c', lat: 33.2, lng: 126.2 }, { name: 'd', lat: 33.3, lng: 126.3 }];
  const u = R.googleDirectionsUrl(pts);
  assert.match(u, /origin=33\.100000,126\.100000/);
  assert.match(u, /destination=33\.300000,126\.300000/);
  assert.match(u, /waypoints=33\.200000%2C126\.200000/);
  assert.equal(R.googleDirectionsUrl([pts[0]]), null);
  assert.equal(R.placeUrl({ name: 'x', url: 'https://naver.me/1' }), 'https://naver.me/1');
  assert.equal(R.placeUrl({ name: '외돌개', lat: 33.2, lng: 126.5 }), 'https://map.kakao.com/link/map/%EC%99%B8%EB%8F%8C%EA%B0%9C,33.2,126.5');
});
