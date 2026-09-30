// 여행 날씨 · 일출/일몰 (api/trips.js 의 GET ?id=&part=weather 가 씀).
// - 장소: 여행 "지역"을 OpenStreetMap(Nominatim) 에서 좌표로 → app_meta 에 저장해 다시 묻지 않음.
//   못 찾으면 이 여행 사진들의 위치 가운데값.
// - 날씨: Open-Meteo (무료 · 키 없음). 예보 · 최근 기록 / 오래된 기록 / 먼 미래는 일출·일몰만 계산.
// - 같은 인스턴스 안에서 1시간(지난 여행만이면 하루) 기억해 두고 다시 묻지 않음.
const W = require('../assets/weather-core.js');

const UA = 'sosodobo/1.0 (+https://sosodobo.vercel.app)';
const DAILY_FORECAST = 'weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max,precipitation_sum,sunrise,sunset';
const DAILY_ARCHIVE = 'weather_code,temperature_2m_max,temperature_2m_min,precipitation_sum,sunrise,sunset';
const cache = new Map();

async function getJson(fetchImpl, url) {
  const res = await fetchImpl(url, { headers: { 'User-Agent': UA, Accept: 'application/json' } });
  if (!res.ok) throw new Error('weather upstream ' + res.status);
  return res.json();
}

/** 지역 이름 → { lat, lng, name } | null. 찾은 결과(못 찾은 것도)는 app_meta 에 저장 */
async function geocodeRegion(region, sql, fetchImpl, wait) {
  const pause = wait || ((ms) => new Promise((r) => setTimeout(r, ms)));
  const queries = W.regionQueries(region);
  if (!queries.length) return null;
  const key = 'geo:' + queries[0];
  const saved = await sql`SELECT value FROM app_meta WHERE key = ${key}`;
  if (saved.rows.length) {
    try { return JSON.parse(saved.rows[0].value); } catch { /* 다시 찾기 */ }
  }
  let found = null;
  let asked = 0;
  // 도시 · 마을 단위를 먼저, 없으면 아무 장소나 (Nominatim 은 초당 1회 이하로)
  for (const q of queries.slice(0, 3)) {
    for (const extra of ['&featureType=settlement', '']) {
      if (asked++) await pause(1100);
      const url = 'https://nominatim.openstreetmap.org/search?format=jsonv2&limit=1&accept-language=ko' + extra + '&q=' + encodeURIComponent(q);
      const list = await getJson(fetchImpl, url);
      if (Array.isArray(list) && list.length) {
        found = { lat: Number(list[0].lat), lng: Number(list[0].lon), name: String(list[0].display_name || q).split(',')[0].trim() };
        break;
      }
    }
    if (found) break;
  }
  const value = JSON.stringify(found);
  await sql`INSERT INTO app_meta (key, value) VALUES (${key}, ${value}) ON CONFLICT (key) DO UPDATE SET value = ${value}`;
  return found;
}

/** 이 여행 사진 위치의 가운데값 (지역으로 못 찾을 때) */
async function photoCenter(tripId, sql) {
  const r = await sql`SELECT lat, lng FROM photos WHERE trip_id = ${tripId} AND lat IS NOT NULL AND lng IS NOT NULL`;
  if (!r.rows.length) return null;
  const mid = (arr) => { const s = arr.slice().sort((a, b) => a - b); return s[Math.floor(s.length / 2)]; };
  return { lat: mid(r.rows.map((x) => Number(x.lat))), lng: mid(r.rows.map((x) => Number(x.lng))), name: '사진 위치' };
}

function meteoUrl(base, daily, loc, from, to) {
  return base + '?latitude=' + loc.lat.toFixed(4) + '&longitude=' + loc.lng.toFixed(4) +
    '&daily=' + daily + '&timezone=auto&start_date=' + from + '&end_date=' + to;
}

/**
 * trip: { id, region, startDate, days } → { location, days: [...], forecastOpensOn }
 * deps: { sql, fetch, now }
 */
async function tripWeather(trip, deps) {
  const fetchImpl = deps.fetch || globalThis.fetch;
  const nowMs = deps.now ? deps.now() : Date.now();
  const today = W.todayKst(nowMs);
  const cacheKey = [trip.id, trip.region, trip.startDate, trip.days, today].join('|');
  const hit = cache.get(cacheKey);
  if (hit && hit.until > nowMs) return hit.value;

  let loc = await geocodeRegion(trip.region, deps.sql, fetchImpl, deps.wait).catch(() => null);
  if (!loc) loc = await photoCenter(trip.id, deps.sql);
  const plan = W.planRanges(trip.startDate, trip.days, today);
  if (!loc) {
    return { location: null, days: [], forecastOpensOn: plan.forecastOpensOn };
  }

  const byDate = {};
  let offsetSec = null;
  const load = async (base, daily, range, kind) => {
    const data = await getJson(fetchImpl, meteoUrl(base, daily, loc, range[0], range[1]));
    if (Number.isFinite(data.utc_offset_seconds)) offsetSec = data.utc_offset_seconds;
    const parsed = W.parseDaily(data.daily);
    Object.keys(parsed).forEach((d) => { byDate[d] = Object.assign(parsed[d], { kind: d < today ? 'past' : kind }); });
  };
  const jobs = [];
  if (plan.forecast) jobs.push(load('https://api.open-meteo.com/v1/forecast', DAILY_FORECAST, plan.forecast, 'forecast'));
  if (plan.archive) jobs.push(load('https://archive-api.open-meteo.com/v1/archive', DAILY_ARCHIVE, plan.archive, 'past'));
  await Promise.all(jobs.map((j) => j.catch(() => null))); // 날씨를 못 받아도 일출·일몰은 보여 줌

  // 먼 미래(또는 못 받은 날)는 일출·일몰만 계산 — 시간대는 받은 응답, 없으면 경도로 어림
  const offsetMin = offsetSec !== null ? offsetSec / 60 : Math.round(loc.lng / 15) * 60;
  const days = plan.dates.map((date, i) => {
    const d = byDate[date];
    if (d && d.sunrise) return Object.assign({ dayNo: i + 1 }, d);
    const sun = W.sunTimes(date, loc.lat, loc.lng, offsetMin) || { sunrise: null, sunset: null };
    return { date, dayNo: i + 1, kind: plan.far.indexOf(date) >= 0 ? 'far' : (date < today ? 'past' : 'forecast'),
      code: null, tmax: null, tmin: null, pop: null, precip: null, sunrise: sun.sunrise, sunset: sun.sunset };
  });

  const value = { location: { name: loc.name, lat: loc.lat, lng: loc.lng }, days, forecastOpensOn: plan.forecastOpensOn };
  const allPast = days.every((d) => d.kind === 'past' || d.kind === 'far');
  cache.set(cacheKey, { until: nowMs + (allPast ? 24 : 1) * 3600000, value });
  return value;
}

module.exports = { tripWeather, geocodeRegion, _cache: cache };
