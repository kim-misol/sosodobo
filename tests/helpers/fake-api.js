// 테스트용 가짜 DB·Blob·요청/응답 도구.
// 실제 Postgres 없이 API 핸들러의 검증·권한·응답 형태를 확인하기 위해 씁니다.
const path = require('node:path');

const DB_PATH = require.resolve(path.join(__dirname, '..', '..', 'api', '_db.js'));

/**
 * sql`...` 태그 함수를 흉내냅니다. 호출된 쿼리를 calls 에 쌓고,
 * responder(text, values) 가 돌려준 { rows } 를 결과로 씁니다.
 */
/** 여행을 따로 정하지 않은 테스트가 쓰는 기본 여행 (withMember 가 찾아 req.trip 에 둠). */
const DEFAULT_TRIP = {
  id: 1, title: '남해 바래길', summary: '함께 걷는 3일 코스', region: '남해', start_date: '2026-09-24', end_date: '2026-09-26',
  visibility: 'private', members_can_edit: true, cover_url: null, legacy_key: 'namhae', join_code: 'NAMHAE2026',
};

function isTripLookup(text) {
  return text.startsWith("SELECT value FROM app_meta WHERE key = 'legacy_trip_id'") ||
    (text.startsWith('SELECT id, title, summary, region, to_char(start_date') && text.includes('FROM trips WHERE id ='));
}

function createFakeSql(responder) {
  const calls = [];
  function sql(strings, ...values) {
    const text = strings.join('$').replace(/\s+/g, ' ').trim();
    calls.push({ text, values });
    let out = responder && responder(text, values);
    // 여행 찾기는 테스트가 따로 답하지 않으면 기본 여행으로
    if (isTripLookup(text) && !(out && out.rows && out.rows.length)) {
      out = text.includes('app_meta') ? { rows: [{ value: '1' }] } : { rows: [DEFAULT_TRIP] };
    }
    out = out || { rows: [] };
    const rows = out.rows || [];
    return Promise.resolve({ rows, rowCount: out.rowCount !== undefined ? out.rowCount : rows.length });
  }
  sql.calls = calls;
  return sql;
}

/** api/_db.js 를 가짜로 바꿔 끼우고, 핸들러 모듈을 새로 불러옵니다. */
function loadHandler(handlerFile, fakeSql, extraMocks) {
  const handlerPath = require.resolve(path.join(__dirname, '..', '..', 'api', handlerFile));
  delete require.cache[handlerPath];
  require.cache[DB_PATH] = {
    id: DB_PATH,
    filename: DB_PATH,
    loaded: true,
    exports: {
      sql: fakeSql,
      ensureSchema: async () => {},
      sendError: (res, err) => res.status(500).json({ error: err.message }),
      randomJoinCode: () => 'TESTCODE',
    },
  };
  for (const [request, exportsValue] of Object.entries(extraMocks || {})) {
    const resolved = require.resolve(request, { paths: [path.dirname(handlerPath)] });
    require.cache[resolved] = { id: resolved, filename: resolved, loaded: true, exports: exportsValue };
  }
  return require(handlerPath);
}

function mockReq({ method = 'GET', query = {}, body, headers = {} } = {}) {
  return { method, query, body, headers };
}

function mockRes() {
  const res = {
    statusCode: 200,
    body: undefined,
    headers: {},
    status(code) { this.statusCode = code; return this; },
    json(data) { this.body = data; return this; },
    setHeader(k, v) { this.headers[k] = v; },
    getHeader(k) { return this.headers[k]; },
    end() { this.ended = true; return this; },
  };
  return res;
}

async function call(handler, reqInit) {
  const res = mockRes();
  await handler(mockReq(reqInit), res);
  return res;
}

module.exports = { createFakeSql, loadHandler, call, DEFAULT_TRIP };
