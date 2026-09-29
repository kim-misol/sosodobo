// 공용 DB 헬퍼. 파일명이 밑줄(_)로 시작하면 Vercel 이 이 파일을 API 경로로
// 노출하지 않고, 다른 함수에서 import 해서 쓰는 유틸로만 취급합니다.
//
// Vercel Postgres(Neon) 연동 시 POSTGRES_URL 등의 환경변수가 자동으로 주입됩니다.
// LOCAL_PG_URL 이 있으면 (로컬 리허설·개발용) 그 Postgres 에 node-postgres 로 붙습니다.
const crypto = require('node:crypto');
const sql = process.env.LOCAL_PG_URL ? require('./_pg-local')(process.env.LOCAL_PG_URL) : require('@vercel/postgres').sql;
const TripPlaces = require('../assets/places.js');
const { LIMITS } = require('../assets/photo-core.js');

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
      // 사진·영상 앨범. 파일은 Vercel Blob 에 두고 여기엔 주소와 촬영 정보만 저장합니다.
      // taken_at/lat/lng/place_name 은 사용자가 고칠 수 있는 현재 값,
      // original_* 은 파일에서 읽은 원본 값('원래대로' 되돌리기용)입니다.
      await sql`CREATE TABLE IF NOT EXISTS photos (
        id SERIAL PRIMARY KEY,
        uploader_id INTEGER REFERENCES travelers(id) ON DELETE SET NULL,
        media_type TEXT NOT NULL DEFAULT 'image' CHECK (media_type IN ('image', 'video')),
        url TEXT NOT NULL,
        thumb_url TEXT NOT NULL,
        width INTEGER,
        height INTEGER,
        duration_sec REAL,
        caption TEXT,
        day SMALLINT,
        taken_at TIMESTAMPTZ,
        taken_at_source TEXT,
        lat DOUBLE PRECISION,
        lng DOUBLE PRECISION,
        place_name TEXT,
        location_source TEXT,
        original_taken_at TIMESTAMPTZ,
        original_taken_at_source TEXT,
        original_lat DOUBLE PRECISION,
        original_lng DOUBLE PRECISION,
        camera JSONB,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
      )`;
      // 좋아요: (사진, 여행자) 한 쌍이 한 번만 — 1인 1좋아요를 DB 가 보장합니다.
      await sql`CREATE TABLE IF NOT EXISTS photo_likes (
        photo_id INTEGER NOT NULL REFERENCES photos(id) ON DELETE CASCADE,
        traveler_id INTEGER NOT NULL REFERENCES travelers(id) ON DELETE CASCADE,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        PRIMARY KEY (photo_id, traveler_id)
      )`;
      // 댓글: updated_at 이 NULL 이 아니면 "(수정됨)" 으로 표시합니다.
      await sql`CREATE TABLE IF NOT EXISTS photo_comments (
        id SERIAL PRIMARY KEY,
        photo_id INTEGER NOT NULL REFERENCES photos(id) ON DELETE CASCADE,
        author_id INTEGER REFERENCES travelers(id) ON DELETE SET NULL,
        content TEXT NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        updated_at TIMESTAMPTZ
      )`;
      await sql`CREATE INDEX IF NOT EXISTS photo_comments_photo_idx ON photo_comments (photo_id, created_at)`;
      // 계정: 사람(users) 1명에 Google·카카오 로그인(user_identities)을 여러 개 이어 둘 수 있어요.
      // 여행자(travelers)는 계정과 1:1 로 연결되고(user_id), 연결 안 된 여행자는 첫 로그인 때 "이게 나" 로 고릅니다.
      await sql`CREATE TABLE IF NOT EXISTS users (
        id SERIAL PRIMARY KEY,
        name TEXT,
        email TEXT,
        avatar_url TEXT,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        last_login_at TIMESTAMPTZ
      )`;
      await sql`CREATE TABLE IF NOT EXISTS user_identities (
        provider TEXT NOT NULL,
        provider_user_id TEXT NOT NULL,
        user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        email TEXT,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        PRIMARY KEY (provider, provider_user_id)
      )`;
      await sql`ALTER TABLE travelers ADD COLUMN IF NOT EXISTS user_id INTEGER REFERENCES users(id) ON DELETE SET NULL`;

      // 여러 여행: 여행마다 사람·지출·준비물·사진이 따로. 한 계정은 여행마다 여행자 1명으로 참여.
      await sql`CREATE TABLE IF NOT EXISTS trips (
        id SERIAL PRIMARY KEY,
        title TEXT NOT NULL,
        summary TEXT,
        region TEXT NOT NULL,
        start_date DATE NOT NULL,
        end_date DATE NOT NULL,
        visibility TEXT NOT NULL DEFAULT 'private' CHECK (visibility IN ('private', 'link')),
        members_can_edit BOOLEAN NOT NULL DEFAULT true,
        cover_url TEXT,
        join_code TEXT NOT NULL,
        legacy_key TEXT UNIQUE,
        created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        updated_at TIMESTAMPTZ
      )`;
      await sql`CREATE UNIQUE INDEX IF NOT EXISTS trips_join_code_key ON trips (lower(join_code))`;
      await sql`ALTER TABLE travelers ADD COLUMN IF NOT EXISTS trip_id INTEGER REFERENCES trips(id) ON DELETE CASCADE`;
      await sql`ALTER TABLE travelers ADD COLUMN IF NOT EXISTS role TEXT NOT NULL DEFAULT 'member'`;
      await sql`ALTER TABLE expenses ADD COLUMN IF NOT EXISTS trip_id INTEGER REFERENCES trips(id) ON DELETE CASCADE`;
      await sql`ALTER TABLE notes ADD COLUMN IF NOT EXISTS trip_id INTEGER REFERENCES trips(id) ON DELETE CASCADE`;
      await sql`ALTER TABLE photos ADD COLUMN IF NOT EXISTS trip_id INTEGER REFERENCES trips(id) ON DELETE CASCADE`;
      await sql`DROP INDEX IF EXISTS travelers_user_id_key`;
      await sql`CREATE UNIQUE INDEX IF NOT EXISTS travelers_trip_user_key ON travelers (trip_id, user_id) WHERE user_id IS NOT NULL`;
      await sql`CREATE INDEX IF NOT EXISTS travelers_trip_idx ON travelers (trip_id)`;
      await sql`CREATE INDEX IF NOT EXISTS expenses_trip_idx ON expenses (trip_id)`;
      await sql`CREATE INDEX IF NOT EXISTS notes_trip_idx ON notes (trip_id)`;
      await sql`CREATE INDEX IF NOT EXISTS photos_trip_idx ON photos (trip_id)`;
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
      await backfillPhotoDays();
      await migrateLegacyTrip();
    })().catch((err) => {
      // 실패하면 다음 요청에서 다시 시도할 수 있게 캐시를 비웁니다.
      schemaReady = null;
      throw err;
    });
  }
  return schemaReady;
}

