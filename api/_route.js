// 일정 지도 루트 (api/trips.js 의 part=route · place · place-search 가 씀).
// 장소 좌표는 여행마다 이름(nameKey)으로 place_coords 에 저장해 두고 다시 쓰고, 처음 보는 장소만 찾아요:
//   붙여 넣은 지도 링크(구글 · 네이버 · 카카오, 짧은 링크는 따라가서) → 카카오 장소 검색 → OpenStreetMap(Nominatim)
// 못 찾은 곳도 기록해 두고 사흘 뒤에 다시 찾아요. 여행 지역에서 FAR_KM 넘게 먼 곳은 지도에서 빼요.
const R = require('../assets/route-core.js');
const { geocodeRegion } = require('./_weather');

const UA = 'sosodobo/1.0 (+https://sosodobo.vercel.app)';
const RETRY_MS = 3 * 86400000;
const LOOKUP_BUDGET_MS = 6000; // 한 번에 이만큼만 찾고, 나머지는 pending 으로 (화면이 이어서 다시 물어요)

function pause(ms) { return new Promise((r) => setTimeout(r, ms)); }

/** 짧은 공유 링크를 따라가 최종 주소 (최대 4번) */
async function followRedirects(url, fetchImpl) {
  let cur = url;
  for (let i = 0; i < 4; i++) {
    const res = await fetchImpl(cur, { redirect: 'manual', headers: { 'User-Agent': UA } });
    const loc = res.headers && res.headers.get && res.headers.get('location');
    if (!(res.status >= 300 && res.status < 400) || !loc) break;
    cur = new URL(loc, cur).toString();
    if (R.parseMapUrl(cur)) break;
  }
  return cur;
}

