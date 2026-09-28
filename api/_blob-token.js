// Vercel Blob 읽기·쓰기 토큰 찾기.
// 저장소를 프로젝트에 연결할 때 접두어(Custom Prefix)를 바꾸면 BLOB_READ_WRITE_TOKEN 이 아닌
// <접두어>_READ_WRITE_TOKEN 으로 들어오므로, 값이 vercel_blob_rw_ 로 시작하는 변수를 찾아 씁니다.
const TOKEN_PREFIX = 'vercel_blob_rw_';

function findBlobToken(env) {
  const e = env || {};
  if (typeof e.BLOB_READ_WRITE_TOKEN === 'string' && e.BLOB_READ_WRITE_TOKEN.startsWith(TOKEN_PREFIX)) {
    return e.BLOB_READ_WRITE_TOKEN;
  }
  const key = Object.keys(e)
    .sort()
    .find((k) => /_READ_WRITE_TOKEN$/.test(k) && typeof e[k] === 'string' && e[k].startsWith(TOKEN_PREFIX));
  return key ? e[key] : null;
}

/** 진단용: Blob 관련 환경변수 "이름"만 (값은 절대 포함하지 않음). */
function blobEnvReport(env) {
  const e = env || {};
  const names = Object.keys(e).filter((k) => /BLOB|READ_WRITE_TOKEN/i.test(k)).sort();
  return { names, hasToken: !!findBlobToken(e), hasStoreId: !!e.BLOB_STORE_ID };
}

/**
 * 업로드 방식. 'token' = 읽기·쓰기 토큰(handleUpload), 'oidc' = 토큰 없이 저장소 ID + OIDC(handleUploadPresigned).
 * 요즘 Vercel 은 저장소를 연결하면 토큰 대신 BLOB_STORE_ID 만 넣어 주고, OIDC 토큰은 요청마다 헤더로 들어옵니다.
 */
function blobUploadMode(env) {
  const e = env || {};
  if (findBlobToken(e)) return 'token';
  if (typeof e.BLOB_STORE_ID === 'string' && e.BLOB_STORE_ID.trim()) return 'oidc';
  return null;
}

module.exports = { findBlobToken, blobEnvReport, blobUploadMode };
