# 소소도보 iOS 앱 — App Store 출시 준비

앱은 Capacitor 로 https://sosodobo.vercel.app 을 띄우는 "웹 + 네이티브 껍데기" 예요.
웹을 배포하면 앱 화면도 같이 바뀌어요 (앱을 다시 심사받는 건 네이티브 부분이 바뀔 때만).

## 구조

| 위치 | 내용 |
|---|---|
| `capacitor.config.json` | 앱 id `com.sosodobo.app`, 이름 `소소도보`, 띄울 주소, 스플래시 · 상태바 |
| `app-shell/index.html` | 인터넷이 안 될 때 보이는 화면 |
| `ios/App/App/WebAuthPlugin.swift` | 시스템 로그인 창(ASWebAuthenticationSession) — 구글이 앱 웹뷰 로그인을 막아서 |
| `ios/App/App/Info.plist` | 카메라 · 사진 · 마이크 권한 문구, `sosodobo://` 주소, 암호화 신고(없음) |
| `ios/App/App/Assets.xcassets` | 앱 아이콘(1024, 투명도 없음) · 스플래시 |
| `api/auth.js` | `app=1` 로그인 → `sosodobo://auth?code=` → `app-exchange` 로 웹뷰 로그인 쿠키, 계정 삭제 |
| `privacy.html` · `support.html` | 개인정보 처리방침 · 고객 지원 (App Store 에 넣을 주소) |

### 자주 쓰는 명령

```bash
# 웹 설정(capacitor.config.json)이나 플러그인을 바꾼 뒤 iOS 프로젝트에 반영 (CocoaPods 가 한글 경로 · 문구 때문에 UTF-8 필요)
LANG=en_US.UTF-8 npx cap sync ios
# Xcode 열기
npx cap open ios
```

## 출시까지 남은 일

### 1. Apple Developer Program 가입 (사용자)
- https://developer.apple.com/programs/ → 개인으로 가입, 연 $99. 승인까지 보통 하루~이틀.
- 승인되면 Xcode → Settings → Accounts 에 Apple ID 를 넣고, `App` 타깃 → Signing & Capabilities 에서 Team 을 고르기.

### 2. Sign in with Apple (필수 — 심사 지침 4.8)
구글 · 카카오 로그인을 쓰는 앱은 **Apple 로그인도 함께 있어야** 통과돼요. 계정이 생기면:
- Certificates, Identifiers & Profiles → App ID `com.sosodobo.app` 에 Sign in with Apple 켜기
- Services ID(웹 로그인용) + Key(.p8) 만들기 → Vercel 환경변수 `APPLE_CLIENT_ID` · `APPLE_TEAM_ID` · `APPLE_KEY_ID` · `APPLE_PRIVATE_KEY`
- 그 뒤 `api/_oauth.js` 에 apple 을 추가하고 로그인 버튼을 붙여요 (Claude 가 이어서 작업)

### 3. 심사용 데모 로그인 (필수)
심사관은 구글 · 카카오 계정으로 로그인하지 않아요. **심사관이 쓸 수 있는 로그인 방법**을 줘야 해요.
- 추천: Apple 로그인이 붙으면 심사관이 자기 Apple ID 로 들어오고, 참여 코드로 데모 여행에 들어가게 안내
- 데모 여행(예: "데모 · 제주 2박 3일")을 하나 만들어 사진 · 일정 · 정산을 채워 두고, 참여 코드를 심사 메모에 적기

### 4. 사용자 콘텐츠 신고 (심사 지침 1.2 — 지적받을 수 있음)
사진 · 댓글을 서로 올리는 앱은 "신고 · 차단" 기능을 요구받는 경우가 있어요. 초대받은 사람끼리만 보는 앱이라 설명으로 넘어가기도 하지만,
거절되면 사진 · 댓글에 "신고" 버튼(관리자에게 알림 + 운영자에게 메일)을 붙이면 돼요.

### 5. 푸시 알림 (선택, 계정 필요 — 심사 지침 4.2 대비로 추천)
웹사이트를 그대로 감싼 앱은 "웹사이트와 다를 게 없다"(4.2 최소 기능)로 거절될 수 있어요.
지금 앱에는 시스템 로그인 창 · 카메라 · 사진 보관함 · `sosodobo://` 링크가 있고,
더 확실하게 하려면 "새 사진이 올라왔어요 · 정산이 바뀌었어요" 푸시 알림을 붙이는 게 좋아요 (APNs 키 필요).