// 여행 첫날(TRIP_START_DATE)을 정하기 전에 올라와 일차가 비어 있는 사진을, 촬영 날짜(한국 시간)로
// 한 번만 채웁니다. 이후 사용자가 '기타'로 바꾼 사진은 건드리지 않도록 첫날 날짜별 플래그로 제어해요.
async function backfillPhotoDays() {
  const start = TripPlaces.TRIP_START_DATE;
  if (!start) return;
  const key = `photo_days_filled:${start}`;
  const done = await sql`SELECT 1 FROM app_meta WHERE key = ${key}`;
  if (done.rowCount > 0) return;
  await sql`
    UPDATE photos
    SET day = ((taken_at AT TIME ZONE 'Asia/Seoul')::date - ${start}::date) + 1
    WHERE day IS NULL AND taken_at IS NOT NULL
      AND ((taken_at AT TIME ZONE 'Asia/Seoul')::date - ${start}::date) BETWEEN 0 AND ${LIMITS.tripDays - 1}`;
  await sql`INSERT INTO app_meta (key, value) VALUES (${key}, 'true') ON CONFLICT (key) DO NOTHING`;
}

// 참여 코드: 헷갈리는 글자(0/O, 1/I/L)를 뺀 8자리.
const CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
function randomJoinCode() {
  const bytes = crypto.randomBytes(8);
  return Array.from(bytes, (b) => CODE_ALPHABET[b % CODE_ALPHABET.length]).join('');
}

