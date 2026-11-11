import { EDGE, samples } from './counts';
import { mulberry32, type Options, type Random, sample } from './generate';
import { softmax, type Vocab } from './loss';
import { crossEntropyLoss, dot, sgdStep, sum, Value, value } from './value';

/**
MLP по Бенжио (2003): литера предсказывается по окну из `block` предыдущих.
Каждая литера окна берёт свой вектор из таблицы эмбеддингов C, векторы
склеиваются, проходят скрытый слой с tanh и выходной слой с логитами.
*/
export type MlpConfig = {
  readonly vocab: number;
  readonly block: number;
  readonly embed: number;
  readonly hidden: number;
};

export type Matrix = readonly (readonly Value[])[];

export type Mlp = {
  readonly config: MlpConfig;
  readonly C: Matrix;
  readonly W1: Matrix;
  readonly b1: readonly Value[];
  readonly W2: Matrix;
  readonly b2: readonly Value[];
};

export const matrix = (rows: number, cols: number, init: () => number): Value[][] =>
  Array.from({ length: rows }, () => Array.from({ length: cols }, () => value(init())));

/** Равномерно в [-scale, scale]: начальные веса без перекоса в одну сторону. */
export const uniform = (random: Random, scale: number) => (): number => (random() * 2 - 1) * scale;

export const initMlp = (config: MlpConfig, seed: number): Mlp => {
  const random = mulberry32(seed);
  const fanIn = config.block * config.embed;
  return {
    config,
    C: matrix(config.vocab, config.embed, uniform(random, 1)),
    W1: matrix(config.hidden, fanIn, uniform(random, 1 / Math.sqrt(fanIn))),
    b1: matrix(1, config.hidden, () => 0)[0]!,
    W2: matrix(config.vocab, config.hidden, uniform(random, 1 / Math.sqrt(config.hidden))),
    b2: matrix(1, config.vocab, () => 0)[0]!,
  };
};

/** Линейный слой: строка весов на выход, скалярное произведение со входом плюс сдвиг. */
export const linear = (x: readonly Value[], W: Matrix, b?: readonly Value[]): Value[] =>
  W.map((row, i) => {
    const y = dot(x, row);
    return b ? y.add(b[i]!) : y;
  });

/** Логиты следующей литеры по окну номеров длины block. */
export const mlpLogits = (model: Mlp, window: readonly number[]): Value[] => {
  if (window.length !== model.config.block) {
    throw new Error(`окно из ${window.length} литер, а модель ждёт ${model.config.block}`);
  }
  const x = window.flatMap((id) => {
    const row = model.C[id];
    if (!row) throw new Error(`нет литеры с номером ${id}`);
    return row;
  });
  const h = linear(x, model.W1, model.b1).map((z) => z.tanh());
  return linear(h, model.W2, model.b2);
};

/** Примеры (окно, следующая): окно в начале образца добито краями. */
export const contexts = (corpus: string, vocab: Vocab, block: number): [number[], number][] =>
  samples(corpus).flatMap((line) => {
    const ids = [...line, EDGE].map((symbol) => {
      const id = vocab.index.get(symbol);
      if (id === undefined) throw new Error(`литеры «${symbol}» нет в кассе`);
      return id;
    });
    let window = Array<number>(block).fill(0);
    return ids.map((next): [number[], number] => {
      const example: [number[], number] = [window, next];
      window = [...window.slice(1), next];
      return example;
    });
  });

export const mlpLoss = (
  model: Mlp,
  examples: readonly (readonly [readonly number[], number])[],
): Value =>
  sum(examples.map(([window, next]) => crossEntropyLoss(mlpLogits(model, window), next))).div(
    examples.length,
  );

export const mlpParams = (model: Mlp): Value[] => [
  ...model.C.flat(),
  ...model.W1.flat(),
  ...model.b1,
  ...model.W2.flat(),
  ...model.b2,
];

/** Обучение на мини-батчах: каждый шаг считает потерю на batch случайных примеров. */
export const trainMlp = (
  model: Mlp,
  examples: readonly (readonly [readonly number[], number])[],
  training: {
    readonly steps: number;
    readonly lr: number;
    readonly batch: number;
    readonly seed: number;
  },
): number[] => {
  const random = mulberry32(training.seed);
  const params = mlpParams(model);
  const losses: number[] = [];
  for (let step = 0; step < training.steps; step++) {
    const batch = Array.from(
      { length: training.batch },
      () => examples[Math.floor(random() * examples.length)]!,
    );
    const loss = mlpLoss(model, batch);
    loss.backward();
    sgdStep(params, training.lr);
    losses.push(loss.data);
  }
  return losses;
};

/** Образец из MLP: окно сдвигается на каждую новую литеру, край образца это конец. */
export const sampleMlp = (model: Mlp, vocab: Vocab, options: Options): string => {
  const random = mulberry32(options.seed);
  let window = Array<number>(model.config.block).fill(0);
  let text = '';
  while (text.length < (options.maxLength ?? 80)) {
    const probs = softmax(mlpLogits(model, window).map((z) => z.data));
    const next = sample(
      new Map(probs.map((p, id) => [vocab.symbols[id]!, p])),
      random,
      options.temperature ?? 1,
    );
    if (next === EDGE) break;
    text += next;
    window = [...window.slice(1), vocab.index.get(next)!];
  }
  return text;
};

type Numbers = readonly (readonly number[])[];
type MlpJson = {
  config: MlpConfig;
  C: Numbers;
  W1: Numbers;
  b1: readonly number[];
  W2: Numbers;
  b2: readonly number[];
};

const values = (rows: Numbers): Value[][] => rows.map((row) => row.map(value));
const numbers = (rows: Matrix): number[][] =>
  rows.map((row) => row.map((v) => Number(v.data.toFixed(4))));

export const mlpFromJson = (text: string): Mlp => {
  const json = JSON.parse(text) as MlpJson;
  return {
    config: json.config,
    C: values(json.C),
    W1: values(json.W1),
    b1: json.b1.map(value),
    W2: values(json.W2),
    b2: json.b2.map(value),
  };
};

export const mlpToJson = (model: Mlp): string =>
  JSON.stringify({
    config: model.config,
    C: numbers(model.C),
    W1: numbers(model.W1),
    b1: numbers([model.b1])[0],
    W2: numbers(model.W2),
    b2: numbers([model.b2])[0],
  });
