import { EDGE, samples } from './counts';

/** Касса нейросети: номер у каждой литеры, край образца под номером 0. */
export type Vocab = {
  readonly symbols: readonly string[];
  readonly index: ReadonlyMap<string, number>;
};

export const vocabOf = (corpus: string): Vocab => {
  const letters = [...new Set(samples(corpus).join(''))].sort((a, b) =>
    a < b ? -1 : a > b ? 1 : 0,
  );
  const symbols = [EDGE, ...letters];
  return { symbols, index: new Map(symbols.map((symbol, id) => [symbol, id])) };
};

/** Вероятности из логитов; максимум вычитается, чтобы exp не переполнился. */
export const softmax = (logits: readonly number[]): number[] => {
  const top = Math.max(...logits);
  const exps = logits.map((logit) => Math.exp(logit - top));
  const sum = exps.reduce((acc, value) => acc + value, 0);
  return exps.map((value) => value / sum);
};

/** Потеря на одном примере: минус логарифм вероятности, которую модель дала верной литере. */
export const crossEntropy = (probs: readonly number[], target: number): number => {
  const p = probs[target];
  if (p === undefined) throw new Error(`нет литеры с номером ${target}`);
  return -Math.log(p);
};

/** Перплексия: из скольких равновероятных литер модель в среднем выбирает. */
export const perplexity = (meanLoss: number): number => Math.exp(meanLoss);

/** Обучающие пары (предыдущая, следующая) по всем образцам, с краями. */
export const pairs = (corpus: string, vocab: Vocab): [number, number][] =>
  samples(corpus).flatMap((line) => {
    const ids = [EDGE, ...line, EDGE].map((symbol) => {
      const id = vocab.index.get(symbol);
      if (id === undefined) throw new Error(`литеры «${symbol}» нет в кассе`);
      return id;
    });
    return ids.slice(1).map((next, i): [number, number] => [ids[i]!, next]);
  });

export type Weights = readonly (readonly number[])[];

/** Средняя потеря нейробиграммы: строка весов предыдущей литеры это логиты следующей. */
export const bigramLoss = (
  weights: Weights,
  data: readonly (readonly [number, number])[],
): number =>
  data.reduce((sum, [prev, next]) => sum + crossEntropy(softmax(weights[prev]!), next), 0) /
  data.length;

/**
Веса, при которых нейробиграмма совпадает со счётом: логарифм сглаженного числа.
Сглаживание `smoothing` добавляется к каждой паре, чтобы невиданная пара не давала log 0.
*/
export const countsAsWeights = (
  data: readonly (readonly [number, number])[],
  size: number,
  smoothing = 1,
): number[][] => {
  const counts = Array.from({ length: size }, () => Array<number>(size).fill(smoothing));
  for (const [prev, next] of data) counts[prev]![next]! += 1;
  return counts.map((row) => row.map((count) => Math.log(count)));
};