### 6. App Store Connect 에 앱 등록 (사용자 + Claude)
- 새 앱: 이름 `소소도보`, 기본 언어 한국어, 번들 ID `com.sosodobo.app`, SKU `sosodobo-ios`
- 개인정보 처리방침 URL: `https://sosodobo.vercel.app/privacy.html`
- 지원 URL: `https://sosodobo.vercel.app/support.html`
- 카테고리: 여행 (보조: 사진 및 비디오)
- 연령 등급: 4+ (설문에서 "사용자 생성 콘텐츠"는 있음 — 초대된 참여자끼리만)
- 스크린샷: 6.9인치(1320×2868) 필수 — 시뮬레이터 iPhone 17 Pro Max 에서 찍기 (Claude 가 찍어 드릴 수 있어요)

#### 설명 (초안)
- 부제: 같이 걷고, 같이 남기는 여행
- 설명:
  > 함께 떠나는 여행을 한곳에서. 날짜별 일정과 숙소, 항공권 · 렌터카 · 관광 티켓을 모아 두고, 여행 중 찍은 사진과 영상을 모두가 같은 앨범에 올려요. 걷다가 쓴 돈은 기록만 하면 누가 누구에게 얼마를 보내면 되는지 자동으로 정산돼요.
  >
  > · 여러 여행: 다가오는 여행과 지난 여행을 나눠 보기
  > · 날짜별 일정: 코스 · 이동 · 주차 · 숙소 · 미리보기 사진
  > · 날씨 · 일출/일몰: 여행 2주 전부터 예보
  > · 함께 쓰는 앨범: 촬영 시간 · 장소 · 일차별로 정리, 좋아요 · 댓글, 슬라이드 영상
  > · 지출 & 정산: 숙소비 자동 반영, 보낼 돈 한눈에
  > · 초대 링크 하나로 함께하기, 구글 · 카카오 로그인
- 키워드: 여행,일정,정산,더치페이,사진앨범,여행계획,동행,도보여행,숙소,티켓

#### 앱 개인정보 (App Privacy) 답변
| 항목 | 수집 | 사용자와 연결 | 추적 | 용도 |
|---|---|---|---|---|
| 이름 · 이메일 | 예 | 예 | 아니오 | 앱 기능 |
| 사진 또는 비디오 | 예 | 예 | 아니오 | 앱 기능 |
| 정밀 위치 (사진 EXIF) | 예 | 예 | 아니오 | 앱 기능 |
| 기타 사용자 콘텐츠 (일정 · 지출 · 댓글) | 예 | 예 | 아니오 | 앱 기능 |
| 사용자 ID | 예 | 예 | 아니오 | 앱 기능 |
| 광고 · 분석 · 추적 | 아니오 | — | 아니오 | — |

### 7. 빌드 올리기
- 서명 팀: `M2S8W9RG4Q` (Misol Kim, 개인) — 프로젝트에 설정됨, 자동 서명
- Xcode → Window → Organizer → Archives 에 `소소도보 1.0 (1)` 이 있어요 → Distribute App → App Store Connect → Upload
  (명령줄 업로드는 Xcode 에 저장된 Apple 계정을 못 써서 "Failed Registering Bundle Identifier" 로 실패해요)
- 다시 만들 때: Xcode 에서 `ios/App/App.xcworkspace` 열고 Product → Archive (기기: Any iOS Device)
- 올릴 때마다 Build 번호(CURRENT_PROJECT_VERSION)를 1씩 올려야 해요
- TestFlight 로 내 폰에서 먼저 써 보고 → 심사 제출

### 8. 스크린샷 (준비됨)
`ios/screenshots/6.9in/` — 1320×2868, 6.9인치 칸에 그대로 올리면 돼요 (데모 여행 화면, 9:41 상태바).
1 홈 · 2 사진첩 · 3 숙소 · 이동 · 4 정산 · 5 함께 가는 사람

### 9. 심사용 데모
- 데모 여행 "Demo Trip - Jeju 3 days" (Apple 로그인 계정이 관리자). 참여 코드는 공개 저장소라 여기 적지 않아요 —
  여행 화면 → 여행 ▾ → 참여 코드에서 확인해 심사 메모(App Review Information → Notes)에 넣기.

## 출시 전 확인할 것
- [ ] 실제 기기에서 구글 · 카카오 로그인 (시스템 로그인 창 → 앱으로 돌아오기)
- [ ] 사진 올리기 (사진 보관함 · 카메라), 영상 올리기
- [ ] 계정 삭제 (프로필 → 맨 아래)
- [ ] 인터넷을 끄고 열었을 때 안내 화면
- [ ] Vercel Blob 저장소 결제 상태 (막혀 있으면 사진 올리기가 실패 — 심사에서 거절 사유)
