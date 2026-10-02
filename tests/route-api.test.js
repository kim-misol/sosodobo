const test = require('node:test');
const assert = require('node:assert/strict');

const Route = require('../api/_route.js');

function fakeDb() {
  const meta = { 'geo:제주': JSON.stringify({ lat: 33.38, lng: 126.55, name: '제주' }) };
  const places = {};
  const calls = [];
  const sql = async (strings, ...values) => {
    const text = strings.join('?');
    calls.push({ text, values });
    if (text.startsWith('SELECT value FROM app_meta')) return { rows: meta[values[0]] ? [{ value: meta[values[0]] }] : [] };
    if (text.startsWith('INSERT INTO app_meta')) { meta[values[0]] = values[1]; return { rows: [] }; }
    if (text.startsWith('SELECT name_key')) return { rows: Object.values(places) };
    if (text.includes('INSERT INTO place_coords')) {
      const manual = text.includes("'manual'");
      places[values[1]] = { name_key: values[1], lat: values[3], lng: values[4], source: manual ? 'manual' : values[5], map_url: manual ? values[5] : values[6], updated_at: new Date() };
      return { rows: [] };
    }
    return { rows: [] };
  };
  return { sql, places, calls };
}

const itinerary = {
  days: [{
    dayNo: 1, date: '2026-10-16',
    items: [
      { id: 1, position: 1, kind: 'move', timing: 'before', fromPlace: '김포공항', toPlace: '제주공항' },
      { id: 2, position: 2, kind: 'parking', name: '외돌개 주차장', mapUrl: 'https://map.kakao.com/link/map/외돌개주차장,33.2400,126.5450' },
      { id: 3, position: 3, kind: 'course', name: '올레 7', fromPlace: '외돌개', toPlace: '없는장소123' },
    ],
  }],
  lodgings: [{ name: '숙소A', checkIn: '2026-10-16', nights: 1, mapUrl: 'https://naver.me/short' }],
};

function fakeFetch(log) {
  return async (url) => {
    log.push(String(url));
    const u = String(url);
    if (u.startsWith('https://naver.me/')) {
      return { status: 302, ok: false, headers: { get: () => 'https://map.naver.com/p/entry/place/1?lng=126.56&lat=33.25' } };
    }
    if (u.includes('dapi.kakao.com')) {
      const q = decodeURIComponent(u.split('query=')[1].split('&')[0]);
      const docs = { 김포공항: [{ place_name: '김포국제공항', x: '126.79', y: '37.56' }], 제주공항: [{ place_name: '제주국제공항', x: '126.49', y: '33.51' }], 외돌개: [{ place_name: '외돌개', x: '126.545', y: '33.24' }] }[q] || [];
      return { ok: true, status: 200, json: async () => ({ documents: docs }) };
    }
    if (u.includes('nominatim')) return { ok: true, status: 200, json: async () => [] };
    return { ok: false, status: 404, json: async () => ({}) };
  };
}

test('tripRoutes: 링크 · 짧은 링크 · 카카오 검색으로 찾고, 먼 곳은 far, 못 찾은 곳은 missing · 저장해서 다시 묻지 않음', async () => {
  const db = fakeDb();
  const log = [];
  const deps = { sql: db.sql, fetch: fakeFetch(log), env: { KAKAO_REST_API_KEY: 'k' }, wait: async () => {} };
  const r = await Route.tripRoutes({ id: 3, region: '제주' }, itinerary, deps);
  const byName = Object.fromEntries(r.days[0].points.map((p) => [p.name, p]));
  assert.deepEqual(r.days[0].points.map((p) => p.name), ['김포공항', '제주공항', '외돌개 주차장', '외돌개', '없는장소123', '숙소A']);
  assert.equal(byName['김포공항'].status, 'far', '여행 지역에서 450km — 지도에서 뺌');
  assert.equal(byName['제주공항'].status, 'ok');
  assert.equal(byName['외돌개 주차장'].source, 'link');
  assert.equal(byName['외돌개 주차장'].lat, 33.24);
  assert.equal(byName['숙소A'].source, 'link', '네이버 짧은 링크를 따라가서');
  assert.equal(byName['숙소A'].lat, 33.25);
  assert.equal(byName['외돌개'].source, 'kakao');
  assert.equal(byName['없는장소123'].status, 'missing');
  assert.equal(r.pending, false);
  const count = log.length;
  await Route.tripRoutes({ id: 3, region: '제주' }, itinerary, deps);
  assert.equal(log.length, count, '두 번째는 저장된 좌표만');
});

