import { EDGE } from './counts';
import { mulberry32, sample } from './generate';
import { softmax, type Vocab } from './loss';
import { forward, type Transformer } from './transformer';
import { crossEntropyLoss } from './value';

/**
Литера целиком: визитка по началу строки. Сан Саныч задаёт начало, Литера
дописывает до конца строки, а из нескольких вариантов берётся тот, в котором
она сама уверена больше всего.
*/
export type CardOptions = {
  readonly seed: number;
  readonly temperature?: number;
  readonly topK?: number;
  readonly maxLength?: number;
};

export const encodeLine = (vocab: Vocab, text: string): number[] =>
  [...text].map((symbol) => {
    const id = vocab.index.get(symbol);
    if (id === undefined || symbol === EDGE) throw new Error(`литеры «${symbol}» нет в кассе`);
    return id;
  });

/** Распределение следующей литеры: модель видит только последние context литер. */
export const nextProbs = (model: Transformer, ids: readonly number[]): number[] =>
  softmax(
    forward(model, ids.slice(-model.config.context))
      .at(-1)!
      .map((z) => z.data),
  );

/** Оставить k самых вероятных литер и перенормировать; k ≥ размера словаря ничего не меняет. */
export const topK = (probs: readonly number[], k: number): number[] => {
  if (k < 1) throw new Error('k должно быть не меньше 1');
  const threshold = [...probs].sort((a, b) => b - a)[Math.min(k, probs.length) - 1]!;
  let kept = 0;
  const filtered = probs.map((p) => (p >= threshold && kept++ < k ? p : 0));
  const sum = filtered.reduce((acc, p) => acc + p, 0);
  return filtered.map((p) => p / sum);
};

/** Начало строки и продолжение до края образца или до maxLength литер всего. */
export const card = (
  model: Transformer,
  vocab: Vocab,
  prefix: string,
  options: CardOptions,
): string => {
  const random = mulberry32(options.seed);
  const ids = [0, ...encodeLine(vocab, prefix)];
  let text = prefix;
  while (text.length < (options.maxLength ?? 80)) {
    const probs = topK(nextProbs(model, ids), options.topK ?? vocab.symbols.length);
    const next = sample(
      new Map(probs.map((p, id) => [vocab.symbols[id]!, p])),
      random,
      options.temperature ?? 0.8,
    );
    if (next === EDGE) break;
    text += next;
    ids.push(vocab.index.get(next)!);
  }
  return text;
};

/** Перплексия строки целиком, с краями: чем меньше, тем строка Литере привычнее. */
export const linePerplexity = (model: Transformer, vocab: Vocab, text: string): number => {
  const ids = [0, ...encodeLine(vocab, text), 0];
  const { context } = model.config;
  // Начало строки одним проходом: позиция t предсказывает литеру t + 1. Дальше окно сдвигается.
  const head = ids.slice(0, Math.min(context, ids.length - 1));
  let total = forward(model, head).reduce(
    (acc, z, t) => acc + crossEntropyLoss(z, ids[t + 1]!).data,
    0,
  );
  for (let t = head.length + 1; t < ids.length; t++) {
    total += crossEntropyLoss(forward(model, ids.slice(t - context, t)).at(-1)!, ids[t]!).data;
  }
  return Math.exp(total / (ids.length - 1));
};

export type Candidate = { readonly text: string; readonly perplexity: number };

/** n вариантов с сидами seed, seed + 1, … и самый уверенный из них первым. */
export const bestCards = (
  model: Transformer,
  vocab: Vocab,
  prefix: string,
  n: number,
  options: CardOptions,
): Candidate[] =>
  Array.from({ length: n }, (_, i) =>
    card(model, vocab, prefix, { ...options, seed: options.seed + i }),
  )
    .map((text) => ({ text, perplexity: linePerplexity(model, vocab, text) }))
    .sort((a, b) => a.perplexity - b.perplexity);
