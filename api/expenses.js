// /api/expenses
//   POST   { description, amount, payerId, participantIds: [] }        → 지출 추가
//   PATCH  ?id=123 { description, amount, payerId, participantIds: [] } → 지출 수정
//   DELETE ?id=123                                                     → 지출 삭제
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

// 지출 입력값을 정리·검증합니다. 문제가 있으면 { error }, 정상이면 { value } 를 돌려줍니다.
function parseExpense(body) {
  const description = (body.description || '').toString().trim();
  const amount = Math.round(Number(body.amount));
  const payerId = parseInt(body.payerId, 10);
  const participantIds = Array.isArray(body.participantIds)
    ? [...new Set(body.participantIds.map((n) => parseInt(n, 10)).filter(Number.isInteger))]
    : [];

  if (!description) return { error: '지출 내용을 입력해 주세요.' };
  if (!Number.isFinite(amount) || amount <= 0) {
    return { error: '금액을 올바르게 입력해 주세요.' };
  }
  if (!Number.isInteger(payerId)) {
    return { error: '결제자를 선택해 주세요.' };
  }
  if (participantIds.length === 0) {
    return { error: '정산에 참여할 여행자를 한 명 이상 선택해 주세요.' };
  }
  return { value: { description, amount, payerId, participantIds } };
}

// 참여자 분담 행을 채워 넣습니다.
async function insertSplits(expenseId, participantIds) {
  for (const tid of participantIds) {
    await sql`
      INSERT INTO expense_splits (expense_id, traveler_id)
      VALUES (${expenseId}, ${tid})
      ON CONFLICT DO NOTHING`;
  }
}

module.exports = async function handler(req, res) {
  try {
    await ensureSchema();

    if (req.method === 'POST') {
      const parsed = parseExpense(readBody(req));
      if (parsed.error) return res.status(400).json({ error: parsed.error });
      const { description, amount, payerId, participantIds } = parsed.value;

      const inserted = await sql`
        INSERT INTO expenses (description, amount, payer_id)
        VALUES (${description}, ${amount}, ${payerId})
        RETURNING id`;
      const expenseId = inserted.rows[0].id;
      await insertSplits(expenseId, participantIds);

      return res.status(201).json({ id: expenseId });
    }

    if (req.method === 'PATCH') {
      const id = parseInt(req.query.id, 10);
      if (!Number.isInteger(id)) {
        return res.status(400).json({ error: '수정할 지출 id가 필요합니다.' });
      }
      const parsed = parseExpense(readBody(req));
      if (parsed.error) return res.status(400).json({ error: parsed.error });
      const { description, amount, payerId, participantIds } = parsed.value;

      const updated = await sql`
        UPDATE expenses
        SET description = ${description}, amount = ${amount}, payer_id = ${payerId}
        WHERE id = ${id}
        RETURNING id`;
      if (updated.rowCount === 0) {
        return res.status(404).json({ error: '해당 지출을 찾을 수 없어요.' });
      }
      // 참여자 목록은 통째로 교체합니다.
      await sql`DELETE FROM expense_splits WHERE expense_id = ${id}`;
      await insertSplits(id, participantIds);

      return res.status(200).json({ id });
    }

    if (req.method === 'DELETE') {
      const id = parseInt(req.query.id, 10);
      if (!Number.isInteger(id)) {
        return res.status(400).json({ error: '삭제할 지출 id가 필요합니다.' });
      }
      await sql`DELETE FROM expenses WHERE id = ${id}`;
      return res.status(200).json({ ok: true });
    }

    res.setHeader('Allow', 'POST, PATCH, DELETE');
    return res.status(405).json({ error: 'POST, PATCH, DELETE만 지원합니다.' });
  } catch (err) {
    return sendError(res, err);
  }
};
