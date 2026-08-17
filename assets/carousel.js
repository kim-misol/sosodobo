/**
 * Lightweight, dependency-free carousel.
 *
 * The index/scroll math below is kept as small pure functions so it can be
 * unit tested without a DOM (see tests/carousel.test.js). initCarousel()
 * is a thin adapter that wires those pure functions up to real DOM events.
 */

/** Wrap `index` into the range [0, length). Throws if length <= 0. */
function wrapIndex(index, length) {
  if (!(length > 0)) {
    throw new RangeError('length must be a positive number');
  }
  return ((index % length) + length) % length;
}

/** Index of the next slide, wrapping past the last slide back to 0. */
function nextIndex(current, length) {
  return wrapIndex(current + 1, length);
}

/** Index of the previous slide, wrapping before the first slide to the last. */
function prevIndex(current, length) {
  return wrapIndex(current - 1, length);
}

/** The scrollLeft value that centers/aligns slide `index`. */
function scrollLeftForIndex(index, slideWidth) {
  return index * slideWidth;
}

/**
 * The nearest slide index for a given scrollLeft, clamped to a valid index.
 * Guards against slideWidth being 0 (e.g. before layout has happened) so it
 * never returns NaN.
 */
function indexFromScroll(scrollLeft, slideWidth, length) {
  if (!slideWidth) return 0;
  const raw = Math.round(scrollLeft / slideWidth);
  return Math.min(Math.max(raw, 0), length - 1);
}

/**
 * Wire up a `.carousel` element: previous/next buttons, dot indicators, and
 * keeping the active dot in sync while the user swipes/scrolls the track.
 * No-ops safely if expected child elements are missing.
 */
function initCarousel(root) {
  if (!root) return;
  const track = root.querySelector('.carousel-track');
  const slides = track ? Array.from(track.children) : [];
  const length = slides.length;
  if (!track || length === 0) return;

  const prevBtn = root.querySelector('.carousel-btn.prev');
  const nextBtn = root.querySelector('.carousel-btn.next');
  const dotsContainer = root.querySelector('.carousel-dots');
  const dots = dotsContainer ? Array.from(dotsContainer.children) : [];

  let current = 0;

  function setActiveDot(index) {
    dots.forEach((dot, i) => {
      dot.classList.toggle('active', i === index);
      dot.setAttribute('aria-current', i === index ? 'true' : 'false');
    });
  }

  function goTo(index, { smooth = true } = {}) {
    current = wrapIndex(index, length);
    const slideWidth = track.clientWidth;
    track.scrollTo({
      left: scrollLeftForIndex(current, slideWidth),
      behavior: smooth ? 'smooth' : 'auto',
    });
    setActiveDot(current);
  }

  if (prevBtn) prevBtn.addEventListener('click', () => goTo(prevIndex(current, length)));
  if (nextBtn) nextBtn.addEventListener('click', () => goTo(nextIndex(current, length)));

  dots.forEach((dot, i) => {
    dot.addEventListener('click', () => goTo(i));
  });

  let scrollTimeout = null;
  track.addEventListener('scroll', () => {
    // Debounce so we only settle on an index once scrolling/swiping stops.
    if (scrollTimeout) clearTimeout(scrollTimeout);
    scrollTimeout = setTimeout(() => {
      const slideWidth = track.clientWidth;
      current = indexFromScroll(track.scrollLeft, slideWidth, length);
      setActiveDot(current);
    }, 80);
  });

  setActiveDot(current);
}

const Carousel = {
  wrapIndex,
  nextIndex,
  prevIndex,
  scrollLeftForIndex,
  indexFromScroll,
  initCarousel,
};

// Node (tests, `require('../assets/carousel.js')`) vs. browser (`<script src>`).
if (typeof module !== 'undefined' && module.exports) {
  module.exports = Carousel;
}
if (typeof window !== 'undefined') {
  window.Carousel = Carousel;
}
