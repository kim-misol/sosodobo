// /api/travelers
//   POST   { name }        → 여행자 추가
//   DELETE ?id=123         → 여행자 삭제. 지출 기록(결제자·나눠 낸 사람)에 들어 있으면 409 로 막아요
//                            (빼면 다른 사람들의 정산 금액이 달라지기 때문)
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

module.exports = async function handler(req, res) {
  try {
    await ensureSchema();

    if (req.method === 'POST') {
      const { name } = readBody(req);
      const clean = (name || '').toString().trim();
      if (!clean) return res.status(400).json({ error: '이름을 입력해 주세요.' });
      if (clean.length > 40) {
        return res.status(400).json({ error: '이름은 40자 이하로 입력해 주세요.' });
      }
      const result = await sql`
        INSERT INTO travelers (name) VALUES (${clean})
        RETURNING id, name`;
      return res.status(201).json(result.rows[0]);
    }

    if (req.method === 'DELETE') {
      const id = parseInt(req.query.id, 10);
      if (!Number.isInteger(id)) {
        return res.status(400).json({ error: '삭제할 여행자 id가 필요합니다.' });
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
      await sql`DELETE FROM travelers WHERE id = ${id}`;
      return res.status(200).json({ ok: true });
    }

    res.setHeader('Allow', 'POST, DELETE');
    return res.status(405).json({ error: 'POST 또는 DELETE만 지원합니다.' });
  } catch (err) {
    return sendError(res, err);
  }
};
