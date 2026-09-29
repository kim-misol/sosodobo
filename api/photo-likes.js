// /api/photo-likes  (사진 좋아요)
//   POST   { photoId, travelerId }        → 좋아요 (이미 눌렀으면 그대로)
//   DELETE ?photoId=10&travelerId=1       → 좋아요 취소
// 두 경우 모두 { photoId, likeCount, likedBy } 로 최신 상태를 돌려줍니다.
const { withMember } = require('./_auth');
const { sql, ensureSchema, sendError } = require('./_db');
const { toInt } = require('./_photo-validate');

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

async function likeState(photoId) {
  const r = await sql`
    SELECT traveler_id FROM photo_likes WHERE photo_id = ${photoId} ORDER BY created_at ASC`;
  const likedBy = r.rows.map((row) => Number(row.traveler_id));
  return { photoId, likeCount: likedBy.length, likedBy };
}

async function handler(req, res) {
  if (req.method !== 'POST' && req.method !== 'DELETE') {
    res.setHeader('Allow', 'POST, DELETE');
    return res.status(405).json({ error: 'POST, DELETE만 지원합니다.' });
  }
  try {
    await ensureSchema();
    const src = req.method === 'POST' ? readBody(req) : req.query;
    const photoId = toInt(src.photoId);
    const travelerId = toInt(src.travelerId);
    if (!Number.isInteger(photoId) || !Number.isInteger(travelerId)) {
      return res.status(400).json({ error: '사진 id와 여행자 id가 필요합니다.' });
    }

    if (req.method === 'POST') {
      const photo = await sql`SELECT 1 FROM photos WHERE id = ${photoId} AND trip_id = ${req.tripId}`;
      if (photo.rowCount === 0) return res.status(404).json({ error: '해당 사진을 찾을 수 없어요.' });
      const traveler = await sql`SELECT 1 FROM travelers WHERE id = ${travelerId} AND trip_id = ${req.tripId}`;
      if (traveler.rowCount === 0) return res.status(400).json({ error: '등록되지 않은 여행자예요.' });
      await sql`
        INSERT INTO photo_likes (photo_id, traveler_id) VALUES (${photoId}, ${travelerId})
        ON CONFLICT (photo_id, traveler_id) DO NOTHING`;
    } else {
      await sql`DELETE FROM photo_likes WHERE photo_id = ${photoId} AND traveler_id = ${travelerId}`;
    }
    return res.status(200).json(await likeState(photoId));
  } catch (err) {
    return sendError(res, err);
  }
}

// 로그인이 켜져 있으면 여행 참여자만, travelerId 는 로그인한 사람으로 (api/_auth.js)
module.exports = withMember(handler);
