const test = require('node:test');
const assert = require('node:assert/strict');

const { findBlobToken, blobEnvReport, blobUploadMode } = require('../api/_blob-token.js');

test('findBlobToken prefers BLOB_READ_WRITE_TOKEN', () => {
  assert.equal(findBlobToken({ BLOB_READ_WRITE_TOKEN: 'vercel_blob_rw_a_b' }), 'vercel_blob_rw_a_b');
});

test('findBlobToken finds a token stored under a custom prefix', () => {
  const env = { PHOTOS_READ_WRITE_TOKEN: 'vercel_blob_rw_x_y', OTHER: 'z' };
  assert.equal(findBlobToken(env), 'vercel_blob_rw_x_y');
});

test('findBlobToken ignores non-Blob values and returns null when missing', () => {
  assert.equal(findBlobToken({ SOME_READ_WRITE_TOKEN: 'not-a-blob-token' }), null);
  assert.equal(findBlobToken({}), null);
});

test('blobEnvReport lists only variable names, never values', () => {
  const r = blobEnvReport({
    BLOB_STORE_ID: 'store_123', PHOTOS_READ_WRITE_TOKEN: 'vercel_blob_rw_secret', POSTGRES_URL: 'postgres://x',
  });
  assert.deepEqual(r.names, ['BLOB_STORE_ID', 'PHOTOS_READ_WRITE_TOKEN']);
  assert.equal(r.hasToken, true);
  assert.equal(r.hasStoreId, true);
  assert.ok(!JSON.stringify(r).includes('secret'));
  assert.ok(!JSON.stringify(r).includes('store_123'));
});

test('GET /api/photo-upload explains an empty or invalid token variable', async () => {
  const { call } = require('./helpers/fake-api.js');
  const handlerPath = require.resolve('../api/photo-upload.js');
  const saved = process.env.BLOB_READ_WRITE_TOKEN;
  try {
    process.env.BLOB_READ_WRITE_TOKEN = '';
    delete require.cache[handlerPath];
    const res = await call(require(handlerPath), { method: 'GET' });
    assert.equal(res.body.ready, false);
    assert.match(res.body.message, /비어 있거나 올바르지 않아요/);
    assert.deepEqual(res.body.blobEnvNames, ['BLOB_READ_WRITE_TOKEN']);
  } finally {
    if (saved === undefined) delete process.env.BLOB_READ_WRITE_TOKEN;
    else process.env.BLOB_READ_WRITE_TOKEN = saved;
  }
});

test('blobUploadMode: 토큰이 있으면 token, 저장소 ID 만 있으면 oidc, 둘 다 없으면 null', () => {
  assert.equal(blobUploadMode({ BLOB_READ_WRITE_TOKEN: 'vercel_blob_rw_a_b', BLOB_STORE_ID: 'store_1' }), 'token');
  assert.equal(blobUploadMode({ BLOB_STORE_ID: 'store_1' }), 'oidc');
  assert.equal(blobUploadMode({ BLOB_STORE_ID: '  ' }), null);
  assert.equal(blobUploadMode({}), null);
});

test('GET /api/photo-upload: 토큰 없이 BLOB_STORE_ID 만 있어도(OIDC) 올릴 수 있다고 알려준다', async () => {
  const { call } = require('./helpers/fake-api.js');
  const handlerPath = require.resolve('../api/photo-upload.js');
  const savedToken = process.env.BLOB_READ_WRITE_TOKEN;
  const savedStore = process.env.BLOB_STORE_ID;
  try {
    delete process.env.BLOB_READ_WRITE_TOKEN;
    process.env.BLOB_STORE_ID = 'store_test';
    delete require.cache[handlerPath];
    const res = await call(require(handlerPath), { method: 'GET' });
    assert.deepEqual(res.body, { ready: true, mode: 'oidc' });
  } finally {
    if (savedToken === undefined) delete process.env.BLOB_READ_WRITE_TOKEN;
    else process.env.BLOB_READ_WRITE_TOKEN = savedToken;
    if (savedStore === undefined) delete process.env.BLOB_STORE_ID;
    else process.env.BLOB_STORE_ID = savedStore;
  }
});
