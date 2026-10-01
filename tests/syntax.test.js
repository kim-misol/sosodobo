// 브라우저에서 바로 읽는 스크립트(assets/*.js)는 테스트가 require 하지 않는 파일도 많아서,
// 문법 오류가 있어도 다른 테스트가 통과할 수 있어요. 모두 한 번씩 컴파일해 봐요.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const dir = path.join(__dirname, '..', 'assets');
const files = fs.readdirSync(dir).filter((f) => f.endsWith('.js'));

test('assets/*.js 는 모두 문법 오류 없이 읽힌다', () => {
  assert.ok(files.length > 10);
  for (const f of files) {
    const code = fs.readFileSync(path.join(dir, f), 'utf8');
    assert.doesNotThrow(() => new vm.Script(code, { filename: f }), f);
  }
});
