# Plan: 여행 사진·영상 공유 앨범 (업로드 · 촬영정보 · 좋아요 · 댓글 · 슬라이드 영상)

## 상태: 1~8단계 구현 완료 · 커밋 전 (확인 대기)

> 이 문서가 요청하신 "plan.md" 역할을 합니다. 프로젝트 워크플로우의 파일명 규칙(`plan_<기능명>.md`)을
> 따라 새 파일을 만들지 않고 이 문서를 계속 업데이트합니다.

### 진행하면서 정한 기본값 (결정 사항 미확정 → 되돌리기 쉬운 쪽으로 선택)
| # | 항목 | 기본값 | 바꾸려면 |
|---|---|---|---|
| 1 | 공개 범위 | **A. 그대로 공개** + `noindex` (앨범 코드는 9단계 선택 기능이라 이번 범위 밖) | 9단계 진행 |
| 2 | 위치 표시 | 장소 이름 + 좌표 + 지도 링크 | `photo-ui.js`에서 좌표 줄 숨기기 |
| 3 | 삭제 권한 | 올린 사람만 | API 권한 체크 한 줄 |
| 4 | 영상 제한 | 1개당 **최대 60초 · 200MB**, 영상 속 위치 메타데이터는 그대로 둠 | `assets/photo-core.js`의 `LIMITS` |
| 5 | 여행 첫날 | 페이지에 날짜가 없어 **미설정** → 일차는 직접 선택 (설정하면 자동 추천) | `assets/places.js`의 `TRIP_START_DATE` |
| 6 | 배경음악 | 없음 / 내 파일 선택 (기본 음원은 저작권 확인 필요해 미포함) | `reel-ui.js` |

- 여행 장소 프리셋은 페이지 일정의 지점 이름으로 만들었고, **좌표는 비워 둠**(추측한 좌표를 넣지 않음).
  좌표를 채우면 사진 GPS와 가장 가까운 장소 이름이 자동으로 붙는다.
- 커밋·푸시는 워크플로우대로 **확인 후 진행** — 단계별 커밋 메시지만 아래 "진행 상황"에 적어 둔다.

---

## 기획 v2 (추가 요구사항 반영)

## 배경
WedShoots(하객 참여형 웨딩 앨범)의 핵심 흐름 —
**"한 곳에 모두가 사진을 올리고 → 서로 좋아요·댓글로 반응하고 → 나중에 한 번에 모아본다"** —
를 남해 바래길 여행 페이지에 가져온다.

WedShoots의 가장 큰 약점이던 **앱 설치 필수**는 피한다. sosodobo는 이미 모두가 같은 URL로
들어오는 웹 페이지이므로, 브라우저에서 바로 올리고 보는 방식으로 만든다.

### v2 변경 요약 (추가 요구사항)
1. 사진의 **촬영 정보(위치, 날짜·시간, ISO, 셔터스피드, 조리개, 노출보정 등) 표시**
2. 본인이 올린 사진의 **시간·위치 수정**
3. 본인 **댓글 수정**
4. 공유된 **사진과 영상으로 시간 순 슬라이드 영상 만들기**
   → 이에 따라 **영상 업로드**가 범위 밖에서 범위 안으로 들어옴

## 요구사항

### A. 사진·영상 공유
- 여행자는 휴대폰 사진첩/카메라에서 사진·영상을 **여러 개 한 번에** 올릴 수 있다.
- 항목마다 **올린 사람**, **촬영 시각**, **위치**, **일차(1·2·3일차 / 기타)**, 선택적 **한 줄 캡션**이 붙는다.
- 격자(3열) 썸네일, **전체 / 1일차 / 2일차 / 3일차** 필터, 기본 정렬은 **촬영 시각 순**.
- 썸네일을 누르면 크게 보기(라이트박스), 좌우 스와이프. 영상은 라이트박스에서 재생.
- 다운로드 가능. 올린 사람은 자기 항목을 삭제할 수 있다.

### B. 촬영 정보 표시 (신규)
- 라이트박스의 **ⓘ 정보** 패널에서 보여준다.
  - 📅 촬영 일시 (예: 10월 3일 (금) 오후 2:14)
  - 📍 위치: 장소 이름 + 좌표, 지도 앱으로 열기 링크(카카오맵/네이버지도)
  - 📷 카메라·렌즈: 기종(예: iPhone 15 Pro), 렌즈/초점거리(예: 24mm)
  - ⚙️ 노출: ISO 125 · 1/250s · f/1.8 · +0.3EV
  - 기타: 해상도, 플래시 사용 여부
- 정보가 없는 항목은 줄 자체를 숨긴다 ("알 수 없음"을 나열하지 않음).
- 사람이 수정한 값에는 "✎ 수정됨" 표시.
- 영상은 촬영 일시·위치·길이만 (ISO 등 노출 정보는 영상 파일에서 일관되게 얻기 어려움).

### C. 시간·위치 수정 (신규, 본인 항목만)
- 정보 패널에서 **✎ 수정** → 촬영 일시와 위치를 바꿀 수 있다.
- 위치 입력 방법 (쉬운 순):
  1. **여행 장소 프리셋에서 고르기** — 페이지 일정에 이미 있는 지점들
     (각 코스 시작/도착점, 숙소 등)을 목록으로 제공. 대부분 이걸로 해결됨.
  2. **장소 이름 직접 입력** (좌표 없이 이름만)
  3. (선택) 지도에서 핀 찍기 — 지도 SDK·API 키가 필요해 후순위
- **"원래대로"** 버튼: 파일에서 읽은 원본 값으로 되돌리기 (원본 값을 따로 보관).
- 시간을 바꾸면 일차 추천·정렬·슬라이드 영상 순서에 바로 반영된다.
- ISO·셔터스피드 등 카메라 값은 사실 정보이므로 수정 불가.

### D. 좋아요
- 항목마다 ♥ 토글. 한 사람당 한 번(다시 누르면 취소).
- 썸네일에 좋아요 수, 라이트박스에 "누가 좋아했는지" 이름 표시.

