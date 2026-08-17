// /api/travelers
//   POST   { name }        → 여행자 추가
//   DELETE ?id=123         → 여행자 삭제 (관련 지출 분담/결제자 정보도 정리됨)
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
      await sql`DELETE FROM travelers WHERE id = ${id}`;
      return res.status(200).json({ ok: true });
    }

    res.setHeader('Allow', 'POST, DELETE');
    return res.status(405).json({ error: 'POST 또는 DELETE만 지원합니다.' });
  } catch (err) {
    return sendError(res, err);
  }
};
