# Plan: Day 3 동대만길 이미지 캐러셀

## 상태: 완료

## 요구사항
- Day 3 섹션에서 "🚶 도보 코스 — 3코스 동대만길" 코스 카드와 "🚕 이동" 블록 사이에
  캐러셀(이미지 슬라이드) 형태로 동대만길 소개 이미지들을 추가한다.
- 이미지: 남해바래길 공식 홍보 자료(동대만길 편) 11장
  1. 타이틀(거리 안내 + 숲길)
  2. 코스 정보 카드(03 동대만길, 15km)
  3. 창선대교 소개
  4. 인생샷 포인트② 대방산
  5. 인생샷 포인트③ 왕후박나무
  6. 동대만 해안 마을 풍경
  7. 숲/하늘 풍경 3컷
  8. 숲길 전경
  9. 소초도 풍경
  10. 시작점(창선대교 단항검문소) 해안도로
  11. 마무리 안내(인스타그램, QR, 로고)
- 모바일에서 손가락으로 좌우 스와이프 가능해야 하고, 이전/다음 버튼과 인디케이터(점)도 필요.
- 기존 사이트는 순수 HTML/CSS/JS 정적 페이지이며 빌드 도구가 없다. 새 의존성을 추가하지 않고
  Node 내장 테스트 러너(`node:test`)만으로 TDD를 진행한다 (레포에 새 npm 의존성 없음).

## 접근 방식
1. 캐러셀의 핵심 로직(현재 인덱스 계산, 다음/이전 인덱스, 스크롤 위치 ↔ 인덱스 변환)을
   순수 함수로 `assets/carousel.js`에 분리해서 DOM 없이도 단위 테스트가 가능하게 만든다.
2. TDD: 실패하는 테스트(`tests/carousel.test.js`)를 먼저 작성한 뒤, 테스트를 통과시키는
   최소 구현을 `assets/carousel.js`에 작성한다.
3. 같은 파일에서 DOM 초기화 함수(`initCarousel`)는 위 순수 함수들을 사용하는 얇은 어댑터로 작성
   (버튼 클릭/스와이프 스크롤 이벤트 → 순수 함수 호출 → DOM 갱신).
4. `index.html`의 Day 3 섹션에 캐러셀 마크업을 추가하고 `assets/carousel.js`를 로드,
   `assets/day3-carousel.css`(또는 기존 `<style>` 블록)에 스타일 추가.
5. 이미지 11장을 웹용으로 리사이즈/압축해서 `assets/day3-carousel/`에 저장.
6. `node --test`로 단위 테스트 실행, 통과 확인.
7. 계획 문서 진행상황 업데이트, 커밋 메시지 작성.

## 테스트 전략
- 단위 테스트(순수 함수, `node:test` 사용, 외부 의존성 없음):
  - `wrapIndex`: 범위를 벗어난 인덱스가 올바르게 순환(wrap)되는지
  - `nextIndex` / `prevIndex`: 마지막에서 다음으로 가면 0으로, 처음에서 이전으로 가면
    마지막으로 순환되는지
  - `indexFromScroll`: 스크롤 위치를 슬라이드 인덱스로 정확히 환산하고 0~length-1로 clamp하는지
  - `scrollLeftForIndex`: 인덱스를 스크롤 위치로 정확히 환산하는지
- 수동 스모크 테스트: `index.html`을 브라우저에서 열어 캐러셀 스와이프/버튼/점 인디케이터 동작 확인
  (별도 브라우저 자동화 없이 로직 테스트로 핵심 회귀를 커버하고, 시각적 확인은 수동으로 진행)

## 변경 파일
- `assets/carousel.js` (신규) — 캐러셀 순수 로직 + DOM 초기화
- `tests/carousel.test.js` (신규) — 단위 테스트
- `index.html` — Day 3 섹션에 캐러셀 마크업 추가, `<style>`에 캐러셀 CSS 추가, 스크립트 로드
- `assets/day3-carousel/slide-01.jpg` ~ `slide-11.jpg` (신규) — 캐러셀 이미지
- `package.json` (신규, 최소) — `npm test` 스크립트만 정의 (의존성 없음)

## 진행 상황
- [x] 테스트 작성 (RED) — `tests/carousel.test.js`, `assets/carousel.js`가 없는 상태에서
      `node --test` 실행 시 `MODULE_NOT_FOUND`로 실패하는 것 확인
- [x] 구현 (GREEN) — `assets/carousel.js`에 `wrapIndex` / `nextIndex` / `prevIndex` /
      `scrollLeftForIndex` / `indexFromScroll` 순수 함수 + `initCarousel` DOM 어댑터 작성.
      Node(`require`)와 브라우저(`<script>`, `window.Carousel`) 양쪽에서 쓸 수 있도록
      export 처리.
- [x] 테스트 실행/통과 확인 — `node --test` 10/10 통과 (경계값·순환·0으로 나누기 방지 포함)
- [x] index.html에 캐러셀 삽입 + 이미지 추가 — Day 3 섹션의 "🚶 도보 코스 — 3코스 동대만길"
      카드와 "🚕 이동" 블록 사이에 "📸 동대만길 미리보기" 캐러셀 삽입. 이미지 11장을
      `assets/day3-carousel/slide-01.jpg`~`slide-11.jpg`로 웹용 리사이즈(900px 폭)/압축
      (JPEG quality 78) 후 배치.
- [x] 브라우저 스모크 테스트 — Playwright(Chromium)로 실제 페이지를 열어 확인:
      슬라이드 11장 · 점 인디케이터 11개 렌더링, 다음/이전 버튼 클릭 시 인덱스 정상 이동
      (0→1→0), 점 인디케이터 클릭으로 임의 슬라이드(11번째)로 이동, 이미지 정상 로드,
      DOM 순서가 "코스 카드 → 캐러셀 → 이동" 순서인지 확인 — 모두 통과.
- [x] 계획 문서 업데이트
- [x] 커밋 메시지 작성 (아래 "커밋 메시지" 참고)

## 커밋 메시지
```
feat: Day 3 동대만길 이미지 캐러셀 추가

- 코스 카드와 이동 안내 사이에 남해바래길 공식 홍보 이미지 11장을
  스와이프 가능한 캐러셀로 추가
- 캐러셀 인덱스/스크롤 계산 로직을 assets/carousel.js의 순수 함수로 분리하고
  node:test 기반 단위 테스트(tests/carousel.test.js)로 TDD 진행
- npm test로 실행 가능한 테스트 스크립트 추가 (외부 의존성 없음)
```