### E. 댓글
- 라이트박스에서 항목별 댓글 목록 + 입력창. 300자 제한.
- 작성자 본인만 **수정(신규)**·삭제 가능. 수정된 댓글엔 "(수정됨)" 표시.
- 썸네일에 댓글 수 표시.

### F. 시간 순 슬라이드 영상 (신규)
- 앨범의 사진·영상을 **촬영 시각 순**으로 이어 붙인 영상을 만든다.
- 옵션
  - 범위: 전체 / 특정 일차 / **좋아요 N개 이상만** (베스트 모음)
  - 사진 1장당 길이 (2 · 3 · 4초), 영상 클립 최대 길이 (예: 앞 5초)
  - 오버레이: 일차 타이틀 카드("DAY 2 · 말발굽길 · 10.4"), 촬영 시각·장소, 캡션 표시 여부
  - 전환 효과: 크로스페이드 + 사진에 느린 줌/패닝(Ken Burns)
  - 배경음악: 없음 / 기본 제공 음원 1~2개 (저작권 문제없는 음원) / 내 파일 선택
- 두 가지 모드
  1. **바로 보기(재생 모드)**: 파일을 만들지 않고 화면에서 슬라이드쇼 재생. 여행 중 숙소에서 TV/노트북으로 틀기 좋음 (WedShoots의 프로젝터 모드에 해당)
  2. **영상 파일로 저장**: 같은 슬라이드쇼를 녹화해 파일로 다운로드 → 카톡으로 공유
- 만든 영상을 다시 앨범에 올릴지는 선택(기본은 다운로드만).

### 범위 밖 (이후 후보)
- 전체 앨범 ZIP 다운로드
- 필터/보정 효과
- 실시간 푸시(웹소켓)
- 지도 위에 사진 핀으로 모아보기 (위치 정보가 생기므로 나중에 붙이기 쉬움)

## 현재 구조와 맞추기

| 항목 | 현재 sosodobo | 앨범에서 |
|---|---|---|
| 호스팅 | Vercel 서버리스 (`api/*.js`) | 같은 방식으로 API 추가 |
| DB | Vercel Postgres(Neon), `_db.js`의 `ensureSchema()` | 테이블 3개 추가 |
| 사용자 | 로그인 없음, `travelers` 테이블 | **여행자 = 사용자**로 재사용 |
| 프론트 | 순수 HTML/JS, `settle-core.js`(순수 로직) + `settle-ui.js`(DOM) | `photo-core.js` + `photo-ui.js`, `reel-core.js` + `reel-ui.js` |
| 테스트 | `node --test`, 순수 함수 단위 테스트 | 같은 방식 |
| 캐러셀 | `assets/carousel.js` 순수 함수 | 라이트박스 넘기기에 재사용 |
| 일정 데이터 | `index.html` 안의 코스·숙소 | 위치 프리셋, 슬라이드 타이틀 카드에 재사용 |

## 접근 방식

### 1. "나는 누구?" — 로그인 없이 사용자 구분
- 기존 **여행자 목록**에서 처음 한 번 "나는 ○○"을 고르고, `traveler_id`를 `localStorage`에 기억.
- 업로드·좋아요·댓글·수정 요청에 이 id를 함께 보낸다.
- ⚠️ 진짜 인증이 아니라 "친구끼리 믿고 쓰는" 수준 (정산 기능과 같은 전제).

### 2. 파일 저장 — Vercel Blob (클라이언트 직접 업로드)
- 파일은 **Vercel Blob**, DB에는 URL·메타데이터만. (`@vercel/blob` 의존성 추가)
- 서버리스 함수의 요청 크기 제한 때문에 파일은 서버를 거치지 않는다:
  1. 브라우저 → `POST /api/photo-upload` : 업로드 토큰 요청 (이미지/영상 MIME·용량 제한)
  2. 브라우저 → Blob : 파일 직접 업로드
  3. 브라우저 → `POST /api/photos` : URL + 메타데이터 등록
- **사진**: 업로드 전 브라우저에서 리사이즈 (보기용 긴 변 2048px / 썸네일 480px, canvas 사용)
- **영상**: 브라우저에서 재인코딩하지 않고 원본 업로드 (용량·길이 제한 필요, 아래 결정 사항).
  썸네일은 `<video>`의 첫 프레임을 canvas로 캡처해 JPEG로 따로 올린다.

### 3. 촬영 정보(EXIF) 읽기 — 리사이즈 **전에** 추출
- canvas로 리사이즈하면 파일 안의 EXIF가 사라지므로, **원본 파일에서 먼저 읽어 DB에 저장**하고
  업로드되는 리사이즈 이미지는 EXIF가 없는 상태로 둔다.
  → 파일을 받아도 GPS가 따라가지 않고, 위치는 앨범 화면에서만 보인다.
- 라이브러리: **exifr** (브라우저용, JPEG·HEIC 지원, 필요한 태그만 골라 읽어 빠름).
  빌드 도구가 없으므로 CDN(jsDelivr)의 브라우저 빌드를 `<script>`로 로드. 서버 의존성 추가 없음.
- 읽을 태그: `DateTimeOriginal`, `OffsetTimeOriginal`, `GPSLatitude/Longitude`, `Make`, `Model`,
  `LensModel`, `FocalLength`, `FocalLengthIn35mmFormat`, `ISO`, `ExposureTime`, `FNumber`,
  `ExposureBiasValue`, `Flash`
- 값 → 보기 좋은 문자열 변환은 순수 함수로 (`0.004` → `1/250s`, `1.8` → `f/1.8`, `0.33` → `+0.3EV`).
- **영상**: MP4/MOV의 생성 시각·위치는 exifr로 읽을 수 없어, 1차로는 `file.lastModified`를
  촬영 시각 추정값으로 쓰고 위치는 비워둔다 → 사용자가 C(수정)로 채울 수 있다.
  (MP4 `mvhd` 생성 시각 파싱은 필요하면 이후 추가)
- **촬영 시각 우선순위**: EXIF 촬영 시각 → 파일 수정 시각 → 업로드 시각.
  어디서 왔는지(`taken_at_source`)를 저장해 "추정값"임을 표시할 수 있게 한다.
