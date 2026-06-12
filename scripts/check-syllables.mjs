// Heuristic syllable audit for public/haiku.csv.
// Usage: npm run check:syllables
// Flags any line whose estimated count differs from its stage's target
// (stage 1 -> 5, stage 2 -> 7, stage 3 -> 5). The estimator is a heuristic —
// treat flags as "please re-count by hand", not gospel. If it miscounts a
// word you know is right, add it to OVERRIDES below.

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const OVERRIDES = {
  // word: syllables — words the vowel-group heuristic gets wrong
  lonely: 2,
  evening: 2,
  quiet: 2,
  being: 2,
  riots: 2,
  every: 2,
  everything: 3,
  everywhere: 3,
  somewhere: 2,
  farewell: 2,
  tongue: 1,
  fire: 2,
  hour: 1,
  our: 1,
  poem: 2,
  poems: 2,
  ridgeline: 2,
};

const SIBILANT_ES = /(ch|sh|[scxzg])es$/; // reaches, washes, rises, ages...

function countWord(raw) {
  let w = raw.toLowerCase().replace(/[^a-z']/g, '').replace(/'/g, '');
  if (!w) return 0;
  if (OVERRIDES[w] != null) return OVERRIDES[w];

  const runs = w.match(/[aeiouy]+/g);
  if (!runs) return 1;
  let n = runs.length;

  if (n > 1) {
    if (/[^aeiouyl]le$/.test(w)) {
      // consonant + le (candle): syllabic e — keep
    } else if (/(ue|ee|oe|ye)$/.test(w)) {
      // argue, free, echo(e)s' kin — keep
    } else if (w.endsWith('e')) {
      n--; // silent final e: stone, while, scale, exhale
    } else if (w.endsWith('ied')) {
      // buried, carried: the ie run is the syllable — keep
    } else if (
      w.endsWith('es') &&
      !SIBILANT_ES.test(w) &&
      /[^aeiouy]es$/.test(w) &&
      !/[^aeiouyl]les$/.test(w) // keep syllabic -les: needles, puddles
    ) {
      n--; // silent -es (stones, eaves) vs pronounced (reaches, roses)
    } else if (w.endsWith('ed') && !/(ted|ded)$/.test(w) && !/[^aeiouyl]led$/.test(w)) {
      n--; // silent -ed (burned, watched) vs pronounced (planted, bridled)
    } else if (/[^aeiouy]e(ness|ly|ment|ful|less|some)$/.test(w)) {
      n--; // silent medial e before suffix: loosely, ripeness, pavement
    }
  }
  return Math.max(n, 1);
}

export function countLine(line) {
  const words = line.split(/[^A-Za-z']+/).filter(Boolean);
  return words.reduce((sum, w) => sum + countWord(w), 0);
}

// ---- run the audit ----
const csvPath = join(dirname(fileURLToPath(import.meta.url)), '..', 'public', 'haiku.csv');
const text = readFileSync(csvPath, 'utf8');
const TARGET = { 1: 5, 2: 7, 3: 5 };

let total = 0;
let flagged = 0;
const themes = new Map();

text.split(/\r?\n/).forEach((row, i) => {
  const raw = row.trim();
  if (!raw || raw.startsWith('#')) return;
  const c1 = raw.indexOf(',');
  const c2 = raw.indexOf(',', c1 + 1);
  if (c1 === -1 || c2 === -1) return;
  const theme = raw.slice(0, c1).trim();
  const stage = Number(raw.slice(c1 + 1, c2).trim());
  const line = raw.slice(c2 + 1).trim();
  if (theme.toLowerCase() === 'theme' || !TARGET[stage]) return;

  total++;
  themes.set(theme.toLowerCase(), (themes.get(theme.toLowerCase()) || 0) + 1);
  const est = countLine(line);
  if (est !== TARGET[stage]) {
    flagged++;
    const detail = line
      .split(/[^A-Za-z']+/)
      .filter(Boolean)
      .map((w) => `${w}:${countWord(w)}`)
      .join(' ');
    console.log(`row ${i + 1}  [${theme}/${stage}] expected ${TARGET[stage]}, estimated ${est}: "${line}"`);
    console.log(`         ${detail}`);
  }
});

console.log(`\n${total} lines across ${themes.size} themes checked — ${flagged} flagged.`);
const incomplete = [...themes.entries()].filter(([, n]) => n < 9);
if (incomplete.length) {
  console.log(`themes with fewer than 9 lines: ${incomplete.map(([t, n]) => `${t}(${n})`).join(', ')}`);
}
process.exitCode = flagged > 0 ? 1 : 0;
