/**
 * 날씨 · 일출/일몰 화면.
 * - 여행 표지(#top)에 여행 전체 요약 한 줄
 * - 일정의 날짜 카드마다 한 줄 (itinerary-ui.js 가 WeatherUI.dayLine(date) 로 가져감)
 * 데이터는 api/trips?id=&part=weather (Open-Meteo 예보 · 기록, 먼 미래는 일출·일몰만).
 *
 * 필요 전역: WeatherCore, TripContext
 */
(function () {
  'use strict';

  var W = window.WeatherCore;
  var state = { trip: null, data: null, byDate: {} };

  function esc(s) {
    return String(s === null || s === undefined ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  function shortDate(dateStr) {
    var d = new Date(Date.parse(dateStr + 'T00:00:00Z'));
    return (d.getUTCMonth() + 1) + '/' + d.getUTCDate();
  }

  /** 날짜 카드에 넣을 한 줄 HTML (없으면 빈 문자열) */
  function dayLine(date) {
    var d = state.byDate[date];
    if (!d) return '';
    var parts = [];
    var wx = W.weatherText(d);
    if (wx) parts.push('<span class="wx-main">' + esc(wx) + '</span>');
    if (d.sunrise && d.sunset) parts.push('<span class="wx-sun">🌅 ' + esc(d.sunrise) + ' · 🌇 ' + esc(d.sunset) + '</span>');
    if (d.kind === 'far' && state.data && state.data.forecastOpensOn) {
      parts.push('<span class="wx-note">예보는 ' + esc(shortDate(state.data.forecastOpensOn)) + '부터</span>');
    }
    if (!parts.length) return '';
    var label = d.kind === 'past' ? '그날 날씨' : d.kind === 'far' ? '일출 · 일몰' : '날씨 예보';
    return '<p class="it-wx" aria-label="' + label + '">' + parts.join('') + '</p>';
  }

  function renderCover() {
    var head = document.getElementById('top');
    if (!head) return;
    var old = head.querySelector('.wx-summary');
    if (old) old.remove();
    var s = state.data && W.summarize(state.data.days, state.data.forecastOpensOn);
    if (!s) return;
    var el = document.createElement('p');
    el.className = 'wx-summary';
    el.innerHTML = '<span>' + esc(s.text) + '</span>' +
      (state.data.location && state.data.location.name ? '<span class="wx-where">' + esc(state.data.location.name) + ' 기준</span>' : '') +
      (s.note ? '<span class="wx-where">' + esc(s.note) + '</span>' : '');
    var status = head.querySelector('#m-trip-status');
    head.insertBefore(el, status || null);
  }

  function load(trip) {
    if (!W || !trip) return;
    state.trip = trip;
    fetch('api/trips?id=' + trip.id + '&part=weather')
      .then(function (res) { return res.ok ? res.json() : null; })
      .then(function (data) {
        if (!data || !data.days) return;
        state.data = data;
        state.byDate = {};
        data.days.forEach(function (d) { state.byDate[d.date] = d; });
        renderCover();
        if (window.ItineraryUI && window.ItineraryUI.rerender) window.ItineraryUI.rerender();
      })
      .catch(function () { /* 날씨는 없어도 되는 정보라 조용히 넘어감 */ });
  }

  window.WeatherUI = { dayLine: dayLine, reload: function () { load(state.trip); }, state: state };

  var boot = function () { if (window.TripContext) window.TripContext.ready.then(load); };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})();