- **장소 이름**: 좌표만으로는 "어디"인지 알기 어렵다. 1차는
  **여행 장소 프리셋 중 가장 가까운 지점(예: 반경 1km 이내)을 자동으로 붙이는** 방식 (API 불필요).
  정확한 주소가 필요하면 이후 카카오 로컬 API 역지오코딩을 서버 함수로 추가 (API 키 필요).

### 4. DB 스키마 (`_db.js`의 `ensureSchema()`에 추가)
```sql
CREATE TABLE IF NOT EXISTS photos (
  id SERIAL PRIMARY KEY,
  uploader_id INTEGER REFERENCES travelers(id) ON DELETE SET NULL,
  media_type TEXT NOT NULL DEFAULT 'image' CHECK (media_type IN ('image','video')),
  url TEXT NOT NULL,             -- 사진: 2048px 리사이즈본 / 영상: 원본
  thumb_url TEXT NOT NULL,       -- 480px 썸네일 (영상은 첫 프레임)
  width INTEGER, height INTEGER,
  duration_sec REAL,             -- 영상 길이
  caption TEXT,                  -- 100자 이하
  day SMALLINT,                  -- 1, 2, 3, NULL(기타)

  -- 수정 가능한 현재 값
  taken_at TIMESTAMPTZ,
  lat DOUBLE PRECISION, lng DOUBLE PRECISION,
  place_name TEXT,
  taken_at_source TEXT,          -- 'exif' | 'file' | 'upload' | 'manual'
  location_source TEXT,          -- 'exif' | 'preset' | 'manual' | NULL

  -- 파일에서 읽은 원본 값 ("원래대로" 되돌리기용, 수정 불가)
  original_taken_at TIMESTAMPTZ,
  original_lat DOUBLE PRECISION, original_lng DOUBLE PRECISION,

  -- 카메라 정보 (수정 불가): { make, model, lens, focalLength, focal35, iso,
  --   exposureTime, fNumber, exposureBias, flash }
  camera JSONB,

  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS photo_likes (
  photo_id INTEGER NOT NULL REFERENCES photos(id) ON DELETE CASCADE,
  traveler_id INTEGER NOT NULL REFERENCES travelers(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (photo_id, traveler_id)   -- 1인 1좋아요를 DB가 보장
);
CREATE TABLE IF NOT EXISTS photo_comments (
  id SERIAL PRIMARY KEY,
  photo_id INTEGER NOT NULL REFERENCES photos(id) ON DELETE CASCADE,
  author_id INTEGER REFERENCES travelers(id) ON DELETE SET NULL,
  content TEXT NOT NULL,         -- 300자 이하
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ         -- NULL이면 수정된 적 없음 → "(수정됨)" 표시 기준
);
```
- "✎ 수정됨" 표시는 `taken_at_source = 'manual'` 또는 `location_source IN ('preset','manual')`로 판단.
- 사진 삭제 시 좋아요·댓글은 CASCADE, Blob 파일(본문+썸네일)도 API에서 `del()`로 삭제.
- 여행자가 삭제돼도 사진·댓글은 남기고 작성자만 "알 수 없음"(SET NULL).

### 5. API 설계 (기존 `notes.js` / `expenses.js` 패턴)
| 메서드 · 경로 | 역할 |
|---|---|
| `POST /api/photo-upload` | Blob 업로드 토큰 발급 (이미지/영상 MIME·용량 제한) |
| `GET /api/photos` | 목록 + 좋아요 수·좋아요한 사람 id·댓글 수 (한 번의 쿼리로 집계) |
| `POST /api/photos` | 업로드 완료 항목 등록 (파일 URL + 촬영정보 + 원본값) |
| `PATCH /api/photos?id=` | **캡션·일차·촬영시각·위치 수정** / `{ reset: ['time','location'] }`로 원래대로 (올린 사람만) |
| `DELETE /api/photos?id=` | 삭제 + Blob 삭제 (올린 사람만) |
| `POST /api/photo-likes` | 좋아요 (`ON CONFLICT DO NOTHING`) |
| `DELETE /api/photo-likes?photoId=&travelerId=` | 좋아요 취소 |
| `GET /api/photo-comments?photoId=` | 댓글 목록 (라이트박스 열 때만) |
| `POST /api/photo-comments` | 댓글 작성 |
| `PATCH /api/photo-comments?id=` | **댓글 수정** (작성자만, `updated_at` 갱신) |
| `DELETE /api/photo-comments?id=&travelerId=` | 댓글 삭제 (작성자만) |

- 사진 목록은 `/api/state`에 합치지 않고 별도 엔드포인트 (정산 화면 로딩 보호).
- 권한 체크는 요청의 `travelerId`와 작성자 id 비교 (1번 전제와 동일). 불일치 시 403.
- 수정 입력 검증: 촬영 시각은 유효한 날짜 & 미래 아님, 위도 -90~90 / 경도 -180~180,
  장소 이름 50자 이하. 순수 함수 `parsePhotoPatch`로 분리.

### 6. 화면 구성
- 상단 네비게이션: `일정 · 사진 · 지출·정산 · 준비물`
- `<section class="photo-box" id="photos">` (기존 크림·포레스트·테라코타 톤 유지)
  - 상단: "나는 ○○ ▾" 칩, **+ 올리기** 버튼, **▶ 슬라이드 영상** 버튼
    (`<input type="file" accept="image/*,video/*" multiple>`)
  - 업로드 시트: 미리보기, 읽어낸 촬영 시각·위치 확인(여기서 바로 수정 가능), 일차(자동 추천), 캡션, 진행률
  - 필터 탭 + 3열 격자 (♥·💬 뱃지, 영상은 ▶ 길이 뱃지, `loading="lazy"`)
