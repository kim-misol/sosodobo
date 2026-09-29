// 로컬 리허설·개발 전용: @vercel/postgres 의 sql`...` 과 같은 모양으로 node-postgres 를 씁니다.
// (LOCAL_PG_URL 이 있을 때만 _db.js 가 불러옴. 배포 환경에서는 쓰이지 않아요.)
module.exports = function localSql(url) {
  const { Pool } = require('pg');
  const pool = new Pool({ connectionString: url });
  return function sql(strings, ...values) {
    const text = strings.reduce((acc, part, i) => acc + part + (i < values.length ? '$' + (i + 1) : ''), '');
    return pool.query(text, values).then((r) => ({ rows: r.rows, rowCount: r.rowCount }));
  };
};
