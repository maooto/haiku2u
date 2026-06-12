// Haiku content loader.
// All themes and lines live in /haiku.csv (in `public/`), so new content can be
// added by editing that file alone — no rebuild needed. Format, one row per line:
//
//   theme,stage,line
//
// stage 1 = first line (5 syllables), stage 2 = second (7), stage 3 = third (5).
// Rows starting with # and blank rows are ignored. Only the first two commas
// delimit fields, so lines themselves may contain commas.

const STAGE_SYLLABLES = [5, 7, 5];

export async function loadHaiku(url = `${import.meta.env.BASE_URL}haiku.csv`) {
  const res = await fetch(url, { cache: 'no-cache' });
  if (!res.ok) throw new Error(`could not load ${url}: HTTP ${res.status}`);
  const text = await res.text();
  return parseHaikuCSV(text);
}

export function parseHaikuCSV(text) {
  const themes = new Map(); // key: lowercase theme -> { name, lines: [ [], [], [] ] }
  const warnings = [];

  const rows = text.split(/\r?\n/);
  for (let i = 0; i < rows.length; i++) {
    const raw = rows[i].trim();
    if (!raw || raw.startsWith('#')) continue;

    const c1 = raw.indexOf(',');
    const c2 = c1 === -1 ? -1 : raw.indexOf(',', c1 + 1);
    if (c1 === -1 || c2 === -1) {
      warnings.push(`row ${i + 1}: expected "theme,stage,line" — skipped: "${raw}"`);
      continue;
    }

    const theme = raw.slice(0, c1).trim();
    const stageStr = raw.slice(c1 + 1, c2).trim();
    const line = raw.slice(c2 + 1).trim();

    if (theme.toLowerCase() === 'theme' && stageStr.toLowerCase() === 'stage') continue; // header

    const stage = Number(stageStr);
    if (!theme || !line || ![1, 2, 3].includes(stage)) {
      warnings.push(`row ${i + 1}: bad theme/stage/line — skipped: "${raw}"`);
      continue;
    }

    const key = theme.toLowerCase();
    if (!themes.has(key)) themes.set(key, { name: theme, lines: [[], [], []] });
    themes.get(key).lines[stage - 1].push(line);
  }

  // a theme is only playable with at least 3 candidate lines per stage
  const playable = [];
  for (const t of themes.values()) {
    const counts = t.lines.map((l) => l.length);
    if (counts.every((n) => n >= 3)) {
      playable.push(t);
    } else {
      warnings.push(
        `theme "${t.name}" skipped: needs >=3 lines per stage, has ${counts.join('/')}`
      );
    }
  }

  for (const w of warnings) console.warn(`[haiku.csv] ${w}`);
  if (playable.length === 0) {
    console.warn('[haiku.csv] no playable themes found — using built-in fallback');
    playable.push(FALLBACK_THEME);
  }
  console.info(`[haiku.csv] ${playable.length} playable themes loaded`);

  return { themes: playable, warnings };
}

// Picks a theme + 3 random candidate lines per stage for one round.
export function pickRound(data, themeName = null, rng = Math.random) {
  const pool = data.themes;
  let theme = themeName
    ? pool.find((t) => t.name.toLowerCase() === themeName.toLowerCase())
    : null;
  if (!theme) theme = pool[Math.floor(rng() * pool.length)];

  const options = theme.lines.map((lines) => shuffle([...lines], rng).slice(0, 3));
  return { theme: theme.name, options, syllables: STAGE_SYLLABLES };
}

function shuffle(arr, rng) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

// Used only if haiku.csv is missing or entirely malformed.
const FALLBACK_THEME = {
  name: 'stillness',
  lines: [
    ['the mountain listens', 'a breath held softly', 'mist forgets the dawn'],
    [
      'the river carries what was',
      'wind writes nothing on the reeds',
      'one leaf settles on the stone',
    ],
    ['and the heart grows quiet', 'nothing asks for more', 'evening comes to rest'],
  ],
};
