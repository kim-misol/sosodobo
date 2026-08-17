// GET /api/state
// 여행자 + 지출(참여자 목록 포함) 전체를 한 번에 돌려줍니다.
// 정산 계산 자체는 프론트엔드의 settle-core.js(테스트된 순수 함수)에서 합니다.
const { sql, ensureSchema, sendError } = require('./_db');

module.exports = async function handler(req, res) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json({ error: 'GET만 지원합니다.' });
  }
  try {
    await ensureSchema();

    const travelersResult = await sql`
      SELECT id, name FROM travelers ORDER BY id ASC`;

    const expensesResult = await sql`
      SELECT e.id, e.description, e.amount, e.payer_id, e.created_at,
             COALESCE(
               ARRAY_AGG(s.traveler_id) FILTER (WHERE s.traveler_id IS NOT NULL),
               '{}'
             ) AS participant_ids
      FROM expenses e
      LEFT JOIN expense_splits s ON s.expense_id = e.id
      GROUP BY e.id
      ORDER BY e.created_at ASC, e.id ASC`;

    const expenses = expensesResult.rows.map((r) => ({
      id: r.id,
      description: r.description,
      amount: Number(r.amount),
      payerId: r.payer_id,
      participantIds: (r.participant_ids || []).map(Number),
      createdAt: r.created_at,
    }));

    return res.status(200).json({
      travelers: travelersResult.rows.map((r) => ({ id: r.id, name: r.name })),
      expenses,
    });
  } catch (err) {
    return sendError(res, err);
  }
};
