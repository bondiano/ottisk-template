import { type Bigrams, EDGE } from './counts';

/** Генератор случайных чисел в [0, 1) с сидом: один сид, одна и та же строка. */
export type Random = () => number;

export const mulberry32 = (seed: number): Random => {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
};

/**
Выбор по весам с температурой: вес в степени 1/T. T < 1 обостряет распределение,
T > 1 сглаживает, T = 0 всегда берёт самую частую литеру.
*/
export const sample = (
  weights: ReadonlyMap<string, number>,
  random: Random,
  temperature = 1,
): string => {
  const entries = [...weights.entries()].filter(([, weight]) => weight > 0);
  if (entries.length === 0) throw new Error('выбирать не из чего');
  if (temperature < 0) throw new Error('температура не бывает отрицательной');
  if (temperature === 0) {
    return entries.reduce((best, entry) => (entry[1] > best[1] ? entry : best))[0];
  }
  // Делим на самый большой вес до степени: иначе при малой T числа улетают в бесконечность.
  const top = Math.max(...entries.map(([, weight]) => weight));
  const scaled = entries.map(
    ([letter, weight]) => [letter, (weight / top) ** (1 / temperature)] as const,
  );
  const sum = scaled.reduce((acc, [, weight]) => acc + weight, 0);
  let left = random() * sum;
  for (const [letter, weight] of scaled) {
    left -= weight;
    if (left < 0) return letter;
  }
  return scaled.at(-1)![0];
};

export type Options = {
  readonly seed: number;
  readonly temperature?: number;
  readonly maxLength?: number;
};

/** Образец из биграмм: от края до края, литера за литерой, не длиннее maxLength. */
export const generate = (table: Bigrams, options: Options): string => {
  const random = mulberry32(options.seed);
  const maxLength = options.maxLength ?? 80;
  let text = '';
  let prev = EDGE;
  while (text.length < maxLength) {
    const row = table.get(prev);
    if (!row) break;
    const next = sample(row, random, options.temperature ?? 1);
    if (next === EDGE) break;
    text += next;
    prev = next;
  }
  return text;
};
