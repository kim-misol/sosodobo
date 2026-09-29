// /api/photo-comments  (사진 댓글)
//   GET    ?photoId=10                          → 댓글 목록 (오래된 순)
//   POST   { photoId, travelerId, content }     → 댓글 작성
//   PATCH  ?id=7 { travelerId, content }        → 댓글 수정 (작성자만, "(수정됨)" 표시용 updated_at 기록)
//   DELETE ?id=7&travelerId=1                   → 댓글 삭제 (작성자만)
const { withMember } = require('./_auth');
const { sql, ensureSchema, sendError } = require('./_db');
const { toInt } = require('./_photo-validate');
const PhotoCore = require('../assets/photo-core.js');

function readBody(req) {
  if (!req.body) return {};
  if (typeof req.body === 'string') {
    try {
      return JSON.parse(req.body);
    } catch {
      return {};
    }
  }
  return req.body;
}

function iso(v) {
  if (!v) return null;
  const d = v instanceof Date ? v : new Date(v);
  return Number.isFinite(d.getTime()) ? d.toISOString() : null;
}

function mapComment(r) {
  return {
    id: r.id,
    photoId: r.photo_id,
    authorId: r.author_id,
    content: r.content,
    createdAt: iso(r.created_at),
    updatedAt: iso(r.updated_at),
  };
}

/** 댓글 하나를 찾아 작성자인지 확인. 문제가 있으면 { status, error }. */
async function findOwnedComment(idRaw, travelerIdRaw) {
  const id = toInt(idRaw);
  const travelerId = toInt(travelerIdRaw);
  if (!Number.isInteger(id) || !Number.isInteger(travelerId)) {
    return { status: 400, error: '댓글 id와 여행자 id가 필요합니다.' };
  }
  const r = await sql`SELECT id, photo_id, author_id FROM photo_comments WHERE id = ${id}`;
  if (r.rowCount === 0) return { status: 404, error: '해당 댓글을 찾을 수 없어요.' };
  if (!PhotoCore.canModify({ authorId: r.rows[0].author_id }, travelerId, 'authorId')) {
    return { status: 403, error: '본인이 쓴 댓글만 바꿀 수 있어요.' };
  }
  return { row: r.rows[0] };
}

async function handler(req, res) {
  try {
    await ensureSchema();

    if (req.method === 'GET') {
      const photoId = toInt(req.query.photoId);
      if (!Number.isInteger(photoId)) return res.status(400).json({ error: '사진 id가 필요합니다.' });
      const r = await sql`
        SELECT id, photo_id, author_id, content, created_at, updated_at
        FROM photo_comments WHERE photo_id = ${photoId}
          AND photo_id IN (SELECT id FROM photos WHERE trip_id = ${req.tripId})
        ORDER BY created_at ASC, id ASC`;
      return res.status(200).json({ photoId, comments: r.rows.map(mapComment) });
    }

    if (req.method === 'POST') {
      const b = readBody(req);
      const photoId = toInt(b.photoId);
      const travelerId = toInt(b.travelerId);
      if (!Number.isInteger(photoId) || !Number.isInteger(travelerId)) {
        return res.status(400).json({ error: '사진 id와 여행자 id가 필요합니다.' });
      }
      const content = PhotoCore.validateComment(b.content);
      if (content.error) return res.status(400).json({ error: content.error });
      const photo = await sql`SELECT 1 FROM photos WHERE id = ${photoId} AND trip_id = ${req.tripId}`;
      if (photo.rowCount === 0) return res.status(404).json({ error: '해당 사진을 찾을 수 없어요.' });
      const traveler = await sql`SELECT 1 FROM travelers WHERE id = ${travelerId} AND trip_id = ${req.tripId}`;
      if (traveler.rowCount === 0) return res.status(400).json({ error: '등록되지 않은 여행자예요.' });
      const r = await sql`
        INSERT INTO photo_comments (photo_id, author_id, content)
        VALUES (${photoId}, ${travelerId}, ${content.value})
        RETURNING id, photo_id, author_id, content, created_at, updated_at`;
      return res.status(201).json(mapComment(r.rows[0]));
    }

    if (req.method === 'PATCH') {
      const b = readBody(req);
      const found = await findOwnedComment(req.query.id, b.travelerId);
      if (found.error) return res.status(found.status).json({ error: found.error });
      const content = PhotoCore.validateComment(b.content);
      if (content.error) return res.status(400).json({ error: content.error });
      const r = await sql`
        UPDATE photo_comments SET content = ${content.value}, updated_at = now()
        WHERE id = ${found.row.id}
        RETURNING id, photo_id, author_id, content, created_at, updated_at`;
      return res.status(200).json(mapComment(r.rows[0]));
    }

    if (req.method === 'DELETE') {
      const found = await findOwnedComment(req.query.id, req.query.travelerId);
      if (found.error) return res.status(found.status).json({ error: found.error });
      await sql`DELETE FROM photo_comments WHERE id = ${found.row.id}`;
      return res.status(200).json({ ok: true });
    }

    res.setHeader('Allow', 'GET, POST, PATCH, DELETE');
    return res.status(405).json({ error: 'GET, POST, PATCH, DELETE만 지원합니다.' });
  } catch (err) {
    return sendError(res, err);
  }
}

// 로그인이 켜져 있으면 여행 참여자만, travelerId 는 로그인한 사람으로 (api/_auth.js)
module.exports = withMember(handler, { publicRead: true });
