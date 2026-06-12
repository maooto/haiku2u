import valley from './valley.js';
import coast from './coast.js';
import sakura from './sakura.js';

export const BIOMES = { valley, coast, sakura };

export function randomBiome(exclude = null) {
  const names = Object.keys(BIOMES).filter((n) => n !== exclude);
  return BIOMES[names[Math.floor(Math.random() * names.length)]];
}
