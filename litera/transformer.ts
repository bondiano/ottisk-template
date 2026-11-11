import { type Head, multiHead } from './attention';
import { EDGE, samples } from './counts';
import { mulberry32, type Options, sample } from './generate';
import { softmax, type Vocab } from './loss';
import { linear, type Matrix, matrix, uniform } from './mlp';
import { crossEntropyLoss, sum, Value, value } from './value';

/**
Крошечный трансформер: эмбеддинг литеры плюс эмбеддинг позиции, блоки
«нормализация → внимание → остаток → нормализация → полносвязный слой → остаток»,
финальная нормализация и выходной слой с логитами.
*/
export type Config = {
  readonly vocab: number;
  readonly context: number;
  readonly embed: number;
  readonly heads: number;
  readonly hidden: number;
  readonly layers: number;
};

type Norm = { readonly gain: readonly Value[]; readonly bias: readonly Value[] };

export type Block = {
  readonly norm1: Norm;
  readonly heads: readonly Head[];
  readonly proj: Matrix;
  readonly norm2: Norm;
  readonly up: Matrix;
  readonly upBias: readonly Value[];
  readonly down: Matrix;
  readonly downBias: readonly Value[];
};

export type Transformer = {
  readonly config: Config;
  readonly tokens: Matrix;
  readonly positions: Matrix;
  readonly blocks: readonly Block[];
  readonly norm: Norm;
  readonly out: Matrix;
  readonly outBias: readonly Value[];
};

const row = (size: number, fill: number): Value[] =>
  Array.from({ length: size }, () => value(fill));
const norm = (size: number): Norm => ({ gain: row(size, 1), bias: row(size, 0) });

export const initTransformer = (config: Config, seed: number): Transformer => {
  const random = mulberry32(seed);
  const { embed, hidden, heads } = config;
  const size = embed / heads;
  if (!Number.isInteger(size)) throw new Error(`embed ${embed} не делится на ${heads} голов`);
  const w = (rows: number, cols: number) =>
    matrix(rows, cols, uniform(random, 1 / Math.sqrt(cols)));
  return {
    config,
    tokens: matrix(config.vocab, embed, uniform(random, 0.5)),
    positions: matrix(config.context, embed, uniform(random, 0.5)),
    blocks: Array.from({ length: config.layers }, () => ({
      norm1: norm(embed),
      heads: Array.from({ length: heads }, () => ({
        q: w(size, embed),
        k: w(size, embed),
        v: w(size, embed),
      })),
      proj: w(embed, embed),
      norm2: norm(embed),
      up: w(hidden, embed),
      upBias: row(hidden, 0),
      down: w(embed, hidden),
      downBias: row(embed, 0),
    })),
    norm: norm(embed),
    out: w(config.vocab, embed),
    outBias: row(config.vocab, 0),
  };
};

/** Нормализация слоя: среднее 0 и разброс 1 по вектору, потом обучаемые масштаб и сдвиг. */
export const layerNorm = (x: readonly Value[], { gain, bias }: Norm): Value[] => {
  const mean = sum(x).div(x.length);
  const centered = x.map((v) => v.sub(mean));
  const variance = sum(centered.map((v) => v.mul(v))).div(x.length);
  const scale = variance.add(1e-5).pow(-0.5);
  return centered.map((v, i) => v.mul(scale).mul(gain[i]!).add(bias[i]!));
};

const addAll = (a: readonly Value[], b: readonly Value[]): Value[] => a.map((v, i) => v.add(b[i]!));

/** Логиты следующей литеры для каждой позиции строки; строка не длиннее context. */
export const forward = (model: Transformer, ids: readonly number[]): Value[][] => {
  if (ids.length > model.config.context) {
    throw new Error(`строка из ${ids.length} литер длиннее окна ${model.config.context}`);
  }
  let xs = ids.map((id, t) => {
    const token = model.tokens[id];
    if (!token) throw new Error(`нет литеры с номером ${id}`);
    return addAll(token, model.positions[t]!);
  });
  for (const block of model.blocks) {
    const attended = multiHead(
      xs.map((x) => layerNorm(x, block.norm1)),
      block.heads,
      block.proj,
    ).out;
    xs = xs.map((x, t) => addAll(x, attended[t]!));
    xs = xs.map((x) => {
      const h = linear(layerNorm(x, block.norm2), block.up, block.upBias).map((z) => z.relu());
      return addAll(x, linear(h, block.down, block.downBias));
    });
  }
  return xs.map((x) => linear(layerNorm(x, model.norm), model.out, model.outBias));
};

/** Потеря на строке: каждая позиция предсказывает следующую литеру. */
export const sequenceLoss = (model: Transformer, ids: readonly number[]): Value => {
  const logits = forward(model, ids.slice(0, -1));
  return sum(logits.map((z, t) => crossEntropyLoss(z, ids[t + 1]!))).div(logits.length);
};

