// /api/expenses
//   POST   { description, amount, payerId, participantIds: [] }  → 지출 추가
//   DELETE ?id=123                                               → 지출 삭제
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
      const body = readBody(req);
      const description = (body.description || '').toString().trim();
      const amount = Math.round(Number(body.amount));
      const payerId = parseInt(body.payerId, 10);
      const participantIds = Array.isArray(body.participantIds)
        ? [...new Set(body.participantIds.map((n) => parseInt(n, 10)).filter(Number.isInteger))]
        : [];

      if (!description) return res.status(400).json({ error: '지출 내용을 입력해 주세요.' });
      if (!Number.isFinite(amount) || amount <= 0) {
        return res.status(400).json({ error: '금액을 올바르게 입력해 주세요.' });
      }
      if (!Number.isInteger(payerId)) {
        return res.status(400).json({ error: '결제자를 선택해 주세요.' });
      }
      if (participantIds.length === 0) {
        return res.status(400).json({ error: '정산에 참여할 여행자를 한 명 이상 선택해 주세요.' });
      }

      const inserted = await sql`
        INSERT INTO expenses (description, amount, payer_id)
        VALUES (${description}, ${amount}, ${payerId})
        RETURNING id`;
      const expenseId = inserted.rows[0].id;

      // 참여자 분담 행을 한 번에 삽입합니다.
      for (const tid of participantIds) {
        await sql`
          INSERT INTO expense_splits (expense_id, traveler_id)
          VALUES (${expenseId}, ${tid})
          ON CONFLICT DO NOTHING`;
      }

      return res.status(201).json({ id: expenseId });
    }

    if (req.method === 'DELETE') {
      const id = parseInt(req.query.id, 10);
      if (!Number.isInteger(id)) {
        return res.status(400).json({ error: '삭제할 지출 id가 필요합니다.' });
      }
      await sql`DELETE FROM expenses WHERE id = ${id}`;
      return res.status(200).json({ ok: true });
    }

    res.setHeader('Allow', 'POST, DELETE');
    return res.status(405).json({ error: 'POST 또는 DELETE만 지원합니다.' });
  } catch (err) {
    return sendError(res, err);
  }
};
