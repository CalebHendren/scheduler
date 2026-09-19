/*
 * CI gate. Loads the shipped browser sources into the Node global scope and
 * runs the same suite the headless browser runner uses, so a green CI badge
 * means the actual app files pass, not a parallel copy of them.
 */
import { readFileSync } from 'node:fs';
import { dirname, resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const repo = resolve(here, '..');

const SOURCES = [
  'assets/js/util.js',
  'assets/js/store.js',
  'assets/js/csv.js',
  'assets/js/optimizer.js',
  // Placement checks only; nothing in it touches the DOM until it renders.
  'assets/js/calendar.js',
  'tools/tests.js'
];

for (const rel of SOURCES) {
  const code = readFileSync(join(repo, rel), 'utf8');
  // Indirect eval runs in global scope, which is what the IIFE wrappers
  // expect when there is no window to attach to.
  (0, eval)(code);
}

const result = globalThis.TS.tests.run();

for (const line of result.lines) console.log(line);
console.log('');

if (result.failures.length) {
  for (const failure of result.failures) console.error('FAIL: ' + failure);
  console.error('');
}

console.log(`${result.passed} passed, ${result.failed} failed`);
process.exit(result.failed ? 1 : 0);
