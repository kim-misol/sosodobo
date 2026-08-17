// /api/notes  (준비물 메모)
//   POST   { content }        → 준비물 추가
//   PATCH  ?id=123 { content } → 준비물 내용 수정
//   DELETE ?id=123            → 준비물 삭제
const { sql, ensureSchema, sendError } = require('./_db');

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
      const { content } = readBody(req);
      const clean = (content || '').toString().trim();
      if (!clean) return res.status(400).json({ error: '준비물 내용을 입력해 주세요.' });
      if (clean.length > 200) {
        return res.status(400).json({ error: '준비물은 200자 이하로 입력해 주세요.' });
      }
      const result = await sql`
        INSERT INTO notes (content) VALUES (${clean})
        RETURNING id, content`;
      return res.status(201).json(result.rows[0]);
    }

    if (req.method === 'PATCH') {
      const id = parseInt(req.query.id, 10);
      if (!Number.isInteger(id)) {
        return res.status(400).json({ error: '수정할 준비물 id가 필요합니다.' });
      }
      const { content } = readBody(req);
      const clean = (content || '').toString().trim();
      if (!clean) return res.status(400).json({ error: '준비물 내용을 입력해 주세요.' });
      if (clean.length > 200) {
        return res.status(400).json({ error: '준비물은 200자 이하로 입력해 주세요.' });
      }
      const result = await sql`
        UPDATE notes SET content = ${clean} WHERE id = ${id}
        RETURNING id, content`;
      if (result.rowCount === 0) {
        return res.status(404).json({ error: '해당 준비물을 찾을 수 없어요.' });
      }
      return res.status(200).json(result.rows[0]);
    }

    if (req.method === 'DELETE') {
      const id = parseInt(req.query.id, 10);
      if (!Number.isInteger(id)) {
        return res.status(400).json({ error: '삭제할 준비물 id가 필요합니다.' });
      }
      await sql`DELETE FROM notes WHERE id = ${id}`;
      return res.status(200).json({ ok: true });
    }

    res.setHeader('Allow', 'POST, PATCH, DELETE');
    return res.status(405).json({ error: 'POST, PATCH, DELETE만 지원합니다.' });
  } catch (err) {
    return sendError(res, err);
  }
};
