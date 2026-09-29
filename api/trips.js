// /api/trips  (여러 여행)
//   GET                          → 내가 참여한 여행 목록 (로그인이 꺼져 있으면 전체)
//   GET    ?id=5                 → 여행 정보 + 나의 역할 (참여자, 또는 링크 공개면 누구나)
//   POST   { title, region, startDate, endDate, summary?, visibility?, myName? } → 새 여행 (만든 사람 = 관리자)
//   PATCH  ?id=5 { title?, region?, startDate?, endDate?, summary?, visibility?, membersCanEdit? } → 수정 (관리자)
//   DELETE ?id=5                 → 삭제 (관리자) — 사람·지출·준비물·사진 모두 지워지고 사진 파일도 정리
//   POST   ?id=5&part=join-code  → 참여 코드 새로 만들기 (관리자)
//   POST   ?id=5&part=leave      → 이 여행에서 나가기 (관리자는 불가 — 삭제하거나 나중에 관리자 넘기기)
//
//   날짜별 일정 (보기: 참여자 · 링크 공개면 누구나 / 고치기: 관리자, "참여자 모두 수정"이 켜져 있으면 참여자도)
//   GET    ?id=5&part=itinerary               → { days: [...], lodgings: [...], canEdit }
//   PATCH  ?id=5&part=day&day=2 { title?, summary?, planMode?, freeNote? }
//   POST   ?id=5&part=item&day=2 { kind: 'course'|'move'|'parking', ... } → 그날 맨 뒤에 추가
//   PATCH  ?id=5&part=item&item=9 { ... }  ·  DELETE ?id=5&part=item&item=9
//   POST   ?id=5&part=item-move&item=9 { dir: -1|1 } → 같은 종류 안에서 한 칸 위/아래
const { del } = require('@vercel/blob');
const { sql, ensureSchema, sendError, randomJoinCode } = require('./_db');
const A = require('./_auth');
const TripCore = require('../assets/trip-core.js');
const I = require('../assets/itinerary-core.js');
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

function mapItem(r) {
  return {
    id: r.id, kind: r.kind, position: r.position, name: r.name, subtitle: r.subtitle,
    fromPlace: r.from_place, toPlace: r.to_place,
    distanceKm: r.distance_km === null || r.distance_km === undefined ? null : Number(r.distance_km),
    durationText: r.duration_text, difficulty: r.difficulty, mode: r.mode, timing: r.timing,
    mapUrl: r.map_url, mapProvider: I.detectMapProvider(r.map_url), linkUrl: r.link_url, imageUrl: r.image_url, memo: r.memo,
  };
}

async function loadItinerary(trip) {
  const days = await sql`
    SELECT id, day_no, title, summary, plan_mode, free_note FROM trip_days WHERE trip_id = ${trip.id} ORDER BY day_no`;
  const items = await sql`
    SELECT i.* FROM day_items i JOIN trip_days d ON d.id = i.day_id WHERE d.trip_id = ${trip.id} ORDER BY i.position, i.id`;
  const photos = await sql`
    SELECT p.id, p.day_id, p.position, p.url, p.thumb_url, p.caption, p.width, p.height
    FROM day_photos p JOIN trip_days d ON d.id = p.day_id WHERE d.trip_id = ${trip.id} ORDER BY p.position, p.id`;
  const lodgings = await sql`
    SELECT l.id, l.name, to_char(l.check_in, 'YYYY-MM-DD') AS check_in, l.nights, l.cost, l.memo, l.address,
           l.map_url, l.map_provider, l.link_url, l.image_url, l.expense_id,
           COALESCE((SELECT ARRAY_AGG(g.traveler_id ORDER BY g.traveler_id) FROM lodging_guests g WHERE g.lodging_id = l.id), '{}') AS guest_ids
    FROM lodgings l WHERE l.trip_id = ${trip.id} ORDER BY l.check_in, l.id`;
  const rows = days.rows.map((d) => ({
    id: d.id, dayNo: d.day_no, title: d.title, summary: d.summary, planMode: d.plan_mode, freeNote: d.free_note,
    items: items.rows.filter((i) => i.day_id === d.id).map(mapItem),
    photos: photos.rows.filter((p) => p.day_id === d.id).map((p) => ({
      id: p.id, url: p.url, thumbUrl: p.thumb_url || p.url, caption: p.caption, width: p.width, height: p.height,
    })),
  }));
  return {
    days: I.buildDays(trip.startDate, trip.days, rows),
    lodgings: lodgings.rows.map((l) => ({
      id: l.id, name: l.name, checkIn: l.check_in, nights: l.nights, cost: l.cost === null ? null : Number(l.cost),
      memo: l.memo, address: l.address, mapUrl: l.map_url, mapProvider: l.map_provider || I.detectMapProvider(l.map_url),
      linkUrl: l.link_url, imageUrl: l.image_url, expenseId: l.expense_id, guestIds: (l.guest_ids || []).map(Number),
    })),
  };
}