- 라이트박스
  - 스와이프/이전·다음 (`carousel.js` 재사용), 영상은 `<video controls playsinline>`
  - 하단 바: 올린 사람 · 촬영 시각 · 장소 · 캡션 / ♥ / ⓘ 정보 / 다운로드 / (본인) 수정·삭제
  - **ⓘ 정보 패널**: B의 촬영 정보, 본인 항목이면 ✎ 수정 → 날짜·시간 입력 + 위치 프리셋 목록 + "원래대로"
  - 댓글 목록 (본인 댓글에 수정·삭제 메뉴, 수정은 그 자리에서 입력창으로 전환) + 입력창
- 좋아요·댓글 수정은 **낙관적 업데이트** (즉시 반영 → 실패 시 되돌리고 안내)

### 7. 슬라이드 영상 만들기
**구성 순서 (순수 로직, `assets/reel-core.js`)**
1. 옵션(범위·좋아요 기준)으로 항목을 거른다
2. 촬영 시각 순으로 정렬, 같은 시각이면 업로드 순
3. 일차가 바뀌는 지점마다 타이틀 카드 삽입
4. 각 구간의 시작·끝 시간, 전환 구간, 줌 방향을 계산한 **타임라인** 생성
   → 이 타임라인이 "재생 모드"와 "파일 저장" 양쪽의 공통 입력이 된다.

**렌더링 (`assets/reel-ui.js`)**
- `<canvas>` 한 장에 타임라인대로 그린다 (사진 = 이미지 + 줌, 영상 = `<video>` 프레임, 카드·자막 = 텍스트).
- **재생 모드**: `requestAnimationFrame`으로 canvas를 전체화면 재생. 배경음악은 `<audio>`.
- **파일 저장**: 같은 canvas를 `canvas.captureStream()` + **MediaRecorder**로 녹화, 배경음악은
  Web Audio로 스트림에 합친다. 새 의존성 없음.
  - 녹화는 **실제 재생 시간만큼 걸린다** (30장 × 3초 ≈ 1분 30초 + 영상 클립 길이). 진행률 표시.
  - 결과 형식은 브라우저에 따라 **MP4 또는 WebM** (`MediaRecorder.isTypeSupported`로 MP4 우선 선택).
    카톡 공유 호환을 위해 MP4가 가능한 환경(최신 Safari·Chrome)을 권장하고, 구현 전에 실제 기기로 확인.
  - 휴대폰은 메모리·발열 문제로 긴 영상이 실패할 수 있어 **"PC에서 만드는 것을 권장"** 안내,
    길이 상한(예: 최대 5분) 설정.
- 대안 검토
  - 서버에서 ffmpeg로 만들기: Vercel 서버리스는 실행 시간·용량 제한이 있어 부적합, 별도 서버 필요 → 제외
  - WebCodecs + mp4 muxer로 빠른 인코딩: 재생보다 빠르게 MP4를 만들 수 있지만, 영상 클립 디코딩까지
    직접 다뤄야 해 복잡도가 큼 → 녹화 방식으로 먼저 만들고, 느리다는 피드백이 있으면 전환 검토

### 8. 다른 사람 활동 반영
- 사진 섹션이 화면에 보이고 탭이 활성일 때만 30초마다 `GET /api/photos`
  (IntersectionObserver + `visibilitychange`). 라이트박스가 열려 있으면 댓글도 같이 갱신.

### 9. 공개 범위 (결정 필요 — v2에서 중요도 상승)
위치 정보가 추가되면서 **숙소 등 정확한 좌표가 주소만 알면 누구에게나 보이는** 상황이 된다.
- **A. 그대로 공개** — 가장 간단. 주소를 친구끼리만 공유한다는 전제.
- **B. 앨범 코드(추천)** — 환경변수 `ALBUM_CODE`, 처음 한 번 입력하면 사진 API 사용 가능.
- 추가 옵션: 좌표는 저장하되 화면엔 **장소 이름만** 보이고 좌표·지도 링크는 숨기기.
- 어느 쪽이든 `<meta name="robots" content="noindex">`로 검색 노출 차단.
- 다운로드 파일에는 GPS가 들어가지 않는다 (리사이즈 시 EXIF 제거). 단, 영상은 원본 업로드라
  **영상 파일 안의 위치 메타데이터는 남을 수 있음** → 결정 사항에 포함.

## 순수 로직 분리 — TDD 대상

### `assets/photo-core.js`
- `fitWithin(width, height, maxEdge)` → 비율 유지 리사이즈 크기 (작은 사진은 확대 안 함)
- `pickTakenAt({ exifTime, offset, fileModified, uploadedAt })` → `{ takenAt, source }` 우선순위 적용
- `suggestDay(takenAt, tripStartDate)` → 1·2·3 또는 `null`
- `formatShutter(sec)` → `1/250s`, `2s`, `1/3s` / `formatAperture(f)` → `f/1.8`
  / `formatExposureBias(ev)` → `+0.3EV`, `0EV`, `-1EV` / `formatFocal(mm, mm35)` → `6.8mm (24mm 환산)`
- `summarizeCamera(rawExif)` → 표시용 줄 목록 (없는 값은 줄 생략)
- `nearestPreset(lat, lng, presets, maxMeters)` → 가장 가까운 여행 지점 or `null` (하버사인 거리)
- `mapLinks(lat, lng, name)` → 카카오맵/네이버지도 URL
- `isEdited(photo)` → 시간/위치 수정 여부
- `sortByTakenAt(items)` / `filterByDay(items, day)`
- `toggleLike(photo, travelerId)` → 새 객체 (낙관적 업데이트용)
- `validateComment(text)` / `validateCaption(text)` → `{ value } | { error }`
- `canModify(item, travelerId)` → 본인 여부
- `formatRelativeTime(date, now)` → "방금", "5분 전", "어제"

### `assets/reel-core.js`
- `selectReelItems(items, { day, minLikes })`
- `buildTimeline(items, { photoSec, clipMaxSec, transitionSec, titleCards, dayInfo })`
  → `[{ type: 'title'|'image'|'video', start, end, src, kenBurns, overlay }]`
- `totalDuration(timeline)` / `segmentAt(timeline, t)` → 현재 시각에 그릴 구간 + 전환 진행률
- `kenBurnsFor(index, seed)` → 줌 방향·배율 (결정적이라 테스트 가능)
- `pickRecorderMime(isTypeSupported)` → MP4 우선, 없으면 WebM

