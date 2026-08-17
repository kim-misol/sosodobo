# 남해 바래길 3일 도보여행 페이지 + 지출 정산

친구들과 공유할 여행 계획 페이지입니다. 어디를 어떻게 걷고 어디에 묵는지 보여주고,
걷다가 쓴 돈을 기록하면 **여행자별로 자동 정산**해 줍니다.

- 여행자를 등록하고
- 지출을 기록할 때 **금액 + 결제자 + 함께 나눌 사람**을 고르면
- 마지막에 **여행자별로 낼 돈/받을 돈**과 **누가 누구에게 얼마 보내면 되는지**까지 계산됩니다.

정산 기록은 서버(공유 저장소)에 저장돼서 **여러 명이 같은 화면을 봅니다.**

---

## 왜 GitHub Pages가 아니라 Vercel인가요?

여러 명이 **같은 정산 데이터를 공유**하려면 데이터를 저장할 서버(DB)가 필요합니다.
GitHub Pages는 파일만 올리는 정적 호스팅이라 DB를 붙일 수 없어서, 무료로 서버 기능과
DB를 함께 쓸 수 있는 **Vercel + Vercel Postgres(Neon)** 로 올립니다. 둘 다 무료 범위로 충분합니다.

---

## 배포 방법 (깃 명령어 몰라도 됨)

### 1단계. 코드를 GitHub 저장소에 올리기
이미 `kim-misol/sosodobo` 저장소를 쓰고 있다면, 이 폴더의 바뀐/새 파일을 그대로 올리면 됩니다.
저장소 페이지에서 **Add file → Upload files** 로 아래 파일들을 통째로 끌어다 놓고 **Commit** 하세요.

- `index.html` (수정됨)
- `package.json` (수정됨)
- `.gitignore` (새 파일)
- `api/` 폴더 통째로 (`_db.js`, `state.js`, `travelers.js`, `expenses.js`)
- `assets/settle-core.js`, `assets/settle-ui.js` (새 파일)
- `tests/settlement.test.js` (새 파일)

### 2단계. Vercel에 저장소 연결
1. [vercel.com](https://vercel.com) 접속 → **Continue with GitHub** 로 로그인
2. 대시보드에서 **Add New… → Project**
3. 목록에서 `sosodobo` 저장소를 찾아 **Import**
4. 설정은 기본값 그대로 두고 **Deploy** 클릭 (1~2분 소요)
   - 아직 DB가 없어서 정산 화면은 "DB가 연결되지 않았어요" 라고 나올 수 있어요. 3단계에서 연결합니다.

### 3단계. 공유 저장소(Postgres) 연결
1. 방금 만든 Vercel 프로젝트 화면 위쪽 메뉴에서 **Storage** 탭 클릭
2. **Create Database** → **Postgres** (Neon) 선택 → 약관 동의 후 생성 (무료 플랜)
3. 만든 DB를 이 프로젝트에 **Connect** — 필요한 환경변수(`POSTGRES_URL` 등)가 자동으로 추가됩니다
4. 화면 안내에 따라 **Redeploy(재배포)** 하면 끝
   - 표(테이블)는 첫 요청 때 코드가 자동으로 만들어 주니 SQL을 직접 칠 필요 없어요.

### 4단계. 주소 공유
프로젝트의 **Domains** 에 뜨는 주소(예: `https://sosodobo.vercel.app`)를 친구들에게 카톡으로 공유하면 됩니다.
같은 주소에 들어오면 모두 같은 여행자·지출·정산 화면을 봅니다.

---

## 쓰는 법
1. **여행자** 칸에 함께 가는 사람들 이름을 하나씩 추가
2. **지출 기록** 에서 내용·금액·결제자를 고르고, "함께 정산할 사람"에서 그 지출을 나눌 사람을 체크 (선택한 인원끼리 1/N)
3. **여행자별 정산** 에서 각자 낼 돈/받을 돈과, 송금 방법이 자동으로 정리됩니다

> 금액은 원(₩) 단위 정수로 계산하고, 1/N 으로 나눌 때 생기는 1원 단위 나머지는
> 참여자에게 골고루 배분해 **합계가 항상 원금과 정확히 맞도록** 처리합니다.

---

## 개발자 메모
- 정산 계산 로직은 `assets/settle-core.js` 에 순수 함수로 분리돼 있고 `tests/settlement.test.js` 로 검증합니다.
- 서버리스 API: `api/state.js`(전체 조회), `api/travelers.js`, `api/expenses.js`. 공용 DB 헬퍼는 `api/_db.js`.
- 테스트 실행:
  ```bash
  npm test        # node --test (carousel + settlement 단위 테스트)
  ```
- 로컬에서 API까지 돌려보려면 [Vercel CLI](https://vercel.com/docs/cli) 로 `vercel dev` 를 쓰면 됩니다.
