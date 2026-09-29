// GET /api/state
// 여행자 + 지출(참여자 목록 포함) 전체를 한 번에 돌려줍니다.
// 정산 계산 자체는 프론트엔드의 settle-core.js(테스트된 순수 함수)에서 합니다.
// ?trip= 여행의 것만 (withMember 가 req.tripId 로 정해 줌). 지출·준비물이 있어 참여자만 볼 수 있어요.
const { withMember } = require('./_auth');
const { sql, ensureSchema, sendError } = require('./_db');

async function handler(req, res) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json({ error: 'GET만 지원합니다.' });
  }
  try {
    await ensureSchema();

    const travelersResult = await sql`
      SELECT id, name, role, (user_id IS NOT NULL) AS has_account FROM travelers WHERE trip_id = ${req.tripId} ORDER BY id ASC`;

    const notesResult = await sql`
      SELECT id, content FROM notes WHERE trip_id = ${req.tripId} ORDER BY id ASC`;

    const expensesResult = await sql`
      SELECT e.id, e.description, e.amount, e.payer_id, e.created_at,
             (SELECT l.id FROM lodgings l WHERE l.expense_id = e.id LIMIT 1) AS lodging_id,
             COALESCE(
               ARRAY_AGG(s.traveler_id) FILTER (WHERE s.traveler_id IS NOT NULL),
               '{}'
             ) AS participant_ids
      FROM expenses e
      LEFT JOIN expense_splits s ON s.expense_id = e.id
      WHERE e.trip_id = ${req.tripId}
      GROUP BY e.id
      ORDER BY e.created_at ASC, e.id ASC`;

    const expenses = expensesResult.rows.map((r) => ({
      id: r.id,
      description: r.description,
      amount: Number(r.amount),
      payerId: r.payer_id,
      participantIds: (r.participant_ids || []).map(Number),
      createdAt: r.created_at,
      lodgingId: r.lodging_id || null, // 숙소에서 만든 지출 (정산 화면에서는 고치지 않음)
    }));

    return res.status(200).json({
      travelers: travelersResult.rows.map((r) => ({ id: r.id, name: r.name, role: r.role || 'member', hasAccount: !!r.has_account })),
      trip: req.trip,
      me: req.member ? { travelerId: req.member.travelerId, role: req.member.role } : null,
      expenses,
      notes: notesResult.rows.map((r) => ({ id: r.id, content: r.content })),
    });
  } catch (err) {
    return sendError(res, err);
  }
}

// 로그인이 켜져 있으면 여행 참여자만, travelerId 는 로그인한 사람으로 (api/_auth.js)
module.exports = withMember(handler);