### 서버 입력 검증 (API에서 재사용)
- `parsePhoto(body)`, `parsePhotoPatch(body)`, `parseComment(body)`

## 변경 파일 (예상)
- `api/_db.js` — 테이블 3개 추가
- `api/photo-upload.js`, `api/photos.js`, `api/photo-likes.js`, `api/photo-comments.js` (신규)
- `api/_photo-validate.js` (신규) — 서버 입력 검증 순수 함수
- `assets/photo-core.js`, `assets/photo-ui.js` (신규) — 앨범
- `assets/reel-core.js`, `assets/reel-ui.js` (신규) — 슬라이드 영상
- `assets/places.js` (신규) — 여행 장소 프리셋 (이름, 좌표, 일차)
- `assets/reel-bgm/*.mp3` (선택) — 저작권 문제없는 배경음악
- `index.html` — 네비, 사진 섹션 마크업·스타일, exifr CDN 스크립트, 스크립트 로드
- `tests/photo-core.test.js`, `tests/reel-core.test.js`, `tests/photo-validate.test.js` (신규)
- `package.json` — `@vercel/blob` 추가
- `README.md` — Blob 저장소 연결 방법, 앨범 코드 설정 방법

## 단계별 진행 (각 단계마다 배포해서 써볼 수 있게)
1. **사진 올리고 보기** — 사용자 선택, 사진 업로드(EXIF 추출 → 리사이즈), 격자, 일차 필터, 라이트박스, 삭제
2. **촬영 정보 표시** — ⓘ 패널, 노출값 포맷, 장소 프리셋 자동 매칭, 지도 링크
3. **시간·위치 수정** — 수정 UI, 프리셋 선택, 원래대로, 정렬·일차 재계산
4. **좋아요**
5. **댓글** — 작성·수정·삭제, (수정됨) 표시, 주기적 갱신
6. **영상 업로드** — 영상 썸네일, 라이트박스 재생, 용량·길이 제한
7. **슬라이드 영상: 재생 모드** — 타임라인, canvas 렌더링, 전체화면, 배경음악
8. **슬라이드 영상: 파일 저장** — MediaRecorder 녹화, 진행률, 다운로드
9. (선택) 앨범 코드, 지도 모아보기, 역지오코딩

> 1~5는 사진만으로 완결되는 기능이라 여행 전에 먼저 배포하고, 6~8은 이어서 붙이는 순서를 추천.

## 테스트 전략
- **단위 테스트** (`node --test`, 새 테스트 의존성 없음): 위 순수 함수 전부
  - EXIF: 셔터 1/8000 ~ 30초, 조리개 소수점, 노출보정 0/음수/분수, 값 누락, 타임존 오프셋 있음/없음
  - 촬영 시각 우선순위: EXIF 있음/없음, 파일 시각만 있음, 모두 없음
  - 위치: 프리셋 반경 안/밖, 좌표 경계값, 잘못된 좌표 거부
  - 수정 검증: 미래 시각, 잘못된 날짜 문자열, 빈 장소 이름, 원래대로 되돌리기
  - 댓글: 빈/공백/300자 초과, 수정 시 (수정됨) 판단
  - 타임라인: 정렬, 일차 경계에 타이틀 카드, 영상 클립 길이 자르기, 전체 길이 합, `segmentAt` 경계(전환 구간 시작/끝), 빈 목록
- **API 테스트**: `sql`을 가짜 함수로 바꿔 상태코드·권한(남의 사진/댓글 수정·삭제 → 403) 검증
- **수동 스모크** (`vercel dev` + 실제 기기)
  - iPhone Safari / Android Chrome에서 사진첩 여러 장 업로드, HEIC, **위치 정보가 실제로 읽히는지**
  - 영상 업로드·재생, 두 기기 간 좋아요·댓글 반영
  - 슬라이드 영상: 재생 모드, PC Chrome/Safari에서 파일 저장 → 카톡 전송 후 재생 확인

## 결정이 필요한 것
1. **공개 범위**: A(그대로 공개) vs B(앨범 코드) — 위치 정보 때문에 B 추천
2. **위치 표시 수준**: 좌표·지도 링크까지 vs 장소 이름만
3. **삭제 권한**: 올린 사람만 vs 누구나
4. **영상 제한**: 1개당 최대 길이/용량 (예: 60초 · 200MB), 영상 속 위치 메타데이터 허용 여부
5. **여행 첫날 날짜** (일차 자동 추천)
6. **슬라이드 배경음악**: 없음 / 기본 음원 제공 / 사용자 파일만

## 확인할 위험 요소
- **휴대폰이 위치 정보를 빼고 넘겨주는 경우** ⚠️ 가장 큰 위험:
  iOS 사진 선택기와 Android 사진 선택기는 개인정보 보호를 위해 웹에 파일을 넘길 때
  **GPS를 제거하는 경우가 있다**. 그러면 B의 위치 자동 표시가 동작하지 않는다.
  → 1단계에서 실제 기기로 먼저 확인. 빠지는 환경이 많으면 "C. 위치 프리셋 선택"이 주 입력 방식이 되도록
  업로드 시트에서 위치를 바로 고르게 한다 (촬영 시각은 대체로 유지됨).
- **HEIC**: 대부분 Safari가 JPEG로 변환해 넘겨주지만, 실패 시 안내 메시지
- **Vercel Blob 무료 한도**: 영상이 들어오면서 저장 용량·전송량 소모가 커짐 → 연결 전 한도 확인, 영상 제한값 결정에 반영
- **MediaRecorder 형식/호환성**: 브라우저별 MP4 지원 여부, 녹화 중 탭 전환 시 끊김 → 녹화 중 화면 유지 안내
- **영상 클립을 canvas에 그릴 때 CORS**: Blob URL 응답 헤더 확인 (canvas가 오염되면 녹화 실패)
- **개인정보**: 얼굴·위치가 함께 공개될 수 있음 → 9번 공개 범위 결정과 연동