/** 지도 링크 → { lat, lng } | null (짧은 링크는 따라가서) */
async function coordsFromLink(url, fetchImpl) {
  const direct = R.parseMapUrl(url);
  if (direct || !/^https?:\/\//i.test(String(url || ''))) return direct;
  try {
    return R.parseMapUrl(await followRedirects(url, fetchImpl));
  } catch {
    return null;
  }
}

/** 카카오 장소 검색 → [{ name, address, lat, lng, source }] (키가 없거나 카카오맵이 꺼져 있으면 빈 배열) */
async function kakaoSearch(query, center, deps, size) {
  const key = (deps.env || process.env).KAKAO_REST_API_KEY;
  if (!key || !query) return [];
  let url = 'https://dapi.kakao.com/v2/local/search/keyword.json?size=' + (size || 5) + '&query=' + encodeURIComponent(query);
  if (center) url += '&x=' + center.lng + '&y=' + center.lat;
  const res = await deps.fetch(url, { headers: { Authorization: 'KakaoAK ' + key } });
  if (!res.ok) {
    if (!deps.kakaoWarned) { deps.kakaoWarned = true; console.warn('kakao local search', res.status); }
    return [];
  }
  const data = await res.json();
  return (data.documents || []).map((d) => ({
    name: d.place_name, address: d.road_address_name || d.address_name || '', category: d.category_group_name || '',
    lat: Number(d.y), lng: Number(d.x), source: 'kakao',
  }));
}

/** OpenStreetMap 검색 → [{ name, address, lat, lng, source }] */
async function osmSearch(query, deps, limit) {
  if (!query) return [];
  const res = await deps.fetch('https://nominatim.openstreetmap.org/search?format=jsonv2&accept-language=ko&limit=' + (limit || 3) +
    '&q=' + encodeURIComponent(query), { headers: { 'User-Agent': UA, Accept: 'application/json' } });
  if (!res.ok) return [];
  const list = await res.json();
  return (Array.isArray(list) ? list : []).map((d) => {
    const parts = String(d.display_name || '').split(',').map((s) => s.trim());
    return { name: parts[0] || query, address: parts.slice(1, 4).join(', '), category: '', lat: Number(d.lat), lng: Number(d.lon), source: 'osm' };
  });
}

/** "남해 · 창선면 일대" → "남해" (검색어에 붙일 지역 한 단어) */
function regionWord(region) {
  return String(region || '').split(/[·,/|()\s]+/).map((s) => s.trim()).filter(Boolean)[0] || '';
}

function near(center, p) {
  if (!center) return true;
  const d = R.distanceKm(center, p);
  return d !== null && d <= R.FAR_KM;
}

/** 장소 하나 자동으로 찾기 → { lat, lng, source } | null */
async function lookup(point, center, region, deps) {
  if (point.url) {
    const c = await coordsFromLink(point.url, deps.fetch).catch(() => null);
    if (c) return Object.assign(c, { source: 'link' });
  }
  // 여행 지역 가까운 결과를 먼저, 없으면 첫 결과 (멀면 지도에서는 "먼 곳"으로 빠짐)
  const pick = (list) => list.find((d) => near(center, d)) || list[0];
  const k = pick(await kakaoSearch(point.name, center, deps, 5).catch(() => []));
  if (k) return { lat: k.lat, lng: k.lng, source: 'kakao' };
  if (deps.osmCalls++) await (deps.wait || pause)(1100); // Nominatim 은 초당 1회
  const queries = region && point.name.indexOf(region) < 0 ? [point.name + ' ' + region, point.name] : [point.name];
  for (const q of queries) {
    const o = (await osmSearch(q, deps, 3).catch(() => [])).find((d) => near(center, d));
    // OSM 은 엉뚱한 동명이인이 많아서 먼 결과는 쓰지 않아요
    if (o) return { lat: o.lat, lng: o.lng, source: 'osm' };
  }
  return null;
}

/**
 * 여행 일정 전체의 날짜별 루트.
 * itinerary: loadItinerary 결과 { days, lodgings } · trip: { id, region }
 * → { center, days: [{ dayNo, date, points: [{ key, name, kind, role, url, lat, lng, status, source }] }], pending }
 */
async function tripRoutes(trip, itinerary, deps) {
  const sql = deps.sql;
  const fetchImpl = deps.fetch || globalThis.fetch;
  const ctx = { sql, fetch: fetchImpl, env: deps.env, wait: deps.wait, osmCalls: 0 };
  const now = deps.now ? deps.now() : Date.now();
  const center = await geocodeRegion(trip.region, sql, fetchImpl, deps.wait).catch(() => null);
  const I = require('../assets/itinerary-core.js');

  const days = (itinerary.days || []).map((d) => {
    const lodgings = (itinerary.lodgings || []).filter((l) => I.lodgingNights(l.checkIn, l.nights).indexOf(d.date) >= 0);
    return { dayNo: d.dayNo, date: d.date, points: R.dayPoints(d, lodgings) };
  });

  const saved = await sql`SELECT name_key, lat, lng, source, updated_at FROM place_coords WHERE trip_id = ${trip.id}`;
  const known = {};
  saved.rows.forEach((r) => { known[r.name_key] = r; });

  const started = Date.now();
  let pending = false;
  for (const day of days) {
    for (const p of day.points) {
      let row = known[p.key];
      const stale = row && row.lat === null && row.source !== 'manual' && now - new Date(row.updated_at).getTime() > RETRY_MS;
      if (!row || stale) {
        if (Date.now() - started > LOOKUP_BUDGET_MS) {
          pending = true;
          p.lat = null; p.lng = null; p.source = null; p.status = 'pending';
          continue;
        }
        const found = await lookup(p, center, regionWord(trip.region), ctx);
        row = { name_key: p.key, lat: found ? found.lat : null, lng: found ? found.lng : null, source: found ? found.source : 'none' };
        await sql`
          INSERT INTO place_coords (trip_id, name_key, name, lat, lng, source, map_url)
          VALUES (${trip.id}, ${p.key}, ${p.name}, ${row.lat}, ${row.lng}, ${row.source}, ${p.url})
          ON CONFLICT (trip_id, name_key) DO UPDATE SET name = EXCLUDED.name, lat = EXCLUDED.lat, lng = EXCLUDED.lng,
            source = EXCLUDED.source, map_url = EXCLUDED.map_url, updated_at = now()`;
        known[p.key] = row;
      }
      if (row && row.lat !== null && row.lat !== undefined) {
        p.lat = Number(row.lat);
        p.lng = Number(row.lng);
        p.source = row.source;
        p.status = near(center, p) ? 'ok' : 'far';
      } else {
        p.lat = null; p.lng = null; p.source = row ? row.source : null;
        p.status = row ? 'missing' : 'pending';
      }
    }
  }
  return { center, days, pending };
}

/** "위치 고치기": 링크 또는 고른 좌표로 저장 → { lat, lng } | { error } */
async function savePlace(tripId, input, deps) {
  const name = String(input.name || '').trim();
  const key = R.nameKey(name);
  if (!key) return { error: '장소 이름이 필요해요.' };
  let lat = Number(input.lat);
  let lng = Number(input.lng);
  const url = String(input.url || '').trim() || null;
  if (url && !(Number.isFinite(lat) && Number.isFinite(lng))) {
    const c = await coordsFromLink(url, deps.fetch || globalThis.fetch);
    if (!c) return { error: '이 링크에서는 위치를 못 찾았어요. 아래 검색으로 골라 주세요.' };
    lat = c.lat; lng = c.lng;
  }
  if (!(Number.isFinite(lat) && Number.isFinite(lng) && Math.abs(lat) <= 90 && Math.abs(lng) <= 180)) {
    return { error: '위치가 올바르지 않아요.' };
  }
  await deps.sql`
    INSERT INTO place_coords (trip_id, name_key, name, lat, lng, source, map_url)
    VALUES (${tripId}, ${key}, ${name}, ${lat}, ${lng}, 'manual', ${url})
    ON CONFLICT (trip_id, name_key) DO UPDATE SET name = EXCLUDED.name, lat = EXCLUDED.lat, lng = EXCLUDED.lng,
      source = 'manual', map_url = EXCLUDED.map_url, updated_at = now()`;
  return { lat, lng };
}

/** "위치 고치기" 검색: 카카오 + OpenStreetMap, 여행 지역 가까운 곳 먼저 */
async function searchPlaces(trip, query, deps) {
  const q = String(query || '').trim().slice(0, 80);
  if (!q) return [];
  const fetchImpl = deps.fetch || globalThis.fetch;
  const ctx = { fetch: fetchImpl, env: deps.env };
  const center = await geocodeRegion(trip.region, deps.sql, fetchImpl, deps.wait).catch(() => null);
  const [k, o] = await Promise.all([
    kakaoSearch(q, center, ctx, 8).catch(() => []),
    osmSearch(q, ctx, 4).catch(() => []),
  ]);
  const all = k.concat(o).filter((p) => Number.isFinite(p.lat) && Number.isFinite(p.lng));
  all.forEach((p) => { p.km = center ? Math.round(R.distanceKm(center, p)) : null; });
  return all.sort((a, b) => (a.km === null ? 0 : a.km > R.FAR_KM) - (b.km === null ? 0 : b.km > R.FAR_KM)).slice(0, 10);
}

module.exports = { tripRoutes, savePlace, searchPlaces, coordsFromLink, followRedirects };
