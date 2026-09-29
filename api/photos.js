// /api/photos  (사진·영상 앨범)
//   GET                                   → 사진 목록 + 여행자 목록
//   POST   { uploaderId, url, thumbUrl, … } → 업로드가 끝난 파일을 앨범에 등록
//   PATCH  ?id=10 { travelerId, caption?, day?, takenAt?, lat?, lng?, placeName?, locationSource?, reset? }
//                                          → 일차·촬영시각·위치 수정 / reset:['time','location'] 원래대로 (여행자 누구나)
//                                            캡션은 올린 사람만
//   DELETE ?id=10&travelerId=1             → 삭제 (올린 사람만) + Blob 파일 정리
//
// 파일 자체는 브라우저가 Vercel Blob 에 직접 올리고(/api/photo-upload 가 토큰 발급),
// 이 API 는 주소와 촬영 정보만 DB 에 저장합니다.
const { withMember } = require('./_auth');
const { del } = require('@vercel/blob');
const { sql, ensureSchema, sendError } = require('./_db');
const { parsePhoto, parsePhotoPatch, toInt, mapPhotoRow } = require('./_photo-validate');
const { findBlobToken } = require('./_blob-token');
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

async function listPhotos() {
  const result = await sql`
    SELECT p.*,
      (SELECT COUNT(*) FROM photo_likes l WHERE l.photo_id = p.id) AS like_count,
      COALESCE(
        (SELECT ARRAY_AGG(l.traveler_id ORDER BY l.created_at) FROM photo_likes l WHERE l.photo_id = p.id),
        '{}'
      ) AS liked_by,
      (SELECT COUNT(*) FROM photo_comments c WHERE c.photo_id = p.id) AS comment_count
    FROM photos p
    ORDER BY p.taken_at ASC NULLS LAST, p.id ASC`;
  return result.rows.map(mapPhotoRow);
}

async function travelerExists(id) {
  const r = await sql`SELECT 1 FROM travelers WHERE id = ${id}`;
  return r.rowCount > 0;
}

async function createPhoto(v) {
  const camera = v.camera ? JSON.stringify(v.camera) : null;
  const result = await sql`
    INSERT INTO photos (
      uploader_id, media_type, url, thumb_url, width, height, duration_sec,
      caption, day, taken_at, taken_at_source, lat, lng, place_name, location_source,
      original_taken_at, original_taken_at_source, original_lat, original_lng, camera
    ) VALUES (
      ${v.uploaderId}, ${v.mediaType}, ${v.url}, ${v.thumbUrl}, ${v.width}, ${v.height}, ${v.durationSec},
      ${v.caption}, ${v.day}, ${v.takenAt}, ${v.takenAtSource}, ${v.lat}, ${v.lng}, ${v.placeName}, ${v.locationSource},
      ${v.originalTakenAt}, ${v.originalTakenAtSource}, ${v.originalLat}, ${v.originalLng}, ${camera}::jsonb
    )
    RETURNING *`;
  return mapPhotoRow(result.rows[0]);
}

/**
 * 사진 한 장을 찾아 요청자에게 권한이 있는지 확인. 문제가 있으면 { status, error }.
 * ownerOnly=false 면 등록된 여행자 누구나 통과하고, isOwner 로 본인 여부를 알려 줍니다.
 */
async function findOwnedPhoto(req, travelerIdRaw, ownerOnly = true) {
  const id = toInt(req.query.id);
  const travelerId = toInt(travelerIdRaw !== undefined ? travelerIdRaw : req.query.travelerId);
  if (!Number.isInteger(id) || !Number.isInteger(travelerId)) {
    return { status: 400, error: '사진 id와 여행자 id가 필요합니다.' };
  }
  const result = await sql`SELECT * FROM photos WHERE id = ${id}`;
  if (result.rowCount === 0) return { status: 404, error: '해당 사진을 찾을 수 없어요.' };
  const row = result.rows[0];
  const isOwner = PhotoCore.canModify({ uploaderId: row.uploader_id }, travelerId);
  if (!isOwner) {
    if (ownerOnly) return { status: 403, error: '본인이 올린 사진만 바꿀 수 있어요.' };
    if (!(await travelerExists(travelerId))) return { status: 403, error: '등록된 여행자만 고칠 수 있어요.' };
  }
  return { row, travelerId, isOwner };
}

async function handler(req, res) {
  try {
    await ensureSchema();

    if (req.method === 'GET') {
      const [photos, travelers] = await Promise.all([
        listPhotos(),
        sql`SELECT id, name FROM travelers ORDER BY id ASC`,
      ]);
      return res.status(200).json({
        photos,
        travelers: travelers.rows.map((r) => ({ id: r.id, name: r.name })),
      });
    }

    if (req.method === 'POST') {
      const parsed = parsePhoto(readBody(req));
      if (parsed.error) return res.status(400).json({ error: parsed.error });
      if (!(await travelerExists(parsed.value.uploaderId))) {
        return res.status(400).json({ error: '등록되지 않은 여행자예요. 여행자 목록을 확인해 주세요.' });
      }
      return res.status(201).json(await createPhoto(parsed.value));
    }

    if (req.method === 'PATCH') {
      const body = readBody(req);
      const found = await findOwnedPhoto(req, body.travelerId, false);
      if (found.error) return res.status(found.status).json({ error: found.error });
      const parsed = parsePhotoPatch(body, mapPhotoRow(found.row), undefined, { isOwner: found.isOwner });
      if (parsed.error) return res.status(parsed.status || 400).json({ error: parsed.error });
      const v = parsed.value;
      const result = await sql`
        UPDATE photos SET
          caption = ${v.caption}, day = ${v.day},
          taken_at = ${v.takenAt}, taken_at_source = ${v.takenAtSource},
          lat = ${v.lat}, lng = ${v.lng}, place_name = ${v.placeName}, location_source = ${v.locationSource},
          updated_at = now()
        WHERE id = ${found.row.id}
        RETURNING *`;
      return res.status(200).json(mapPhotoRow(result.rows[0]));
    }

    if (req.method === 'DELETE') {
      const found = await findOwnedPhoto(req);
      if (found.error) return res.status(found.status).json({ error: found.error });
      await sql`DELETE FROM photos WHERE id = ${found.row.id}`;
      // 파일 정리는 실패해도 앨범에서는 이미 사라졌으니 오류로 돌려주지 않습니다.
      try {
        await del([found.row.url, found.row.thumb_url].filter(Boolean), { token: findBlobToken(process.env) || undefined });
      } catch (err) {
        console.error('Blob 파일 삭제 실패', err);
      }
      return res.status(200).json({ ok: true });
    }

    res.setHeader('Allow', 'GET, POST, PATCH, DELETE');
    return res.status(405).json({ error: 'GET, POST, PATCH, DELETE만 지원합니다.' });
  } catch (err) {
    return sendError(res, err);
  }
}

// 로그인이 켜져 있으면 여행 참여자만, travelerId 는 로그인한 사람으로 (api/_auth.js)
module.exports = withMember(handler);
module.exports.findOwnedPhoto = findOwnedPhoto;
module.exports.readBody = readBody;