## 진행 상황
- [x] 요구사항·설계 정리 v1 (사진·좋아요·댓글)
- [x] v2 — 촬영 정보 표시, 시간·위치 수정, 댓글 수정, 영상 업로드, 슬라이드 영상 반영
- [x] 결정 사항 → 기본값으로 진행 (문서 상단 표)

### 검증 환경 (로컬)
- 단위·API 테스트: `npm test` (`node --test`, 새 테스트 의존성 없음)
- 브라우저 스모크: 로컬 PostgreSQL 16 에 **실제 `api/*.js` 핸들러를 그대로** 연결한 개발 서버 +
  Blob 은 메모리 대체 + Playwright(Chromium, 390×844 모바일 화면)로 업로드부터 삭제까지 클릭 흐름 확인.
  EXIF(GPS·카메라 정보 포함) 있는 JPEG, EXIF 없는 JPEG, 테스트 영상으로 확인.
  (개발 서버·스모크 스크립트는 저장소에 넣지 않음)
- 실제 Vercel Blob/Neon, 실제 iPhone·Android 는 확인하지 못함 → "배포 후 확인할 것" 참고

### 1단계 — 사진 올리고 보기 ✅
- RED: `tests/photo-core.test.js`, `tests/photo-validate.test.js`, `tests/photos-api.test.js` 가
  모듈 없음으로 실패하는 것 확인 → GREEN: 구현 후 전체 통과
- 구현
  - `assets/photo-core.js`: 리사이즈 크기, 파일 종류, 촬영 시각 우선순위, 일차 추천(KST), 정렬·필터, 본인 확인,
    캡션 검증, EXIF 원본값 추출, 업로드 경로
  - `api/_photo-validate.js`: 서버 입력 검증(Blob 주소만 허용, 좌표 범위, 카메라 필드 화이트리스트), 업로드 토큰 규칙, DB 행 변환
  - `api/photos.js`(GET/POST/DELETE), `api/photo-upload.js`(Blob 토큰), `api/_db.js`(photos 테이블)
  - `assets/photo-ui.js`: 나는 누구, 여러 장 선택 → EXIF 읽기 → 리사이즈(2048/480) → 미리보기·일차·캡션 → 업로드,
    일차 필터 격자, 라이트박스(스와이프·방향키·순환), 다운로드, 본인 사진 삭제, 30초 새로고침(보일 때만)
  - `assets/places.js`(여행 장소 프리셋), `assets/vendor/`(exifr, Blob 업로드 클라이언트 번들)
  - `index.html`: 네비 "사진", 사진 섹션·라이트박스 마크업·스타일, `noindex`
- 발견한 이슈
  - ⚠️ **`api/travelers.js` 가 저장소에서 빠져 있었음** (커밋 2af526d 에서 삭제됨). 여행자 추가·삭제가
    404 로 실패하는 상태였고, 사진 기능도 여행자 목록이 필요해 36519d9 버전 그대로 복구함
  - 라이트박스에서 버튼으로 넘긴 뒤 Esc·방향키가 안 먹던 문제(다시 그리며 포커스 소실) → 문서 전체에서 키 처리로 수정
- 커밋 메시지 (확인 후 커밋)
  ```
  feat: 사진 앨범 1단계 — 업로드·격자·라이트박스·삭제

  - 브라우저에서 EXIF(촬영시각·GPS·카메라) 추출 후 2048/480px 로 리사이즈해 Vercel Blob 직접 업로드
  - photos 테이블, /api/photos(GET/POST/DELETE), /api/photo-upload(업로드 토큰)
  - 일차 필터 격자, 스와이프 라이트박스, 다운로드, 본인 사진 삭제
  - 누락됐던 api/travelers.js 복구
  - 검색엔진 noindex
  ```

### 2단계 — 촬영 정보 표시 ✅
- RED → GREEN: 셔터·조리개·노출보정·초점거리 포맷, 카메라 요약 줄, 한국 시간 표기, 거리 계산,
  가까운 여행 장소, 지도 링크, 좌표 표기, 수정 여부, 추정 시각 설명 (13개 테스트 추가)
- 구현: 라이트박스 **ⓘ 정보** 패널 (촬영 일시·추정 여부 / 장소 이름·좌표·지도 링크 / 카메라·렌즈·노출·플래시 / 크기),
  값이 없는 줄은 숨김. 업로드 때 GPS 와 가까운 여행 장소 이름을 자동 연결(장소 좌표를 채우면 동작)
- 기획과 달라진 점: 지도 링크는 **카카오맵 + 구글 지도** (네이버지도는 좌표로 여는 공식 URL 형식을 확인하지 못해 제외)
- 발견한 이슈
  - ⚠️ exifr 는 노출보정(EXIF `ExposureBiasValue`)을 **`ExposureCompensation`** 이라는 이름으로 돌려줌 →
    실제 파일로 스모크 테스트하다 발견, 두 이름 모두 받도록 수정하고 테스트 추가
  - Node 의 ICU 는 한국어 시간에 "PM" 을 쓰는 등 환경마다 달라서, 날짜·시간 표기를 직접 계산하도록 변경(브라우저·테스트 결과 동일)
- 커밋 메시지
  ```
  feat: 사진 앨범 2단계 — 촬영 정보(ⓘ) 패널

  - 촬영 일시(한국 시간)·위치(좌표, 카카오맵/구글 지도)·카메라·렌즈·노출(ISO·셔터·조리개·노출보정) 표시
  - 가까운 여행 장소 이름 자동 연결 (assets/places.js 좌표 기반)
  - exifr 의 ExposureCompensation 키 처리
  ```

### 3단계 — 시간·위치 수정 ✅
- RED → GREEN: `parsePhotoPatch`(부분 수정·미래 시각 거부·프리셋/직접 입력/지우기·원래대로), PATCH API 권한(403)·검증(400)·없음(404),
  폼 도우미 `toKstInputValue`/`fromKstInputValue`/`locationChoice` 테스트 추가
