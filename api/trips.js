// /api/trips  (여러 여행)
//   GET                          → 내가 참여한 여행 목록 (로그인이 꺼져 있으면 전체)
//   GET    ?id=5                 → 여행 정보 + 나의 역할 (참여자, 또는 링크 공개면 누구나)
//   POST   { title, region, startDate, endDate, summary?, visibility?, myName? } → 새 여행 (만든 사람 = 관리자)
//   PATCH  ?id=5 { title?, region?, startDate?, endDate?, summary?, visibility?, membersCanEdit? } → 수정 (관리자)
//   DELETE ?id=5                 → 삭제 (관리자) — 사람·지출·준비물·사진 모두 지워지고 사진 파일도 정리
//   POST   ?id=5&part=join-code  → 참여 코드 새로 만들기 (관리자)
//   POST   ?id=5&part=leave      → 이 여행에서 나가기 (관리자는 불가 — 삭제하거나 나중에 관리자 넘기기)
const { del } = require('@vercel/blob');
const { sql, ensureSchema, sendError, randomJoinCode } = require('./_db');
const A = require('./_auth');
const TripCore = require('../assets/trip-core.js');
const { findBlobToken } = require('./_blob-token');

function readBody(req) {
  if (!req.body) return {};
  if (typeof req.body === 'string') {
    try { return JSON.parse(req.body); } catch { return {}; }
  }
  return req.body;
}

/** 목록·상세 공통 모양. role 은 로그인이 꺼져 있으면 'admin' 처럼 취급(누구나 관리). */
function shape(row, extra) {
  return Object.assign(A.tripInfo(row), {
    role: row.role || null,
    travelerId: row.traveler_id || null,
    travelerName: row.traveler_name || null,
    memberCount: row.member_count !== undefined ? Number(row.member_count) : undefined,
    photoCount: row.photo_count !== undefined ? Number(row.photo_count) : undefined,
  }, extra || {});
}

async function myRow(tripId, uid) {
  const r = await sql`
    SELECT t.id, t.title, t.summary, t.region, to_char(t.start_date, 'YYYY-MM-DD') AS start_date, to_char(t.end_date, 'YYYY-MM-DD') AS end_date,
           t.visibility, t.members_can_edit, t.cover_url, t.legacy_key, t.join_code,
           tr.id AS traveler_id, tr.role, tr.name AS traveler_name,
           (SELECT COUNT(*) FROM travelers x WHERE x.trip_id = t.id) AS member_count,
           (SELECT COUNT(*) FROM photos p WHERE p.trip_id = t.id) AS photo_count
    FROM trips t LEFT JOIN travelers tr ON tr.trip_id = t.id AND tr.user_id = ${uid}
    WHERE t.id = ${tripId}`;
  return r.rows[0] || null;
}