test('savePlace: 링크나 좌표로 고치기, 좌표 없는 링크는 오류', async () => {
  const db = fakeDb();
  const deps = { sql: db.sql, fetch: fakeFetch([]) };
  const ok = await Route.savePlace(3, { name: '없는장소123', url: 'https://www.google.com/maps/@33.3,126.4,15z' }, deps);
  assert.deepEqual(ok, { lat: 33.3, lng: 126.4 });
  assert.equal(db.places['없는장소123'].source, 'manual');
  const picked = await Route.savePlace(3, { name: '숙소B', lat: 33.1, lng: 126.2 }, deps);
  assert.deepEqual(picked, { lat: 33.1, lng: 126.2 });
  const bad = await Route.savePlace(3, { name: 'x', url: 'https://place.map.kakao.com/123' }, deps);
  assert.match(bad.error, /링크에서는 위치를 못 찾았어요/);
  assert.match((await Route.savePlace(3, { name: '' }, deps)).error, /이름/);
});

test('coordsFromLink: 카카오 kko.to → urlX/urlY(카카오 좌표)를 카카오 변환 API 로, 없으면 주소 검색, 장소 번호는 같은 id 로', async () => {
  const calls = [];
  const fetchImpl = async (url) => {
    const u = String(url);
    calls.push(u);
    if (u === 'https://kko.to/NUVC04OhAi') {
      return { status: 302, ok: false, headers: { get: () => 'https://map.kakao.com/?map_type=TYPE_MAP&q=%EA%B2%BD%EB%82%A8+%EB%82%A8%ED%95%B4%EA%B5%B0+%EC%82%BC%EB%8F%99%EB%A9%B4+%EC%82%BC%EC%9D%B4%EB%A1%9C+31-4&urlLevel=2&urlX=727904&urlY=371531' } };
    }
    if (u.includes('/geo/transcoord.json')) {
      assert.match(u, /input_coord=WCONGNAMUL&output_coord=WGS84&x=727904&y=371531/);
      return { ok: true, json: async () => ({ documents: [{ x: 128.0391, y: 34.8137 }] }) };
    }
    if (u.includes('/search/address.json')) return { ok: true, json: async () => ({ documents: [{ x: '128.04', y: '34.81' }] }) };
    if (u.includes('/search/keyword.json')) return { ok: true, json: async () => ({ documents: [{ id: '111', x: '1', y: '1' }, { id: '27324571', x: '126.5', y: '33.2' }] }) };
    if (u.startsWith('https://place.map.kakao.com/')) return { status: 200, ok: true, headers: { get: () => null } };
    return { ok: false, status: 404, headers: { get: () => null } };
  };
  const env = { KAKAO_REST_API_KEY: 'k' };
  assert.deepEqual(await Route.coordsFromLink('https://kko.to/NUVC04OhAi', fetchImpl, { name: '숙소', env }), { lat: 34.8137, lng: 128.0391 });
  // urlX/urlY 없이 주소만
  assert.deepEqual(await Route.coordsFromLink('https://map.kakao.com/?q=%EA%B2%BD%EB%82%A8+%EB%82%A8%ED%95%B4%EA%B5%B0', fetchImpl, { env }), { lat: 34.81, lng: 128.04 });
  // 장소 번호 → 이름 검색 결과 중 같은 id
  assert.deepEqual(await Route.coordsFromLink('https://place.map.kakao.com/27324571', fetchImpl, { name: '외돌개', env }), { lat: 33.2, lng: 126.5 });
  // 키가 없으면 못 풀어요
  assert.equal(await Route.coordsFromLink('https://map.kakao.com/?urlX=1&urlY=2', fetchImpl, { env: {} }), null);
});