- 구현
  - `PATCH /api/photos?id=` (올린 사람만), `reset: ['time'|'location']` 은 서버가 DB 의 원본 값으로 되돌림
  - 원본 촬영 시각이 EXIF 였는지 추정값이었는지 기억하려고 `original_taken_at_source` 컬럼 추가
  - ⓘ 패널의 **✎ 시간·위치 수정** 폼: 촬영 시각(한국 시간), 일차, 장소(여행 장소 목록 / 직접 입력 / 지우기), 캡션,
    **↺ 원래 시각으로 / 원래 위치로**
  - 좌표 없는 여행 장소를 고르면 사진의 GPS 좌표는 유지하고 이름만 붙임 (좌표 있는 장소는 그 좌표로 교체)
  - 30초 새로고침이 입력 중인 폼을 지우지 않도록, 라이트박스에서 입력 중이면 다시 그리지 않음
- 발견한 이슈: 없음 (스모크 스크립트 쪽 문제만 수정)
- 커밋 메시지
  ```
  feat: 사진 앨범 3단계 — 본인 사진의 촬영 시각·위치 수정

  - PATCH /api/photos: 캡션·일차·촬영시각·위치 수정, 원래대로(reset) 지원, 올린 사람만
  - 여행 장소 목록 선택 / 직접 입력 / 위치 지우기, "✎ 수정됨" 표시
  - original_taken_at_source 컬럼으로 원본 시각의 출처 보존
  - 입력 중에는 주기적 새로고침이 라이트박스를 다시 그리지 않도록 처리
  ```

### 4단계 — 좋아요 ✅
- RED → GREEN: `toggleLike`/`hasLiked`/`likeSummary`, `/api/photo-likes` POST(중복 무시)·DELETE·검증(400/404/405),
  목록 API 의 좋아요 집계 테스트 추가
- 구현
  - `photo_likes` 테이블 (PK `(photo_id, traveler_id)` 로 1인 1좋아요 보장)
  - `api/photo-likes.js`, `GET /api/photos` 에 좋아요 수·누른 사람 목록 집계
  - 라이트박스 ♡/♥ 좋아요 버튼 (누르는 즉시 반영 → 서버 응답으로 맞춤 → 실패하면 되돌리고 안내),
    "미솔, 기아님이 좋아해요 / … 외 N명", 격자 썸네일 ♥ 뱃지
- 발견한 이슈: 없음
- 커밋 메시지
  ```
  feat: 사진 앨범 4단계 — 좋아요

  - photo_likes 테이블(1인 1좋아요), /api/photo-likes POST·DELETE
  - 라이트박스 좋아요 버튼(낙관적 업데이트·실패 시 되돌림), 누른 사람 이름, 썸네일 ♥ 뱃지
  ```

### 5단계 — 댓글 (작성·수정·삭제) ✅
- RED → GREEN: `validateComment`, `formatRelativeTime`(방금·N분 전·N시간 전·어제·날짜), `isCommentEdited`,
  `/api/photo-comments` GET·POST·PATCH·DELETE 와 작성자 권한(403)·검증(400/404) 테스트 추가
- 구현
  - `photo_comments` 테이블(`updated_at` 이 있으면 "수정됨"), `api/photo-comments.js`, 목록 API 에 댓글 수 집계
  - 라이트박스 댓글 영역: 목록, Enter 로 등록, 내 댓글 **수정**(그 자리에서 입력창으로)·삭제, 격자 💬 뱃지
  - 댓글은 라이트박스를 열 때 불러오고, 30초 새로고침 때 **목록 부분만** 다시 그려서 쓰던 글이 지워지지 않음
- 발견한 이슈
  - 댓글 입력창에 포커스가 있으면 Esc 로 라이트박스가 안 닫힘 → 입력창이 비어 있으면 닫고, 쓰던 글이 있으면
    포커스만 빼서 글을 지키도록 수정
- 커밋 메시지
  ```
  feat: 사진 앨범 5단계 — 댓글 작성·수정·삭제

  - photo_comments 테이블, /api/photo-comments GET·POST·PATCH·DELETE (작성자만 수정·삭제)
  - 라이트박스 댓글 목록·입력, "(수정됨)" 표시, 상대 시간, 썸네일 💬 뱃지
  - 새로고침 때 입력 중인 댓글 보존, 입력창에서 Esc 처리
  ```

### 6단계 — 영상 업로드 ✅
- RED → GREEN: `validateVideo`(60초·200MB), `videoThumbTime`, `videoFileInfo`(확장자·Content-Type), `formatDuration` 테스트 추가
- 구현
  - 파일 선택에 영상 허용(`image/*,video/*`), 브라우저에서 길이 확인 → 앞부분 프레임을 캔버스로 떠서 480px 썸네일 →
    원본은 재인코딩 없이 Blob 에 업로드(8MB 초과 시 분할 업로드)
  - 썸네일을 못 뜨는 브라우저용 대체 썸네일(▶ 그림), 60초 초과·열 수 없는 형식은 이유와 함께 목록에서 거부
  - 격자 `▶ 0:04` 뱃지, 라이트박스 `<video controls playsinline>` 재생, ⓘ 에 길이
  - 영상의 촬영 시각·위치는 브라우저에서 믿을 만하게 읽기 어려워 **파일 시각으로 추정**(3단계 수정 기능으로 보정)
- 확인 한계: 검증용 Chromium 에는 H.264 코덱이 없어 WebM(VP9) 영상으로 확인. 실제 폰의 MP4/MOV 는 배포 후 확인 필요
- 커밋 메시지
  ```
  feat: 사진 앨범 6단계 — 영상 업로드

  - 60초·200MB 이하 영상 업로드 (원본 그대로, 큰 파일은 분할 업로드)
  - 영상 앞부분 프레임으로 썸네일 생성, 실패 시 대체 썸네일
  - 격자 재생 시간 뱃지, 라이트박스 영상 재생
  ```

### 7단계 — 슬라이드 영상: 재생 모드 ✅
- RED → GREEN: `tests/reel-core.test.js` — 고르기(일차·좋아요), 타임라인(일차 타이틀 카드·크로스페이드 겹침·영상 클립 자르기·
  시작/끝 카드), 시각별 그릴 구간과 투명도, Ken Burns, cover/contain 영역 계산, 맞춤 방식, 문구, 요약 (18개)