async function handler(req, res) {
  const on = A.authEnabled();
  try {
    await ensureSchema();
    const uid = on ? A.sessionUserId(req) : null;
    const id = parseInt(req.query && req.query.id, 10);
    const part = String((req.query && req.query.part) || '');

    // ---- 목록 ----
    if (req.method === 'GET' && !Number.isInteger(id)) {
      if (on && !uid) return res.status(401).json({ error: '로그인이 필요해요.', code: 'login_required' });
      const r = on
        ? await sql`
          SELECT t.id, t.title, t.summary, t.region, to_char(t.start_date, 'YYYY-MM-DD') AS start_date, to_char(t.end_date, 'YYYY-MM-DD') AS end_date,
                 t.visibility, t.members_can_edit, t.cover_url, t.legacy_key, tr.id AS traveler_id, tr.role, tr.name AS traveler_name,
                 (SELECT COUNT(*) FROM travelers x WHERE x.trip_id = t.id) AS member_count,
                 (SELECT COUNT(*) FROM photos p WHERE p.trip_id = t.id) AS photo_count
          FROM trips t JOIN travelers tr ON tr.trip_id = t.id AND tr.user_id = ${uid}
          ORDER BY t.start_date DESC, t.id DESC`
        : await sql`
          SELECT t.id, t.title, t.summary, t.region, to_char(t.start_date, 'YYYY-MM-DD') AS start_date, to_char(t.end_date, 'YYYY-MM-DD') AS end_date,
                 t.visibility, t.members_can_edit, t.cover_url, t.legacy_key, 'admin' AS role,
                 (SELECT COUNT(*) FROM travelers x WHERE x.trip_id = t.id) AS member_count,
                 (SELECT COUNT(*) FROM photos p WHERE p.trip_id = t.id) AS photo_count
          FROM trips t ORDER BY t.start_date DESC, t.id DESC`;
      return res.status(200).json({ trips: r.rows.map((row) => shape(row)) });
    }

    // ---- 새 여행 ----
    if (req.method === 'POST' && !Number.isInteger(id)) {
      if (on && !uid) return res.status(401).json({ error: '로그인이 필요해요.', code: 'login_required' });
      const b = readBody(req);
      const parsed = TripCore.validateTrip(b);
      if (parsed.error) return res.status(400).json({ error: parsed.error });
      let myName = String(b.myName || '').trim();
      if (on && !myName) {
        const u = await sql`SELECT name FROM users WHERE id = ${uid}`;
        myName = String((u.rows[0] && u.rows[0].name) || '').trim();
      }
      if (myName.length > TripCore.LIMITS.nameMax) return res.status(400).json({ error: '이름은 40자 이하로 입력해 주세요.' });
      const v = parsed.value;
      let created = null;
      for (let attempt = 0; attempt < 3 && !created; attempt++) {
        try {
          const r = await sql`
            INSERT INTO trips (title, summary, region, start_date, end_date, visibility, members_can_edit, join_code, created_by)
            VALUES (${v.title}, ${v.summary}, ${v.region}, ${v.startDate}, ${v.endDate}, ${v.visibility}, ${v.membersCanEdit}, ${randomJoinCode()}, ${uid})
            RETURNING id`;
          created = r.rows[0];
        } catch (err) {
          if (!/join_code/.test(String(err && err.message))) throw err; // 코드가 우연히 겹치면 다시
        }
      }
      if (myName || on) {
        await sql`INSERT INTO travelers (name, user_id, trip_id, role) VALUES (${myName || '나'}, ${uid}, ${created.id}, 'admin')`;
      }
      const row = await myRow(created.id, uid);
      return res.status(201).json({ trip: shape(row, { joinCode: row.join_code }) });
    }

    if (!Number.isInteger(id)) return res.status(400).json({ error: '여행 id가 필요합니다.' });
    const row = await myRow(id, uid);
    if (!row) return res.status(404).json({ error: '여행을 찾을 수 없어요.', code: 'no_trip' });
    const member = !on || !!row.traveler_id;
    const admin = !on || row.role === 'admin';

    // ---- 상세 ----
    if (req.method === 'GET') {
      if (!member && row.visibility !== 'link') {
        return res.status(on && !uid ? 401 : 403).json(on && !uid
          ? { error: '로그인이 필요해요.', code: 'login_required' }
          : { error: '이 여행에 참여한 뒤에 볼 수 있어요.', code: 'join_required' });
      }
      const extra = { isMember: member, canEdit: member && (admin || row.members_can_edit) };
      if (admin) extra.joinCode = row.join_code;
      if (!on) extra.role = 'admin';
      return res.status(200).json({ trip: shape(row, extra) });
    }

    if (on && !uid) return res.status(401).json({ error: '로그인이 필요해요.', code: 'login_required' });
    if (!member) return res.status(403).json({ error: '이 여행에 참여한 뒤에 할 수 있어요.', code: 'join_required' });

    // ---- 나가기 ----
    if (req.method === 'POST' && part === 'leave') {
      if (on && admin) return res.status(409).json({ error: '관리자는 나갈 수 없어요. 여행을 삭제하거나, 다른 사람에게 관리자를 넘긴 뒤 나가 주세요.' });
      await sql`UPDATE travelers SET user_id = NULL WHERE id = ${row.traveler_id} AND trip_id = ${id}`;
      return res.status(200).json({ ok: true });
    }

    if (!admin) return res.status(403).json({ error: '여행 관리자만 할 수 있어요.', code: 'admin_only' });

    // ---- 참여 코드 새로 만들기 ----
    if (req.method === 'POST' && part === 'join-code') {
      const code = randomJoinCode();
      await sql`UPDATE trips SET join_code = ${code}, updated_at = now() WHERE id = ${id}`;
      return res.status(200).json({ joinCode: code });
    }

    // ---- 수정 ----
    if (req.method === 'PATCH') {
      const cur = A.tripInfo(row);
      const parsed = TripCore.validateTrip(readBody(req), { partial: true, current: cur });
      if (parsed.error) return res.status(400).json({ error: parsed.error });
      const v = Object.assign({
        title: cur.title, summary: cur.summary, region: cur.region, startDate: cur.startDate, endDate: cur.endDate,
        visibility: cur.visibility, membersCanEdit: cur.membersCanEdit,
      }, parsed.value);
      await sql`
        UPDATE trips SET title = ${v.title}, summary = ${v.summary}, region = ${v.region},
          start_date = ${v.startDate}, end_date = ${v.endDate}, visibility = ${v.visibility},
          members_can_edit = ${v.membersCanEdit}, updated_at = now()
        WHERE id = ${id}`;
      // 기간이 줄면 범위 밖 일차가 된 사진은 "일차 없음"으로
      const days = TripCore.tripDays(v.startDate, v.endDate);
      const cleared = await sql`UPDATE photos SET day = NULL WHERE trip_id = ${id} AND day > ${days} RETURNING id`;
      const after = await myRow(id, uid);
      return res.status(200).json({ trip: shape(after, { joinCode: after.join_code }), photosWithoutDay: cleared.rows.length });
    }

    // ---- 삭제 ----
    if (req.method === 'DELETE') {
      const files = await sql`SELECT url, thumb_url FROM photos WHERE trip_id = ${id}`;
      await sql`DELETE FROM trips WHERE id = ${id}`;
      const urls = files.rows.flatMap((f) => [f.url, f.thumb_url]).filter(Boolean);
      if (urls.length) {
        try { await del(urls, { token: findBlobToken(process.env) || undefined }); } catch (err) { console.error('Blob 파일 삭제 실패', err); }
      }
      return res.status(200).json({ ok: true });
    }

    res.setHeader('Allow', 'GET, POST, PATCH, DELETE');
    return res.status(405).json({ error: 'GET, POST, PATCH, DELETE만 지원합니다.' });
  } catch (err) {
    return sendError(res, err);
  }
}

module.exports = handler;
