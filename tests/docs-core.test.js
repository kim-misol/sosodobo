const test = require('node:test');
const assert = require('node:assert/strict');
const D = require('../assets/docs-core.js');

const B = 'https://abc.public.blob.vercel-storage.com/trips/5/docs/';
const ctx = { tripId: 5, travelerIds: [2, 3, 4] };
const base = { kind: 'flight', title: '김포 → 제주 대한항공', files: [{ url: B + '1-ab.pdf', name: 'e-ticket.pdf', contentType: 'application/pdf', size: 120000 }] };

test('validateDoc: 기본 입력 · 비어 있으면 모두 · 여행 기간 밖 날짜도 됨', () => {
  const ok = D.validateDoc(Object.assign({}, base, { docDate: '2026-11-13', memo: ' 예약번호 ABC123 ' }), ctx);
  assert.deepEqual(ok.value, {
    kind: 'flight', title: '김포 → 제주 대한항공', memo: '예약번호 ABC123', docDate: '2026-11-13', travelerIds: [],
    files: [{ url: B + '1-ab.pdf', name: 'e-ticket.pdf', contentType: 'application/pdf', size: 120000, width: null, height: null }],
  });
  assert.deepEqual(D.validateDoc(Object.assign({}, base, { travelerIds: ['2', 2, 4] }), ctx).value.travelerIds, [2, 4]);
});

test('validateDoc: 종류 · 제목 · 날짜 · 사람 · 파일 검사', () => {
  assert.match(D.validateDoc(Object.assign({}, base, { kind: 'boat' }), ctx).error, /종류/);
  assert.match(D.validateDoc(Object.assign({}, base, { title: ' ' }), ctx).error, /제목/);
  assert.match(D.validateDoc(Object.assign({}, base, { docDate: '2026-02-30' }), ctx).error, /날짜/);
  assert.match(D.validateDoc(Object.assign({}, base, { travelerIds: [99] }), ctx).error, /이 여행에 없는/);
  assert.match(D.validateDoc(Object.assign({}, base, { files: [] }), ctx).error, /하나 이상/);
  assert.match(D.validateDoc(Object.assign({}, base, { files: [{ url: B.replace('/trips/5/', '/trips/6/') + 'x.pdf' }] }), ctx).error, /주소/);
  const six = Array.from({ length: 6 }, (_, i) => ({ url: B + i + '.jpg' }));
  assert.match(D.validateDoc(Object.assign({}, base, { files: six }), ctx).error, /5개/);
  assert.deepEqual(D.validateDoc({ memo: 'x' }, ctx, { partial: true }).value, { memo: 'x' });
});

test('isDocUrl · docPath · fileProblem · dayOfDate', () => {
  assert.equal(D.isDocUrl(B + '1-ab.jpg', 5), true);
  assert.equal(D.isDocUrl(B + '1-ab.jpg', 6), false);
  assert.equal(D.isDocUrl('https://evil.example.com/trips/5/docs/1.jpg', 5), false);
  assert.equal(D.docPath(5, 1700000000000, 'a!b', 'JPEG'), 'trips/5/docs/1700000000000-ab.jpg');
  assert.equal(D.docPath(5, 1, 'x', 'exe'), 'trips/5/docs/1-x.bin');
  assert.equal(D.fileProblem({ type: 'application/pdf', name: 'a.pdf', size: 1000 }), null);
  assert.equal(D.fileProblem({ type: 'image/heic', name: 'a.heic', size: 1 }), null);
  assert.match(D.fileProblem({ type: 'application/zip', name: 'a.zip', size: 1 }), /PDF 만/);
  assert.match(D.fileProblem({ type: 'application/pdf', name: 'big.pdf', size: 16 * 1024 * 1024 }), /15MB/);
  assert.equal(D.dayOfDate('2026-11-14', 3, '2026-11-15'), 2);
  assert.equal(D.dayOfDate('2026-11-14', 3, '2026-11-13'), null);
});

test('sortDocs · canModifyDoc', () => {
  const docs = [{ id: 3, docDate: null }, { id: 2, docDate: '2026-11-15' }, { id: 1, docDate: '2026-11-14' }, { id: 4, docDate: '2026-11-14' }];
  assert.deepEqual(D.sortDocs(docs).map((d) => d.id), [1, 4, 2, 3]);
  assert.equal(D.canModifyDoc({ uploaderId: 2 }, { travelerId: 2, role: 'member' }), true);
  assert.equal(D.canModifyDoc({ uploaderId: 2 }, { travelerId: 3, role: 'member' }), false);
  assert.equal(D.canModifyDoc({ uploaderId: 2 }, { travelerId: 3, role: 'admin' }), true);
  assert.equal(D.canModifyDoc({ uploaderId: 2 }, null), true, '로그인이 꺼져 있으면 누구나');
});
