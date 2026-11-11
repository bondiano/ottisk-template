/**
Наборная касса в коде: сколько раз встречается каждая литера и какая литера
идёт за какой. Перевод строки служит и началом, и концом образца.
*/
export const EDGE = '\n';

export type Bigrams = ReadonlyMap<string, ReadonlyMap<string, number>>;

/** Образцы корпуса: непустые строки без пробелов по краям. */
export const samples = (corpus: string): string[] =>
  corpus
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line !== '');

const bump = <K>(map: Map<K, number>, key: K): void => {
  map.set(key, (map.get(key) ?? 0) + 1);
};

/** Униграммы: сколько раз встречается каждая литера (без переводов строки). */
export const unigrams = (corpus: string): Map<string, number> => {
  const counts = new Map<string, number>();
  for (const line of samples(corpus)) for (const letter of line) bump(counts, letter);
  return counts;
};

/** Биграммы: для каждой литеры сколько раз за ней шла каждая следующая, с краями образца. */
export const bigrams = (corpus: string): Map<string, Map<string, number>> => {
  const table = new Map<string, Map<string, number>>();
  for (const line of samples(corpus)) {
    const letters = [EDGE, ...line, EDGE];
    for (let i = 1; i < letters.length; i++) {
      const prev = letters[i - 1]!;
      const row = table.get(prev) ?? new Map<string, number>();
      bump(row, letters[i]!);
      table.set(prev, row);
    }
  }
  return table;
};

const total = (row: ReadonlyMap<string, number>): number =>
  [...row.values()].reduce((sum, count) => sum + count, 0);

/** P(next | prev) по счёту; у литеры, которой не было, вероятность ноль. */
export const probability = (table: Bigrams, prev: string, next: string): number => {
  const row = table.get(prev);
  if (!row) return 0;
  return (row.get(next) ?? 0) / total(row);
};

/** k самых частых продолжений литеры: от частого к редкому, при равенстве по алфавиту. */
export const topNext = (table: Bigrams, prev: string, k: number): [string, number][] => {
  const row = table.get(prev);
  if (!row) return [];
  const sum = total(row);
  return [...row.entries()]
    .sort(([a, x], [b, y]) => y - x || (a < b ? -1 : a > b ? 1 : 0))
    .slice(0, k)
    .map(([letter, count]) => [letter, count / sum]);
};
