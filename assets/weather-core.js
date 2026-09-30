/**
 * 날씨 · 일출/일몰의 순수 로직 (브라우저 window.WeatherCore / 서버 api/_weather.js · 테스트에서 require).
 * 날씨는 Open-Meteo(무료 · 키 없음)에서 받아요:
 *   - 오늘부터 FORECAST_DAYS 일 안: 예보 · 최근 PAST_FORECAST_DAYS 일 안의 지난 날: 같은 API 의 기록
 *   - 그보다 오래된 지난 날: 과거 기록(archive) API
 *   - 그보다 먼 미래: 날씨 없음 (일출/일몰만 계산)
 */
(function (root) {
  'use strict';

  var FORECAST_DAYS = 15;      // 오늘 + 15일 (Open-Meteo 예보는 16일치)
  var PAST_FORECAST_DAYS = 90; // 예보 API 가 돌려주는 지난 날 (92일까지)

  // WMO 날씨 코드 → 아이콘 · 이름
  var CODES = [
    [[0], '☀️', '맑음'],
    [[1], '🌤', '대체로 맑음'],
    [[2], '⛅', '구름 조금'],
    [[3], '☁️', '흐림'],
    [[45, 48], '🌫', '안개'],
    [[51, 53, 55, 56, 57], '🌦', '이슬비'],
    [[61, 63, 66], '🌧', '비'],
    [[65, 67], '🌧', '많은 비'],
    [[71, 73, 75, 77], '🌨', '눈'],
    [[80, 81, 82], '🌦', '소나기'],
    [[85, 86], '🌨', '눈 소나기'],
    [[95, 96, 99], '⛈', '뇌우'],
  ];

  function codeInfo(code) {
    var c = Number(code);
    for (var i = 0; i < CODES.length; i++) {
      if (CODES[i][0].indexOf(c) >= 0) return { icon: CODES[i][1], label: CODES[i][2] };
    }
    return { icon: '🌡', label: '날씨' };
  }

  /** 비 · 눈이 오는 날씨 코드인지 */
  function isWet(code) {
    return Number(code) >= 51;
  }

  function pad(n) { return (n < 10 ? '0' : '') + n; }

  function addDays(dateStr, n) {
    var d = new Date(Date.parse(dateStr + 'T00:00:00Z') + n * 86400000);
    return d.getUTCFullYear() + '-' + pad(d.getUTCMonth() + 1) + '-' + pad(d.getUTCDate());
  }

  function diffDays(a, b) {
    return Math.round((Date.parse(b + 'T00:00:00Z') - Date.parse(a + 'T00:00:00Z')) / 86400000);
  }

  /** 지금 시각의 한국 날짜 (YYYY-MM-DD) */
  function todayKst(nowMs) {
    return new Date(nowMs + 9 * 3600000).toISOString().slice(0, 10);
  }

  /**
   * 여행 날짜들을 어디서 받을지 나눔.
   * → { dates, forecast: [from, to] | null, archive: [from, to] | null, far: [dates], forecastOpensOn }
   */
  function planRanges(startDate, days, today) {
    var dates = [];
    for (var i = 0; i < days; i++) dates.push(addDays(startDate, i));
    var forecastDates = [];
    var archiveDates = [];
    var far = [];
    dates.forEach(function (d) {
      var ahead = diffDays(today, d);
      if (ahead > FORECAST_DAYS) far.push(d);
      else if (ahead < -PAST_FORECAST_DAYS) archiveDates.push(d);
      else forecastDates.push(d);
    });
    var range = function (list) { return list.length ? [list[0], list[list.length - 1]] : null; };
    return {
      dates: dates,
      forecast: range(forecastDates),
      archive: range(archiveDates),
      far: far,
      forecastOpensOn: far.length ? addDays(far[0], -FORECAST_DAYS) : null,
    };
  }

  /**
   * 일출 · 일몰 (NOAA 근사식, 1~2분 오차). offsetMin 은 그 지역의 UTC 와의 차이(분).
   * → { sunrise: 'HH:MM', sunset: 'HH:MM' } | null (백야 · 극야)
   */
  function sunTimes(dateStr, lat, lng, offsetMin) {
    var rad = Math.PI / 180;
    var jDate = Date.parse(dateStr + 'T12:00:00Z') / 86400000 + 2440587.5;
    var n = Math.round(jDate - 2451545.0 + 0.0008);
    var jStar = n - lng / 360;
    var M = (357.5291 + 0.98560028 * jStar) % 360;
    var C = 1.9148 * Math.sin(M * rad) + 0.02 * Math.sin(2 * M * rad) + 0.0003 * Math.sin(3 * M * rad);
    var L = (M + C + 180 + 102.9372) % 360;
    var jTransit = 2451545.0 + jStar + 0.0053 * Math.sin(M * rad) - 0.0069 * Math.sin(2 * L * rad);
    var sinD = Math.sin(L * rad) * Math.sin(23.4397 * rad);
    var cosD = Math.cos(Math.asin(sinD));
    var cosW = (Math.sin(-0.833 * rad) - Math.sin(lat * rad) * sinD) / (Math.cos(lat * rad) * cosD);
    if (cosW < -1 || cosW > 1) return null;
    var w = Math.acos(cosW) / rad;
    var toClock = function (j) {
      var ms = (j - 2440587.5) * 86400000 + (offsetMin || 0) * 60000;
      var d = new Date(Math.round(ms / 60000) * 60000);
      return pad(d.getUTCHours()) + ':' + pad(d.getUTCMinutes());
    };
    return { sunrise: toClock(jTransit - w / 360), sunset: toClock(jTransit + w / 360) };
  }

  /** "2026-09-24T06:17" → "06:17" */
  function clockOf(iso) {
    var m = /T(\d{2}:\d{2})/.exec(String(iso || ''));
    return m ? m[1] : null;
  }

  /**
   * Open-Meteo daily 응답 → 날짜별 { date, code, tmax, tmin, pop, precip, sunrise, sunset }
   */
  function parseDaily(daily) {
    var out = {};
    if (!daily || !Array.isArray(daily.time)) return out;
    daily.time.forEach(function (date, i) {
      var num = function (key) {
        var arr = daily[key];
        var v = arr ? arr[i] : null;
        return v === null || v === undefined || !isFinite(v) ? null : Number(v);
      };
      out[date] = {
        date: date,
        code: num('weather_code'),
        tmax: num('temperature_2m_max'),
        tmin: num('temperature_2m_min'),
        pop: num('precipitation_probability_max'),
        precip: num('precipitation_sum'),
        sunrise: clockOf(daily.sunrise && daily.sunrise[i]),
        sunset: clockOf(daily.sunset && daily.sunset[i]),
      };
    });
    return out;
  }

  /** 지역 이름에서 장소 검색어 후보 ("남해 · 창선면 일대" → ["남해 창선면", "남해", "창선면"]) */
  function regionQueries(region) {
    var clean = String(region || '')
      .replace(/[()[\]]/g, ' ')
      .replace(/(일대|근처|부근|주변|인근|쪽)/g, ' ');
    var parts = clean.split(/[·,/|~>→\-]+/).map(function (s) { return s.replace(/\s+/g, ' ').trim(); }).filter(Boolean);
    var out = [];
    var push = function (q) { if (q && out.indexOf(q) < 0) out.push(q); };
    push(parts.join(' '));
    parts.forEach(push);
    return out;
  }

  function round(t) { return t === null || t === undefined ? null : Math.round(t); }

  /** 날짜 카드 한 줄: "☀️ 맑음 27°/20° · 강수확률 10%" (날씨가 없으면 빈 문자열) */
  function weatherText(day) {
    if (!day || day.code === null || day.code === undefined) return '';
    var info = codeInfo(day.code);
    var parts = [info.icon + ' ' + info.label];
    if (day.tmax !== null && day.tmin !== null) parts[0] += ' ' + round(day.tmax) + '°/' + round(day.tmin) + '°';
    if (day.kind === 'forecast' && day.pop !== null && day.pop !== undefined) parts.push('강수확률 ' + day.pop + '%');
    else if (day.kind === 'past' && day.precip) parts.push('강수 ' + (Math.round(day.precip * 10) / 10) + 'mm');
    return parts.join(' · ');
  }

  function shortDate(dateStr) {
    var d = new Date(Date.parse(dateStr + 'T00:00:00Z'));
    return (d.getUTCMonth() + 1) + '/' + d.getUTCDate();
  }

  /**
   * 표지에 넣을 여행 전체 요약.
   * days: [{ date, dayNo, kind: 'forecast'|'past'|'far', code, tmax, tmin, pop }]
   * → { text, note } | null
   */
  function summarize(days, forecastOpensOn) {
    var list = days || [];
    var known = list.filter(function (d) { return d.kind !== 'far' && d.code !== null && d.code !== undefined; });
    if (!known.length) {
      return forecastOpensOn ? { text: '🌤 날씨 예보는 ' + shortDate(forecastOpensOn) + '부터 보여요', note: null } : null;
    }
    var past = known.every(function (d) { return d.kind === 'past'; });
    var wet = known.filter(function (d) {
      return isWet(d.code) || (d.kind === 'forecast' && d.pop !== null && d.pop !== undefined && d.pop >= 50);
    });
    // 대표 아이콘: 비 오는 날이 절반 이상이면 비, 아니면 가장 많이 나온 날씨
    var counts = {};
    known.forEach(function (d) { var k = codeInfo(d.code).icon; counts[k] = (counts[k] || 0) + 1; });
    var icon = wet.length * 2 >= known.length ? codeInfo(wet[0].code >= 51 ? wet[0].code : 61).icon
      : Object.keys(counts).sort(function (a, b) { return counts[b] - counts[a]; })[0];
    var highs = known.map(function (d) { return d.tmax; }).filter(function (t) { return t !== null; });
    var lows = known.map(function (d) { return d.tmin; }).filter(function (t) { return t !== null; });
    var temp = highs.length && lows.length ? round(Math.min.apply(null, lows)) + '~' + round(Math.max.apply(null, highs)) + '°' : '';
    var rain = !wet.length ? (past ? '비 없음' : '비 소식 없음')
      : wet.length === known.length ? (past ? '내내 비' : '내내 비 소식')
      : '비: ' + wet.map(function (d) { return 'DAY ' + d.dayNo; }).join(', ');
    var text = (past ? '그때 날씨 ' : '날씨 ') + icon + ' ' + [temp, rain].filter(Boolean).join(' · ');
    var farCount = list.filter(function (d) { return d.kind === 'far'; }).length;
    return { text: text, note: farCount && forecastOpensOn ? '나머지 날은 ' + shortDate(forecastOpensOn) + '부터 예보' : null };
  }

  var WeatherCore = {
    FORECAST_DAYS: FORECAST_DAYS,
    PAST_FORECAST_DAYS: PAST_FORECAST_DAYS,
    codeInfo: codeInfo,
    isWet: isWet,
    addDays: addDays,
    diffDays: diffDays,
    todayKst: todayKst,
    planRanges: planRanges,
    sunTimes: sunTimes,
    clockOf: clockOf,
    parseDaily: parseDaily,
    regionQueries: regionQueries,
    weatherText: weatherText,
    summarize: summarize,
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = WeatherCore;
  if (root) root.WeatherCore = WeatherCore;
})(typeof window !== 'undefined' ? window : null);