- 구현
  - `assets/reel-core.js`: 순수 타임라인 로직 (재생·녹화 공통)
  - `assets/reel-ui.js`: 옵션 화면(범위·좋아요 기준·사진 길이·클립 길이·가로/세로·일차 타이틀/시각·장소/캡션·배경음악 파일),
    `<canvas>` 렌더러(시작 카드 → 일차 타이틀 → 사진은 느린 줌·이동, 영상은 앞부분 재생 → 끝 카드에 올린 사람 이름),
    세로 사진을 가로 화면에 넣을 땐 흐린 배경 + 전체 보이기, 재생/일시정지/탐색/전체화면, Space·Esc
  - `assets/places.js`: 여행 제목·일차 이름(DAY 1 동대만길 …)
  - 불러오지 못한 사진·영상은 빼고 만들며 몇 개 뺐는지 안내
- 커밋 메시지
  ```
  feat: 사진 앨범 7단계 — 시간 순 슬라이드 영상 재생

  - reel-core: 촬영 시각 순 타임라인(일차 타이틀, 크로스페이드, 영상 클립, 시작/끝 카드)
  - reel-ui: 옵션(범위·좋아요·길이·화면 비율·자막·배경음악), 캔버스 재생, 탐색, 전체화면
  ```

### 8단계 — 슬라이드 영상: 파일 저장 ✅
- RED → GREEN: 녹화 형식 선택(`pickRecorderMime`)·파일 이름(`reelFileName`) 테스트, 형식 선택 버그 회귀 테스트 추가
- 구현
  - 같은 캔버스를 `captureStream(30)` + **MediaRecorder** 로 실시간 녹화 (새 서버·ffmpeg 없음)
  - 소리: 배경음악을 고르면 배경음악(끝 2초 서서히 줄임), 안 고르면 영상 클립의 원래 소리를 Web Audio 로 합침
  - 진행 표시·그만두기, 저장 중 재생 조작 잠금, 다른 화면으로 가면 경고, 5분 넘으면 확인
  - 완료 후 다운로드 버튼(`남해바래길_전체_YYYYMMDD.mp4/webm`), 휴대폰에선 **공유하기**(카톡 등으로 바로 보내기)
  - Chrome 의 WebM 녹화본은 길이 정보가 비어 탐색이 안 되는 문제 → `fix-webm-duration`(MIT, 23KB)로 채움
- 검증: 녹화 파일을 ffprobe 로 확인 — 영상+소리 트랙, 1280×720, 길이 ≈ 타임라인 길이
- 발견한 이슈
  - ⚠️ 코덱을 적지 않은 `video/mp4` 를 고르면 Chromium 이 **MP4 안에 VP9** 를 넣음 → 아이폰·카톡에서 안 열릴 수 있음.
    H.264 가 명시된 MP4 → WebM → (WebM 불가 브라우저만) 코덱 없는 MP4 순서로 바꾸고 회귀 테스트 추가
- 커밋 메시지
  ```
  feat: 사진 앨범 8단계 — 슬라이드 영상을 파일로 저장

  - 캔버스 + 배경음악/클립 소리를 MediaRecorder 로 녹화, 진행 표시·그만두기
  - H.264 MP4 우선, 아니면 WebM (코덱 없는 MP4 는 VP9 가 들어갈 수 있어 뒤로)
  - WebM 길이 정보 보정(fix-webm-duration), 다운로드·공유하기
  ```

---

## 최종 점검 (1~8단계 완료 후)
- `npm test`: **134개 전부 통과** (기존 25개 + 새로 109개)
- 빈 DB 에서 1~8단계 브라우저 스모크 한 번에: **80개 항목 통과**, 페이지 오류 없음
  (콘솔의 500·403 은 "서버 오류 시 되돌리기", "남의 댓글 수정 거부" 를 확인하려고 일부러 낸 것)
- 기존 기능 회귀: 여행자 추가(복구한 API), 준비물 추가, 네비게이션 정상

## 배포 전에 할 일
1. Vercel 프로젝트 **Storage → Blob 생성 → Connect → Redeploy** (README 3-1단계)
2. (선택) `assets/places.js` 에 `TRIP_START_DATE`, 장소 좌표 채우기
3. 새 테이블(`photos`, `photo_likes`, `photo_comments`)은 첫 요청 때 자동 생성 — SQL 작업 없음

## 배포 후 실제 기기로 확인할 것 (이 환경에서 못 한 것)
- [ ] iPhone Safari / Android Chrome 에서 사진첩 여러 장 업로드, **위치 정보가 넘어오는지** (사진 선택기가 GPS 를 지우는 경우)
- [ ] iPhone HEIC 사진, iPhone 영상(MOV·HEVC) 업로드와 썸네일
- [ ] 실제 Vercel Blob 업로드(토큰 발급), 파일 삭제, `?download=1` 다운로드
- [ ] 슬라이드 영상 녹화 시 Blob 파일 CORS (캔버스 오염 없이 녹화되는지)
- [ ] 최신 Chrome·Safari 에서 저장 형식이 **H.264 MP4** 로 나오는지, 카카오톡으로 보내서 재생되는지
- [ ] 휴대폰에서 "공유하기" 버튼으로 카카오톡 전송

## 커밋 방법 (둘 중 선택)
- 단계별 8개 커밋: 위 각 단계의 커밋 메시지 사용
- 한 번에 1개 커밋:
  ```
  feat: 사진·영상 공유 앨범과 시간 순 슬라이드 영상

  - 사진·영상 업로드(브라우저 리사이즈, Vercel Blob 직접 업로드), 일차 필터 격자, 스와이프 라이트박스
  - 촬영 정보(시간·위치·카메라·ISO·셔터·조리개·노출보정) 표시, 본인 사진의 시간·위치 수정/원래대로
  - 좋아요, 댓글 작성·수정·삭제
  - 촬영 시각 순 슬라이드 영상 재생 및 MP4/WebM 저장(배경음악·클립 소리)
  - 누락됐던 api/travelers.js 복구, noindex
  ```

