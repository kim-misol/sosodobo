// POST /api/photo-upload
// 브라우저가 Vercel Blob 에 파일을 "직접" 올릴 수 있도록 짧은 수명의 업로드 토큰을 발급합니다.
// (서버리스 함수는 요청 본문 크기 제한이 있어 사진·영상을 서버로 통과시키지 않습니다.)
//
// Vercel 프로젝트에 Blob 저장소를 연결하면 BLOB_READ_WRITE_TOKEN 환경변수가 자동으로 들어옵니다.
const { handleUpload } = require('@vercel/blob/client');
const { uploadTokenOptions } = require('./_photo-validate');

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
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'POST만 지원합니다.' });
  }
  try {
    const result = await handleUpload({
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
