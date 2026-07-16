#!/usr/bin/env node
/**
 * ActHistory sanitizer — drops agent noise, merges duplicate retries, rejects bad fill locators.
 */
const path = require('path');
const root = path.resolve(__dirname, '..');
const { sanitizeActHistoryForReplay } = require(path.join(
  root,
  'dist/src/core/replay/ActHistorySanitizer.js'
));

let failed = 0;
function assert(cond, name, detail = '') {
  if (cond) console.log(`✓ ${name}${detail ? `: ${detail}` : ''}`);
  else {
    failed += 1;
    console.error(`✗ ${name}${detail ? `: ${detail}` : ''}`);
  }
}

const bookingNoise = [
  { index: 1, action: 'navigate', value: 'https://www.booking.com/', url: 'https://www.booking.com/' },
  { index: 2, action: 'wait', value: '4' },
  {
    index: 3,
    action: 'click',
    locators: [{ kind: 'css', value: 'button[id="onetrust-accept-btn-handler"]' }],
  },
  { index: 4, action: 'search_page', description: '204 matches' },
  {
    index: 6,
    action: 'input',
    value: 'London',
    locators: [{ kind: 'css', value: 'a[href="#main"]' }],
  },
  { index: 9, action: 'input', value: 'London', locators: [] },
  { index: 10, action: 'input', value: 'London', locators: [] },
  {
    index: 16,
    action: 'click',
    locators: [{ kind: 'css', value: 'a[href="#main"]' }],
  },
  {
    index: 29,
    action: 'click',
    locators: [
      { kind: 'role', value: 'link', name: 'London, United Kingdom' },
    ],
  },
];

const r = sanitizeActHistoryForReplay(bookingNoise);
assert(r.steps.length < bookingNoise.length, 'Compacts booking noise', `${bookingNoise.length} → ${r.steps.length}`);
assert(
  !r.steps.some((s) => s.action === 'search_page'),
  'Drops search_page'
);
assert(
  r.steps.filter((s) => s.action === 'input' && s.value === 'London').length <= 1,
  'Single London input after merge'
);
const london = r.steps.find((s) => s.action === 'input' && s.value === 'London');
assert(!london || !JSON.stringify(london.locators || []).includes('#main'), 'No #main skip link for London fill');
assert(
  !r.steps.some((s) => s.action === 'click' && JSON.stringify(s.locators || []).includes('#main')),
  'Drops #main skip-link clicks'
);
assert(
  r.steps.some((s) => s.action === 'click' && JSON.stringify(s.locators || []).includes('London')),
  'Keeps London suggestion click'
);

if (failed) {
  console.error(`\n${failed} failed`);
  process.exit(1);
}
console.log('\nActHistory sanitizer tests passed.');
