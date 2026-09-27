// POST /api/photo-upload
// 브라우저가 Vercel Blob 에 파일을 "직접" 올릴 수 있도록 짧은 수명의 업로드 토큰을 발급합니다.
// (서버리스 함수는 요청 본문 크기 제한이 있어 사진·영상을 서버로 통과시키지 않습니다.)
//
// Vercel 프로젝트에 Blob 저장소를 연결하면 BLOB_READ_WRITE_TOKEN 환경변수가 자동으로 들어옵니다.
const { handleUpload } = require('@vercel/blob/client');
const { uploadTokenOptions } = require('./_photo-validate');
const { findBlobToken, blobEnvReport } = require('./_blob-token');

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
  // GET: 업로드할 수 있는 상태인지(Blob 저장소 연결 여부)만 알려줍니다. 토큰 값은 절대 내보내지 않아요.
  if (req.method === 'GET') {
    if (findBlobToken(process.env)) return res.status(200).json({ ready: true });
    const report = blobEnvReport(process.env);
    let hint = 'Vercel 프로젝트에 Blob 저장소가 연결되지 않았어요. 저장소를 Production 환경에 연결한 뒤 재배포해 주세요.';
    if (report.names.some((n) => /_READ_WRITE_TOKEN$/.test(n))) {
      hint = 'Blob 토큰 환경변수는 있지만 값이 비어 있거나 올바르지 않아요(vercel_blob_rw_ 로 시작해야 해요). 값을 확인한 뒤 재배포해 주세요.';
    } else if (report.hasStoreId) {
      hint = '저장소는 연결됐지만 읽기·쓰기 토큰이 없어요(OIDC 방식). Blob 저장소 화면의 BLOB_READ_WRITE_TOKEN 값을 프로젝트 환경변수에 추가한 뒤 재배포해 주세요.';
    }
    return res.status(200).json({
      ready: false,
      message: hint,
      blobEnvNames: report.names, // 이름만 (값은 보내지 않음)
      vercelEnv: process.env.VERCEL_ENV || null,
    });
  }
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'GET, POST');
    return res.status(405).json({ error: 'GET, POST만 지원합니다.' });
  }
  try {
    const result = await handleUpload({
      token: findBlobToken(process.env) || undefined,
      request: req,
      body: readBody(req),
      onBeforeGenerateToken: async (pathname) => uploadTokenOptions(pathname),
    });
    return res.status(200).json(result);
  } catch (err) {
    console.error(err);
    const noToken = /BLOB_READ_WRITE_TOKEN|No token found/i.test(String(err && err.message));
    return res.status(400).json({
      error: noToken
        ? '사진 저장소가 아직 연결되지 않았어요. Vercel 프로젝트에 Blob 저장소를 연결했는지 확인해 주세요.'
        : (err && err.message) || '업로드 준비에 실패했어요.',
    });
  }
};
