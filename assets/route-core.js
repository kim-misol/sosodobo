/**
 * 일정 지도 루트의 순수 로직 (브라우저 window.RouteCore / 서버 api/_route.js · 테스트에서 require).
 * - 그날의 장소 순서: 주차 · 코스 전 이동(일정에 넣은 순서대로) → 코스(출발 → 도착) → 코스 후 이동 → 그날 밤 숙소
 * - 구글 · 네이버 · 카카오 지도 링크에서 좌표(WGS84) 꺼내기
 * 같은 이름의 장소는 여행 안에서 한 좌표를 같이 써요 (nameKey).
 */
(function (root) {
  'use strict';

  var KINDS = {
    parking: { label: '주차', color: '#D4CCF2', soft: '#EEEAFB' },
    move: { label: '이동', color: '#D4CCF2', soft: '#EEEAFB' },
    course: { label: '코스', color: '#FFB997', soft: '#FFE4D6' },
    lodging: { label: '숙소', color: '#B5DFCB', soft: '#DDEFE8' },
  };
  var FAR_KM = 150; // 여행 지역에서 이보다 먼 곳(예: 출발 공항)은 지도에서 빼요

  function clean(s) { return s === null || s === undefined ? '' : String(s).trim(); }

  /** 같은 장소인지 비교하는 열쇠: 공백 · 대소문자 · 문장부호 무시 */
  function nameKey(name) {
    return clean(name).toLowerCase().replace(/[\s·.,()\[\]'"!?~\-_/]+/g, '');
  }

  function sortItems(items) {
    return (items || []).slice().sort(function (a, b) { return (a.position - b.position) || (a.id - b.id); });
  }

  /**
   * 그날 지도에 찍을 장소들 (연달아 같은 곳은 한 번).
   * day: { items: [...] }, lodgings: 그날 밤 숙소 목록
   * → [{ key, name, kind, role, url }]
   */
  function dayPoints(day, lodgings) {
    var items = sortItems(day && day.items);
    var out = [];
    var stay = (lodgings || [])[0];
    var push = function (name, kind, role, url) {
      var n = clean(name);
      // "1일차 숙소" · "숙소" 처럼 지도에 없는 이름은 그날 밤 숙소로
      if (stay && kind === 'move' && /숙소/.test(n) && n.length <= 12) { n = clean(stay.name); url = url || stay.mapUrl; }
      var key = nameKey(n);
      if (!key) return;
      var prev = out[out.length - 1];
      if (prev && prev.key === key) {
        if (!prev.url && url) prev.url = url;
        return;
      }
      out.push({ key: key, name: n, kind: kind, role: role, url: clean(url) || null });
    };
    var moves = function (timing) {
      items.filter(function (i) { return i.kind === 'move' && (timing === 'after' ? i.timing === 'after' : i.timing !== 'after'); })
        .forEach(function (m) { push(m.fromPlace, 'move', '출발', null); push(m.toPlace, 'move', '도착', null); });
    };
    // 주차와 코스 전 이동은 일정에 넣은 순서대로 섞어서 (예: 비행기로 도착 → 주차)
    items.filter(function (i) { return i.kind === 'parking' || (i.kind === 'move' && i.timing !== 'after'); }).forEach(function (i) {
      if (i.kind === 'parking') push(i.name, 'parking', '주차', i.mapUrl);
      else { push(i.fromPlace, 'move', '출발', null); push(i.toPlace, 'move', '도착', null); }
    });
    // 코스는 순서대로: 출발 → (지도 링크가 있으면 그 위치) → 도착. 출발 · 도착이 없으면 코스 자체 (링크가 있으면 링크 위치)
    items.filter(function (i) { return i.kind === 'course'; }).forEach(function (c) {
      var link = clean(c.mapUrl);
      if (clean(c.fromPlace) || clean(c.toPlace)) {
        push(c.fromPlace, 'course', '코스 출발', null);
        if (link) push(c.name, 'course', '코스', link);
        push(c.toPlace, 'course', '코스 도착', null);
      } else {
        push(c.name, 'course', '코스', link);
      }
    });
    moves('after');
    (lodgings || []).forEach(function (l) { push(l.name, 'lodging', '숙소', l.mapUrl); });
    return out;
  }

  function num(v) { var n = Number(v); return Number.isFinite(n) ? n : null; }
  function valid(lat, lng) {
    return lat !== null && lng !== null && Math.abs(lat) <= 90 && Math.abs(lng) <= 180 && !(lat === 0 && lng === 0) ? { lat: lat, lng: lng } : null;
  }

  /** 웹 메르카토르(EPSG:3857) 미터 → 위도 · 경도 (네이버 지도 일부 링크) */
  function mercatorToLatLng(x, y) {
    var lng = x / 20037508.34 * 180;
    var lat = Math.atan(Math.exp(y / 20037508.34 * Math.PI)) * 360 / Math.PI - 90;
    return valid(lat, lng);
  }

  /**
   * 지도 링크 → { lat, lng } | null
   * 구글: !3d위도!4d경도 (장소 정확한 위치) · @위도,경도 · ?q=/query=/ll=/center=위도,경도
   * 네이버: lat=&lng= · c=경도,위도(또는 메르카토르 미터)
   * 카카오: /link/map/이름,위도,경도 · /link/to/이름,위도,경도
   * 기타: geo:위도,경도
   */
  function parseMapUrl(url) {
    var u = clean(url);
    if (!u) return null;
    var dec = u;
    try { dec = decodeURIComponent(u); } catch (e) { /* 그대로 */ }
    var m = /!3d(-?\d+(?:\.\d+)?)!4d(-?\d+(?:\.\d+)?)/.exec(dec);
    if (m) return valid(num(m[1]), num(m[2]));
    m = /\/link\/(?:map|to)\/[^,]*,(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?)/.exec(dec);
    if (m) return valid(num(m[1]), num(m[2]));
    m = /[?&]lat=(-?\d+(?:\.\d+)?)[^#]*?[?&]lng=(-?\d+(?:\.\d+)?)/.exec(dec) || null;
    if (m) return valid(num(m[1]), num(m[2]));
    m = /[?&]lng=(-?\d+(?:\.\d+)?)[^#]*?[?&]lat=(-?\d+(?:\.\d+)?)/.exec(dec);
    if (m) return valid(num(m[2]), num(m[1]));
    m = /@(-?\d+\.\d+),(-?\d+\.\d+)/.exec(dec);
    if (m) return valid(num(m[1]), num(m[2]));
    m = /[?&](?:q|query|ll|center|destination)=(-?\d+\.\d+),\s*(-?\d+\.\d+)/.exec(dec);
    if (m) return valid(num(m[1]), num(m[2]));
    m = /^geo:(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?)/.exec(dec);
    if (m) return valid(num(m[1]), num(m[2]));
    // 네이버: c=경도,위도,줌… 또는 c=메르카토르x,y,줌…
    m = /map\.naver\.com[^#]*[?&]c=(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?)/.exec(dec);
    if (m) {
      var a = num(m[1]);
      var b = num(m[2]);
      if (Math.abs(a) > 180 || Math.abs(b) > 90) return mercatorToLatLng(a, b);
      if (Math.abs(a) > 30) return valid(b, a); // 경도, 위도
    }
    return null;
  }

  /** 따라가야 좌표가 나오는 짧은 공유 링크 */
  function isShortMapUrl(url) {
    return /^https?:\/\/(maps\.app\.goo\.gl|goo\.gl\/maps|naver\.me|kko\.to|place\.map\.kakao\.com|map\.naver\.com\/p\/|m\.place\.naver\.com|app\.map\.kakao\.com)/i.test(clean(url));
  }

  function distanceKm(a, b) {
    if (!a || !b) return null;
    var rad = Math.PI / 180;
    var dLat = (b.lat - a.lat) * rad;
    var dLng = (b.lng - a.lng) * rad;
    var h = Math.sin(dLat / 2) * Math.sin(dLat / 2) + Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(dLng / 2) * Math.sin(dLng / 2);
    return 6371 * 2 * Math.asin(Math.min(1, Math.sqrt(h)));
  }

  function ll(p) { return p.lat.toFixed(6) + ',' + p.lng.toFixed(6); }

  /** 구글 지도 전체 길찾기 (출발 → 경유 → 도착, 찾은 곳만) */
  function googleDirectionsUrl(points) {
    var ok = (points || []).filter(function (p) { return p.lat !== null && p.lat !== undefined; });
    if (ok.length < 2) return null;
    var q = 'https://www.google.com/maps/dir/?api=1&origin=' + ll(ok[0]) + '&destination=' + ll(ok[ok.length - 1]);
    var mid = ok.slice(1, -1).slice(0, 9).map(ll);
    if (mid.length) q += '&waypoints=' + encodeURIComponent(mid.join('|'));
    return q + '&travelmode=driving';
  }

  /** 한 장소를 지도 앱에서: 붙여 넣은 원래 링크, 없으면 카카오맵 */
  function placeUrl(p) {
    if (p.url) return p.url;
    if (p.lat === null || p.lat === undefined) return 'https://map.kakao.com/?q=' + encodeURIComponent(p.name);
    return 'https://map.kakao.com/link/map/' + encodeURIComponent(p.name) + ',' + p.lat + ',' + p.lng;
  }

  var RouteCore = {
    KINDS: KINDS, FAR_KM: FAR_KM, nameKey: nameKey, dayPoints: dayPoints, parseMapUrl: parseMapUrl,
    mercatorToLatLng: mercatorToLatLng, isShortMapUrl: isShortMapUrl, distanceKm: distanceKm,
    googleDirectionsUrl: googleDirectionsUrl, placeUrl: placeUrl,
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = RouteCore;
  if (root) root.RouteCore = RouteCore;
})(typeof window !== 'undefined' ? window : null);