/**
 * 여러 여행 이전의 데이터(여행 구분이 없는 여행자·지출·준비물·사진)를 "남해 바래길" 여행으로 한 번 옮깁니다.
 * - 참여 코드는 지금 쓰던 TRIP_JOIN_CODE 를 그대로 (없으면 새로 만듦)
 * - 이미 로그인해 연결된 사람 중 가장 먼저 가입한 사람이 관리자
 * 몇 번을 실행해도 결과가 같게(이미 옮긴 행은 건드리지 않음) 만들고, 끝나면 app_meta 에 기록합니다.
 */
async function migrateLegacyTrip() {
  const done = await sql`SELECT value FROM app_meta WHERE key = 'legacy_trip_id'`;
  if (done.rowCount > 0) return;
  const orphans = await sql`
    SELECT (SELECT COUNT(*) FROM travelers WHERE trip_id IS NULL)
         + (SELECT COUNT(*) FROM expenses WHERE trip_id IS NULL)
         + (SELECT COUNT(*) FROM notes WHERE trip_id IS NULL)
         + (SELECT COUNT(*) FROM photos WHERE trip_id IS NULL) AS n`;
  if (Number(orphans.rows[0].n) === 0) {
    await sql`INSERT INTO app_meta (key, value) VALUES ('legacy_trip_id', 'none') ON CONFLICT (key) DO NOTHING`;
    return;
  }
  let tripId;
  const existing = await sql`SELECT id FROM trips WHERE legacy_key = 'namhae'`;
  if (existing.rowCount > 0) {
    tripId = existing.rows[0].id;
  } else {
    const code = String(process.env.TRIP_JOIN_CODE || '').trim() || randomJoinCode();
    const creator = await sql`
      SELECT u.id FROM users u JOIN travelers t ON t.user_id = u.id ORDER BY u.created_at ASC, u.id ASC LIMIT 1`;
    const created = await sql`
      INSERT INTO trips (title, summary, region, start_date, end_date, join_code, legacy_key, created_by)
      VALUES ('남해 바래길', '함께 걷는 3일 코스', '남해 · 창선면 일대', ${TripPlaces.TRIP_START_DATE || '2026-09-24'}, '2026-09-26',
              ${code}, 'namhae', ${creator.rows.length ? creator.rows[0].id : null})
      RETURNING id`;
    tripId = created.rows[0].id;
  }
  await sql`UPDATE travelers SET trip_id = ${tripId} WHERE trip_id IS NULL`;
  await sql`UPDATE expenses SET trip_id = ${tripId} WHERE trip_id IS NULL`;
  await sql`UPDATE notes SET trip_id = ${tripId} WHERE trip_id IS NULL`;
  await sql`UPDATE photos SET trip_id = ${tripId} WHERE trip_id IS NULL`;
  await sql`
    UPDATE travelers SET role = 'admin'
    WHERE id = (
      SELECT t.id FROM travelers t JOIN users u ON u.id = t.user_id
      WHERE t.trip_id = ${tripId} ORDER BY u.created_at ASC, u.id ASC LIMIT 1
    )`;
  await sql`INSERT INTO app_meta (key, value) VALUES ('legacy_trip_id', ${String(tripId)}) ON CONFLICT (key) DO NOTHING`;
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

module.exports = { sql, ensureSchema, sendError, randomJoinCode };
