// /api/travelers
//   POST   { name }        → 여행자 추가
//   DELETE ?id=123         → 여행자 삭제. 지출 기록(결제자·나눠 낸 사람)에 들어 있으면 409 로 막아요
//                            (빼면 다른 사람들의 정산 금액이 달라지기 때문)
const { withMember, isAdmin } = require('./_auth');
const { sql, ensureSchema, sendError } = require('./_db');

// req.body 가 문자열로 올 수도, 이미 파싱돼 올 수도 있어 안전하게 처리합니다.
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

async function handler(req, res) {
  try {
    await ensureSchema();

    // 로그인이 켜져 있으면 사람 추가·빼기는 여행 관리자만
    if ((req.method === 'POST' || req.method === 'DELETE') && !isAdmin(req)) {
      return res.status(403).json({ error: '사람 추가·빼기는 여행 관리자만 할 수 있어요.', code: 'admin_only' });
    }

    if (req.method === 'POST') {
      const { name } = readBody(req);
      const clean = (name || '').toString().trim();
      if (!clean) return res.status(400).json({ error: '이름을 입력해 주세요.' });
      if (clean.length > 40) {
        return res.status(400).json({ error: '이름은 40자 이하로 입력해 주세요.' });
      }
      const result = await sql`
        INSERT INTO travelers (name, trip_id) VALUES (${clean}, ${req.tripId})
        RETURNING id, name`;
      return res.status(201).json(result.rows[0]);
    }

    if (req.method === 'DELETE') {
      const id = parseInt(req.query.id, 10);
      if (!Number.isInteger(id)) {
        return res.status(400).json({ error: '삭제할 여행자 id가 필요합니다.' });
      }
      const target = await sql`SELECT user_id, role FROM travelers WHERE id = ${id} AND trip_id = ${req.tripId}`;
      if (!target.rows.length) return res.status(404).json({ error: '이 여행에 없는 사람이에요.' });
      if (target.rows[0].role === 'admin' && target.rows[0].user_id) {
        return res.status(409).json({ error: '관리자는 뺄 수 없어요.' });
      }
      const used = await sql`
        SELECT
          (SELECT COUNT(*) FROM expenses WHERE payer_id = ${id}) AS paid,
          (SELECT COUNT(*) FROM expense_splits WHERE traveler_id = ${id}) AS shared`;
      const paid = Number(used.rows[0].paid);
      const shared = Number(used.rows[0].shared);
      if (paid + shared > 0) {
        return res.status(409).json({
          error: `지출 기록에 들어 있어서 뺄 수 없어요 (결제 ${paid}건 · 나눠 냄 ${shared}건). 먼저 그 기록에서 빼거나 기록을 지워 주세요.`,
          paid,
          shared,
        });
      }
      await sql`DELETE FROM travelers WHERE id = ${id} AND trip_id = ${req.tripId}`;
      return res.status(200).json({ ok: true });
    }

    res.setHeader('Allow', 'POST, DELETE');
    return res.status(405).json({ error: 'POST 또는 DELETE만 지원합니다.' });
  } catch (err) {
    return sendError(res, err);
  }
}

// 로그인이 켜져 있으면 여행 참여자만, travelerId 는 로그인한 사람으로 (api/_auth.js)
module.exports = withMember(handler);