/** 그 날짜 행을 (없으면 만들어) 돌려줌 */
async function ensureDay(tripId, dayNo) {
  await sql`INSERT INTO trip_days (trip_id, day_no) VALUES (${tripId}, ${dayNo}) ON CONFLICT (trip_id, day_no) DO NOTHING`;
  const r = await sql`SELECT id FROM trip_days WHERE trip_id = ${tripId} AND day_no = ${dayNo}`;
  return r.rows[0].id;
}

/** 이 여행의 항목인지 확인하고 행을 돌려줌 */
async function findItem(tripId, itemId) {
  const r = await sql`
    SELECT i.* FROM day_items i JOIN trip_days d ON d.id = i.day_id WHERE i.id = ${itemId} AND d.trip_id = ${tripId}`;
  return r.rows[0] || null;
}

const ITEM_COLUMNS = {
  name: 'name', subtitle: 'subtitle', fromPlace: 'from_place', toPlace: 'to_place', distanceKm: 'distance_km',
  durationText: 'duration_text', difficulty: 'difficulty', mode: 'mode', timing: 'timing',
  mapUrl: 'map_url', linkUrl: 'link_url', memo: 'memo',
};

async function handleItinerary(req, res, row, ctx) {
  const part = String(req.query.part || '');
  const trip = A.tripInfo(row);

  if (req.method === 'GET' && part === 'itinerary') {
    if (!ctx.member && row.visibility !== 'link') {
      return res.status(ctx.on && !ctx.uid ? 401 : 403).json(ctx.on && !ctx.uid
        ? { error: '로그인이 필요해요.', code: 'login_required' }
        : { error: '이 여행에 참여한 뒤에 볼 수 있어요.', code: 'join_required' });
    }
    const it = await loadItinerary(trip);
    return res.status(200).json(Object.assign(it, { canEdit: ctx.canEdit }));
  }

  if (ctx.on && !ctx.uid) return res.status(401).json({ error: '로그인이 필요해요.', code: 'login_required' });
  if (!ctx.canEdit) {
    return res.status(403).json({ error: ctx.member ? '관리자만 일정을 고칠 수 있게 설정돼 있어요.' : '이 여행에 참여한 뒤에 고칠 수 있어요.', code: 'cannot_edit' });
  }
  const b = readBody(req);

  if (part === 'day' && req.method === 'PATCH') {
    const dayNo = parseInt(req.query.day, 10);
    if (!(dayNo >= 1 && dayNo <= trip.days)) return res.status(400).json({ error: '날짜가 여행 기간 밖이에요.' });
    const parsed = I.validateDay(b);
    if (parsed.error) return res.status(400).json({ error: parsed.error });
    const dayId = await ensureDay(trip.id, dayNo);
    const v = parsed.value;
    const cur = (await sql`SELECT title, summary, plan_mode, free_note FROM trip_days WHERE id = ${dayId}`).rows[0];
    await sql`
      UPDATE trip_days SET
        title = ${'title' in v ? v.title : cur.title}, summary = ${'summary' in v ? v.summary : cur.summary},
        plan_mode = ${'planMode' in v ? v.planMode : cur.plan_mode}, free_note = ${'freeNote' in v ? v.freeNote : cur.free_note}
      WHERE id = ${dayId}`;
    return res.status(200).json(await loadItinerary(trip));
  }

  if (part === 'item' && req.method === 'POST') {
    const dayNo = parseInt(req.query.day, 10);
    if (!(dayNo >= 1 && dayNo <= trip.days)) return res.status(400).json({ error: '날짜가 여행 기간 밖이에요.' });
    const parsed = I.validateItem(b.kind, b);
    if (parsed.error) return res.status(400).json({ error: parsed.error });
    const dayId = await ensureDay(trip.id, dayNo);
    const count = await sql`SELECT COUNT(*) AS n, COALESCE(MAX(position), 0) AS maxpos FROM day_items WHERE day_id = ${dayId}`;
    if (Number(count.rows[0].n) >= I.LIMITS.itemsPerDay) return res.status(400).json({ error: '하루에 항목은 ' + I.LIMITS.itemsPerDay + '개까지 넣을 수 있어요.' });
    const v = parsed.value;
    await sql`
      INSERT INTO day_items (day_id, kind, position, name, subtitle, from_place, to_place, distance_km, duration_text, difficulty,
                             mode, timing, map_url, link_url, memo)
      VALUES (${dayId}, ${b.kind}, ${Number(count.rows[0].maxpos) + 1}, ${v.name || null}, ${v.subtitle || null}, ${v.fromPlace || null},
              ${v.toPlace || null}, ${v.distanceKm === undefined ? null : v.distanceKm}, ${v.durationText || null},
              ${v.difficulty === undefined ? null : v.difficulty}, ${v.mode || null}, ${v.timing || null},
              ${v.mapUrl || null}, ${v.linkUrl || null}, ${v.memo || null})`;
    return res.status(201).json(await loadItinerary(trip));
  }

  const itemId = parseInt(req.query.item, 10);
  if ((part === 'item' || part === 'item-move') && Number.isInteger(itemId)) {
    const item = await findItem(trip.id, itemId);
    if (!item) return res.status(404).json({ error: '이 여행에 없는 항목이에요.' });

    if (part === 'item' && req.method === 'DELETE') {
      await sql`DELETE FROM day_items WHERE id = ${itemId}`;
      return res.status(200).json(await loadItinerary(trip));
    }
    if (part === 'item' && req.method === 'PATCH') {
      const parsed = I.validateItem(item.kind, b, { partial: true });
      if (parsed.error) return res.status(400).json({ error: parsed.error });
      const merged = mapItem(item);
      Object.assign(merged, parsed.value);
      // 이동은 출발·도착·메모 중 하나는 남아 있어야
      if (item.kind === 'move' && !merged.fromPlace && !merged.toPlace && !merged.memo) {
        return res.status(400).json({ error: '출발 · 도착 · 메모 중 하나는 적어 주세요.' });
      }
      await sql`
        UPDATE day_items SET name = ${merged.name}, subtitle = ${merged.subtitle}, from_place = ${merged.fromPlace}, to_place = ${merged.toPlace},
          distance_km = ${merged.distanceKm}, duration_text = ${merged.durationText}, difficulty = ${merged.difficulty},
          mode = ${merged.mode}, timing = ${merged.timing}, map_url = ${merged.mapUrl}, link_url = ${merged.linkUrl}, memo = ${merged.memo}
        WHERE id = ${itemId}`;
      return res.status(200).json(await loadItinerary(trip));
    }
    if (part === 'item-move' && req.method === 'POST') {
      const siblings = await sql`SELECT id, kind, timing, position FROM day_items WHERE day_id = ${item.day_id}`;
      const changes = I.moveItem(siblings.rows, itemId, Number(b.dir));
      for (const c of changes) await sql`UPDATE day_items SET position = ${c.position} WHERE id = ${c.id}`;
      return res.status(200).json(await loadItinerary(trip));
    }
  }
  return res.status(400).json({ error: '알 수 없는 요청이에요.' });
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

    // ---- 날짜별 일정 ----
    if (['itinerary', 'day', 'item', 'item-move'].indexOf(part) >= 0) {
      return handleItinerary(req, res, row, { on, uid, member, admin, canEdit: member && (admin || row.members_can_edit) });
    }

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
      await sql`DELETE FROM trip_days WHERE trip_id = ${id} AND day_no > ${days}`; // 줄어든 날짜의 일정 (화면에서 미리 경고)
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
