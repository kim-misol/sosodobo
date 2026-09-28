// POST /api/photo-upload
// 브라우저가 Vercel Blob 에 파일을 "직접" 올릴 수 있도록 짧은 수명의 업로드 토큰을 발급합니다.
// (서버리스 함수는 요청 본문 크기 제한이 있어 사진·영상을 서버로 통과시키지 않습니다.)
//
// 저장소 연결 방식에 따라 두 가지로 동작합니다.
//  - token: BLOB_READ_WRITE_TOKEN 이 있으면 클라이언트 토큰 발급 (handleUpload ↔ 브라우저 upload)
//  - oidc : 토큰 없이 BLOB_STORE_ID 만 있으면 OIDC 로 서명한 업로드 주소 발급 (handleUploadPresigned ↔ uploadPresigned)
const { handleUpload, handleUploadPresigned } = require('@vercel/blob/client');
const { issueSignedToken } = require('@vercel/blob');
const { uploadTokenOptions, presignedUploadOptions } = require('./_photo-validate');
const { findBlobToken, blobEnvReport, blobUploadMode } = require('./_blob-token');

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
    const mode = blobUploadMode(process.env);
    if (mode) return res.status(200).json({ ready: true, mode });
    const report = blobEnvReport(process.env);
    let hint = 'Vercel 프로젝트에 Blob 저장소가 연결되지 않았어요. 저장소를 Production 환경에 연결한 뒤 재배포해 주세요.';
    if (report.names.some((n) => /_READ_WRITE_TOKEN$/.test(n))) {
      hint = 'Blob 토큰 환경변수는 있지만 값이 비어 있거나 올바르지 않아요(vercel_blob_rw_ 로 시작해야 해요). 값을 확인한 뒤 재배포해 주세요.';
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
    const body = readBody(req);
    if (body.type === 'blob.generate-presigned-url') {
      const token = findBlobToken(process.env) || undefined; // 없으면 SDK 가 OIDC + BLOB_STORE_ID 사용
      const result = await handleUploadPresigned({
        request: req,
        body,
        getSignedToken: async (pathname) => {
          const { signed, urlOptions } = presignedUploadOptions(pathname);
          return { token: await issueSignedToken({ ...signed, token }), urlOptions };
        },
      });
      return res.status(200).json(result);
    }
    const result = await handleUpload({
      token: findBlobToken(process.env) || undefined,
      request: req,
      body,
      onBeforeGenerateToken: async (pathname) => uploadTokenOptions(pathname),
    });
    return res.status(200).json(result);
  } catch (err) {
    console.error(err);
    const noToken = /BLOB_READ_WRITE_TOKEN|No token found|No blob credentials|x-vercel-oidc-token/i.test(String(err && err.message));
    return res.status(400).json({
      error: noToken
        ? '사진 저장소가 아직 연결되지 않았어요. Vercel 프로젝트에 Blob 저장소를 연결했는지 확인해 주세요.'
        : (err && err.message) || '업로드 준비에 실패했어요.',
    });
  }
};
