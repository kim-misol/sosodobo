# 벤더 파일 (빌드 도구 없이 쓰려고 미리 받아 둔 브라우저용 번들)

| 파일 | 원본 | 버전 | 라이선스 |
|---|---|---|---|
| exifr.lite.umd.js | exifr (dist/lite.umd.js) — 사진 EXIF 읽기 | 7.1.3 | MIT (c) 2020 Mike Kovařík |
| fix-webm-duration.js | fix-webm-duration — WebM 녹화본에 길이 정보 채우기 (전역 ysFixWebmDuration) | 1.0.6 | MIT (c) 2018 Yury Sitnikov |
| vercel-blob-client.js | @vercel/blob/client 의 upload()·uploadPresigned() 를 esbuild 로 번들 (전역 VercelBlobClient) | 2.8.0 | Apache-2.0 (Vercel) |

다시 만들기: `echo "export { upload, uploadPresigned } from '@vercel/blob/client';" > entry.js && npx esbuild entry.js --bundle --platform=browser --format=iife --global-name=VercelBlobClient --minify --target=es2019 --outfile=assets/vendor/vercel-blob-client.js`
