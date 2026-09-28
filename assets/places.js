/**
 * 여행 정보: 첫날 날짜와 일정에 나오는 장소 목록.
 *
 * - TRIP_START_DATE(1일차 날짜)로 사진 촬영 날짜와 1·2·3일차를 연결합니다.
 *   (올릴 때·시각을 고칠 때 일차가 자동으로 정해지고, 일차 탭에 날짜가 붙어요.)
 * - 장소의 lat/lng 를 채우면, 사진 GPS 와 가까운(1km 이내) 장소 이름이 자동으로 붙습니다.
 *   (정확하지 않은 좌표를 넣지 않으려고 비워 두었어요. 지도 앱에서 좌표를 복사해 채워 주세요.)
 * - 좌표가 없어도 사진의 '위치 수정'에서 이 목록을 골라 장소를 지정할 수 있습니다.
 */
(function (root) {
  'use strict';

  var TripPlaces = {
    TRIP_START_DATE: '2026-09-24', // 1일차 날짜 (한국 시간). 2일차 = 9/25, 3일차 = 9/26
    // 슬라이드 영상의 시작 카드·일차 타이틀에 쓰는 이름
    TRIP_TITLE: '남해 바래길',
    TRIP_SUBTITLE: '3일 도보여행',
    DAY_NAMES: { 1: '동대만길', 2: '말발굽길 + 고사리밭길', 3: '발 닿는대로' },
    PLACES: [
      { id: 'dandang', day: 1, name: '창선대교 단항검문소', lat: null, lng: null },
      { id: 'dongdaeman', day: 1, name: '동대만길', lat: null, lng: null },
      { id: 'changseon-office', day: 1, name: '창선면행정복지센터', lat: null, lng: null },
      { id: 'stay1', day: 1, name: '1일차 숙소 · 남해는, 지금', lat: null, lng: null },
      { id: 'changseongyo', day: 2, name: '창선교', lat: null, lng: null },
      { id: 'jeokryang', day: 2, name: '적량마을', lat: null, lng: null },
      { id: 'malbalgup', day: 2, name: '말발굽길', lat: null, lng: null },
      { id: 'gosari', day: 2, name: '고사리밭길', lat: null, lng: null },
      { id: 'gain', day: 2, name: '가인리', lat: null, lng: null },
      { id: 'stay2', day: 2, name: '2일차 숙소 · 파도가 머무는 정원', lat: null, lng: null },
    ],
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = TripPlaces;
  if (root) root.TripPlaces = TripPlaces;
})(typeof window !== 'undefined' ? window : null);