/**
Обучающие строки: образец с краями, окно по context + 1 литер с каждой позиции.
Генерация сдвигает окно по одной литере, поэтому и учиться надо на окнах с любого места:
окна с шагом в пол-окна учили бы позиции только от начала, середины и конца строки.
*/
export const sequencesOf = (corpus: string, vocab: Vocab, context: number): number[][] =>
  samples(corpus).flatMap((line) => {
    const ids = [EDGE, ...line, EDGE].map((symbol) => {
      const id = vocab.index.get(symbol);
      if (id === undefined) throw new Error(`литеры «${symbol}» нет в кассе`);
      return id;
    });
    return ids.slice(0, -1).map((_, start) => ids.slice(start, start + context + 1));
  });

export const parameters = (model: Transformer): Value[] => [
  ...model.tokens.flat(),
  ...model.positions.flat(),
  ...model.blocks.flatMap((b) => [
    ...b.norm1.gain,
    ...b.norm1.bias,
    ...b.heads.flatMap((h) => [...h.q.flat(), ...h.k.flat(), ...h.v.flat()]),
    ...b.proj.flat(),
    ...b.norm2.gain,
    ...b.norm2.bias,
    ...b.up.flat(),
    ...b.upBias,
    ...b.down.flat(),
    ...b.downBias,
  ]),
  ...model.norm.gain,
  ...model.norm.bias,
  ...model.out.flat(),
  ...model.outBias,
];

/** Adam: шаг по градиенту с инерцией (m) и поправкой на разброс (v); обнуляет градиенты. */
export const adam = (
  params: readonly Value[],
  lr: number,
  beta1 = 0.9,
  beta2 = 0.999,
): (() => void) => {
  const m = new Float64Array(params.length);
  const v = new Float64Array(params.length);
  let t = 0;
  return () => {
    t++;
    params.forEach((p, i) => {
      m[i] = beta1 * m[i]! + (1 - beta1) * p.grad;
      v[i] = beta2 * v[i]! + (1 - beta2) * p.grad * p.grad;
      const mHat = m[i]! / (1 - beta1 ** t);
      const vHat = v[i]! / (1 - beta2 ** t);
      p.data -= (lr * mHat) / (Math.sqrt(vHat) + 1e-8);
      p.grad = 0;
    });
  };
};

export type Training = {
  readonly steps: number;
  readonly lr: number;
  readonly batch: number;
  readonly seed: number;
};

export const train = (
  model: Transformer,
  sequences: readonly (readonly number[])[],
  training: Training,
): number[] => {
  const random = mulberry32(training.seed);
  const step = adam(parameters(model), training.lr);
  const losses: number[] = [];
  for (let i = 0; i < training.steps; i++) {
    const batch = Array.from(
      { length: training.batch },
      () => sequences[Math.floor(random() * sequences.length)]!,
    );
    const loss = sum(batch.map((ids) => sequenceLoss(model, ids))).div(batch.length);
    loss.backward();
    step();
    losses.push(loss.data);
  }
  return losses;
};

/** Средняя потеря на строках без обучения: так меряют валидацию и переобучение. */
export const evaluate = (model: Transformer, sequences: readonly (readonly number[])[]): number =>
  sequences.reduce((acc, ids) => acc + sequenceLoss(model, ids).data, 0) / sequences.length;

/** Образец из трансформера от края: окно сдвигается, когда строка длиннее context. */
export const sampleTransformer = (model: Transformer, vocab: Vocab, options: Options): string => {
  const random = mulberry32(options.seed);
  const ids = [0];
  let text = '';
  while (text.length < (options.maxLength ?? 80)) {
    const logits = forward(model, ids.slice(-model.config.context)).at(-1)!;
    const probs = softmax(logits.map((z) => z.data));
    const next = sample(
      new Map(probs.map((p, id) => [vocab.symbols[id]!, p])),
      random,
      options.temperature ?? 1,
    );
    if (next === EDGE) break;
    text += next;
    ids.push(vocab.index.get(next)!);
  }
  return text;
};

type Json = number | readonly Json[] | { readonly [key: string]: Json };

const toJson = (node: unknown): Json =>
  node instanceof Value
    ? Number(node.data.toFixed(4))
    : Array.isArray(node)
      ? node.map(toJson)
      : Object.fromEntries(Object.entries(node as object).map(([key, v]) => [key, toJson(v)]));

const fromJson = (node: Json): unknown =>
  typeof node === 'number'
    ? value(node)
    : Array.isArray(node)
      ? node.map(fromJson)
      : Object.fromEntries(Object.entries(node).map(([key, v]) => [key, fromJson(v)]));

export const transformerToJson = (model: Transformer): string => {
  const { config, ...weights } = model;
  return JSON.stringify({ config, weights: toJson(weights) });
};

export const transformerFromJson = (text: string): Transformer => {
  const { config, weights } = JSON.parse(text) as { config: Config; weights: Json };
  return { config, ...(fromJson(weights) as Omit<Transformer, 'config'>) };
};
