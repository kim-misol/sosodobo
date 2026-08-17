// 공용 DB 헬퍼. 파일명이 밑줄(_)로 시작하면 Vercel 이 이 파일을 API 경로로
// 노출하지 않고, 다른 함수에서 import 해서 쓰는 유틸로만 취급합니다.
//
// Vercel Postgres(Neon) 연동 시 POSTGRES_URL 등의 환경변수가 자동으로 주입됩니다.
const { sql } = require('@vercel/postgres');

let schemaReady = null;

// 테이블이 없으면 만듭니다. 최초 요청 때 한 번만 실행되도록 캐싱합니다.
async function ensureSchema() {
  if (!schemaReady) {
    schemaReady = (async () => {
      await sql`CREATE TABLE IF NOT EXISTS travelers (
        id SERIAL PRIMARY KEY,
        name TEXT NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now()
      )`;
      await sql`CREATE TABLE IF NOT EXISTS expenses (
        id SERIAL PRIMARY KEY,
        description TEXT NOT NULL,
        amount BIGINT NOT NULL CHECK (amount >= 0),
        payer_id INTEGER REFERENCES travelers(id) ON DELETE SET NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now()
      )`;
      await sql`CREATE TABLE IF NOT EXISTS expense_splits (
        expense_id INTEGER NOT NULL REFERENCES expenses(id) ON DELETE CASCADE,
        traveler_id INTEGER NOT NULL REFERENCES travelers(id) ON DELETE CASCADE,
        PRIMARY KEY (expense_id, traveler_id)
      )`;
      // 준비물 메모: 여행자들이 직접 추가/수정/삭제하는 항목.
      await sql`CREATE TABLE IF NOT EXISTS notes (
        id SERIAL PRIMARY KEY,
        content TEXT NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now()
      )`;
      // 최초 1회 시드 여부 등을 기록하는 작은 메타 테이블.
      await sql`CREATE TABLE IF NOT EXISTS app_meta (
        key TEXT PRIMARY KEY,
        value TEXT
      )`;
      // 기존 준비물 항목은 최초 1회만 채워 넣습니다.
      // (사용자가 나중에 전부 지워도 다시 생기지 않도록 플래그로 제어)
      const seeded = await sql`SELECT 1 FROM app_meta WHERE key = 'notes_seeded'`;
      if (seeded.rowCount === 0) {
        const defaults = [
          '2일차 숙소 앞바다에서 수영 가능 — 수영복 & 스노클 챙기기',
          '연휴 기간이라 숙소 예약이 빨리 마감되니 일정 변동 시 미리 공유하기',
          '가방은 최대한 가볍게, 그 대신 체력은 미리 만들어두기 ㅋㅋ',
          '고사리밭길 사전예약 필요 여부 다시 한 번 확인',
        ];
        for (const c of defaults) {
          await sql`INSERT INTO notes (content) VALUES (${c})`;
        }
        await sql`INSERT INTO app_meta (key, value) VALUES ('notes_seeded', 'true')`;
      }
    })().catch((err) => {
      // 실패하면 다음 요청에서 다시 시도할 수 있게 캐시를 비웁니다.
      schemaReady = null;
      throw err;
    });
  }
  return schemaReady;
}

// 공통 응답 헬퍼: JSON + 간단한 에러 처리.
function sendError(res, err) {
  console.error(err);
  const configHint = /missing_connection_string|POSTGRES_URL|connection string/i.test(
    String(err && err.message),
  );
  res.status(500).json({
    error: configHint
      ? 'DB가 아직 연결되지 않았어요. Vercel 프로젝트에 Postgres(Neon) 저장소를 연결했는지 확인해 주세요.'
      : (err && err.message) || '알 수 없는 오류가 발생했습니다.',
  });
}

module.exports = { sql, ensureSchema, sendError };
