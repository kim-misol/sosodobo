const test = require('node:test');
const assert = require('node:assert/strict');

const {
  wrapIndex,
  nextIndex,
  prevIndex,
  indexFromScroll,
  scrollLeftForIndex,
} = require('../assets/carousel.js');

test('wrapIndex keeps an in-range index unchanged', () => {
  assert.equal(wrapIndex(2, 5), 2);
  assert.equal(wrapIndex(0, 5), 0);
});

test('wrapIndex wraps an index past the end back to 0', () => {
  assert.equal(wrapIndex(5, 5), 0);
  assert.equal(wrapIndex(6, 5), 1);
});

test('wrapIndex wraps a negative index to the last slide', () => {
  assert.equal(wrapIndex(-1, 5), 4);
  assert.equal(wrapIndex(-2, 5), 3);
});

test('wrapIndex throws for a non-positive length', () => {
  assert.throws(() => wrapIndex(0, 0));
});

test('nextIndex advances by one and wraps at the end', () => {
  assert.equal(nextIndex(0, 11), 1);
  assert.equal(nextIndex(9, 11), 10);
  assert.equal(nextIndex(10, 11), 0);
});

test('prevIndex goes back by one and wraps at the start', () => {
  assert.equal(prevIndex(1, 11), 0);
  assert.equal(prevIndex(0, 11), 10);
});

test('scrollLeftForIndex is the index times the slide width', () => {
  assert.equal(scrollLeftForIndex(0, 320), 0);
  assert.equal(scrollLeftForIndex(3, 320), 960);
});

test('indexFromScroll rounds to the nearest slide', () => {
  assert.equal(indexFromScroll(0, 320, 11), 0);
  assert.equal(indexFromScroll(150, 320, 11), 0);
  assert.equal(indexFromScroll(170, 320, 11), 1);
  assert.equal(indexFromScroll(960, 320, 11), 3);
});

test('indexFromScroll clamps to the valid slide range', () => {
  assert.equal(indexFromScroll(-50, 320, 11), 0);
  assert.equal(indexFromScroll(100000, 320, 11), 10);
});

test('indexFromScroll returns 0 when slideWidth is 0 (avoids NaN/divide-by-zero)', () => {
  assert.equal(indexFromScroll(500, 0, 11), 0);
});

// Day 2 (말발굽길) carousel has 13 slides, a different length than the Day 3
// (동대만길) carousel's 11. These pin the 13-slide boundaries explicitly so a
// future change can't silently break the "last slide" / "wrap to first slide"
// case for this carousel.
test('nextIndex wraps a 13-slide carousel from the last slide back to the first', () => {
  assert.equal(nextIndex(11, 13), 12);
  assert.equal(nextIndex(12, 13), 0);
});

test('prevIndex wraps a 13-slide carousel from the first slide back to the last', () => {
  assert.equal(prevIndex(0, 13), 12);
});

test('indexFromScroll clamps to the last of 13 slides', () => {
  assert.equal(indexFromScroll(100000, 320, 13), 12);
});

test('a call with one carousel length does not affect a call with a different length', () => {
  // Interleave calls for the Day 3 (11-slide) and Day 2 (13-slide) carousels to
  // confirm the pure functions carry no shared/global state between them.
  assert.equal(nextIndex(10, 11), 0);
  assert.equal(nextIndex(12, 13), 0);
  assert.equal(nextIndex(10, 11), 0);
  assert.equal(nextIndex(12, 13), 0);
});
