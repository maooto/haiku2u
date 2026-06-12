# haiku2u — a moment of stillness

A meditative browser game inspired by the haiku-composing minigame in *Ghost of
Tsushima*. A camera glides over a living vista and settles into a seated,
first-person meditation. A temple bell rings, a theme is offered, and you
compose a haiku by gazing between three softly glowing points — each holding a
candidate line — across three scales of the scene: a distant grove, a single
tree, a flower. When the last line is chosen, a gong sounds and the camera
drifts back to the sky while your poem is recited aloud.

Everything is generated in code — terrain, trees, water, particles, and every
sound (temple bell, shakuhachi flute, woodblocks, gong, wind, birds) are
synthesized at runtime. There are **no runtime AI or API calls**: all haiku
lines are pre-written text in a CSV. It is a fully static site.

## Playing

- **Bluetooth / USB controller** (Xbox, PlayStation, most standard pads):
  pair it with your computer, press any button to wake it, then
  - **either stick / d-pad** — pan your gaze
  - **A / ✕** — select the focused line (also: skip the intro, restart)
  - **Back / Select** — toggle Kurosawa (monochrome) mode
  - rumble confirms each selection
- **Mouse / keyboard**: move the mouse (click once to capture it) or use
  **WASD / arrow keys** to pan; **click / Enter / Space** to select;
  **M** toggles Kurosawa mode; **Esc** releases the mouse.

One of three vistas — river valley, sea cliffs, or cherry-blossom valley — is
chosen at random each round, along with a random theme.

## Running locally

```bash
npm install
npm run dev          # http://localhost:5173
npm run build        # static production build in dist/
npm run check:syllables   # audit haiku.csv line syllable counts
```

Useful dev URL flags: `?biome=valley|coast|sakura`, `?theme=peace`,
`?skipIntro=1`, `?mono=1`.

## Adding your own themes and lines

All content lives in [public/haiku.csv](public/haiku.csv) — edit it with any
text editor and refresh the browser. No rebuild is needed (in production,
redeploy publishes the new file). One row per candidate line:

```
theme,stage,line
courage,1,A matchstick at night
```

- `stage 1` = first line of the haiku (**5 syllables**)
- `stage 2` = second line (**7 syllables**)
- `stage 3` = third line (**5 syllables**)
- A theme needs **at least 3 lines per stage** to enter the rotation; give it
  more and the game picks 3 at random each round.
- Write lines that stand alone — any combination of the three stages should
  read as one coherent poem.
- Rows starting with `#` are comments. Lines may contain commas.
- Run `npm run check:syllables` to flag suspect syllable counts
  (it's a heuristic — trust your own ear over the script, and add tricky
  words to `OVERRIDES` in [scripts/check-syllables.mjs](scripts/check-syllables.mjs)).

## Tech

Vite + three.js (procedural world, no assets) · Web Audio API (synthesized
instruments + ambience) · Web Speech API (poem recitation, with chime
fallback) · Gamepad API (controllers, rumble, Xbox/PS glyphs).
