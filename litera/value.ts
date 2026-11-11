import { mulberry32 } from './generate';

/**
Скалярный autograd: каждое число помнит, из каких чисел и какой операцией получено.
`backward` идёт по графу от потери назад и раскладывает по узлам производную
потери по этому узлу (цепное правило).
*/
type Step = (self: Value) => void;
const noop: Step = () => {};

const lift = (other: Value | number): Value => (other instanceof Value ? other : new Value(other));

export class Value {
  grad = 0;

  constructor(
    public data: number,
    readonly parents: readonly Value[] = [],
    private readonly step: Step = noop,
  ) {}

  add(other: Value | number): Value {
    const o = lift(other);
    return new Value(this.data + o.data, [this, o], (out) => {
      this.grad += out.grad;
      o.grad += out.grad;
    });
  }

  mul(other: Value | number): Value {
    const o = lift(other);
    return new Value(this.data * o.data, [this, o], (out) => {
      this.grad += o.data * out.grad;
      o.grad += this.data * out.grad;
    });
  }

  pow(k: number): Value {
    return new Value(this.data ** k, [this], (out) => {
      this.grad += k * this.data ** (k - 1) * out.grad;
    });
  }

  neg(): Value {
    return this.mul(-1);
  }

  sub(other: Value | number): Value {
    return this.add(lift(other).neg());
  }

  div(other: Value | number): Value {
    return this.mul(lift(other).pow(-1));
  }

  exp(): Value {
    const e = Math.exp(this.data);
    return new Value(e, [this], (out) => {
      this.grad += e * out.grad;
    });
  }

  log(): Value {
    return new Value(Math.log(this.data), [this], (out) => {
      this.grad += out.grad / this.data;
    });
  }

  tanh(): Value {
    const t = Math.tanh(this.data);
    return new Value(t, [this], (out) => {
      this.grad += (1 - t * t) * out.grad;
    });
  }

  relu(): Value {
    return new Value(Math.max(0, this.data), [this], (out) => {
      this.grad += (this.data > 0 ? 1 : 0) * out.grad;
    });
  }

  /** Производные потери по всем узлам графа. Обход без рекурсии: графы трансформера глубокие. */
  backward(): void {
    const order: Value[] = [];
    const seen = new Set<Value>();
    const stack: [Value, boolean][] = [[this, false]];
    while (stack.length > 0) {
      const [node, done] = stack.pop()!;
      if (done) {
        order.push(node);
        continue;
      }
      if (seen.has(node)) continue;
      seen.add(node);
      stack.push([node, true]);
      for (const parent of node.parents) if (!seen.has(parent)) stack.push([parent, false]);
    }
    this.grad = 1;
    for (let i = order.length - 1; i >= 0; i--) order[i]!.step(order[i]!);
  }
}

export const value = (data: number): Value => new Value(data);

/** Сумма одним узлом: короче граф и быстрее обход, чем цепочка из add. */
export const sum = (values: readonly Value[]): Value =>
  new Value(
    values.reduce((acc, v) => acc + v.data, 0),
    values,
    (out) => {
      for (const v of values) v.grad += out.grad;
    },
  );

/** Скалярное произведение одним узлом: из него собраны все линейные слои. */
export const dot = (xs: readonly Value[], ws: readonly Value[]): Value => {
  if (xs.length !== ws.length) throw new Error(`длины не совпадают: ${xs.length} и ${ws.length}`);
  let data = 0;
  for (let i = 0; i < xs.length; i++) data += xs[i]!.data * ws[i]!.data;
  return new Value(data, [...xs, ...ws], (out) => {
    for (let i = 0; i < xs.length; i++) {
      xs[i]!.grad += ws[i]!.data * out.grad;
      ws[i]!.grad += xs[i]!.data * out.grad;
    }
  });
};

/**
Cross-entropy по логитам одним узлом: log Σ exp(z) − z[target].
Производная по логиту это softmax минус единица на верной литере.
*/
export const crossEntropyLoss = (logits: readonly Value[], target: number): Value => {
  const top = Math.max(...logits.map((z) => z.data));
  const exps = logits.map((z) => Math.exp(z.data - top));
  const total = exps.reduce((acc, e) => acc + e, 0);
  const picked = logits[target];
  if (!picked) throw new Error(`нет литеры с номером ${target}`);
  return new Value(Math.log(total) + top - picked.data, logits, (out) => {
    logits.forEach((z, i) => {
      z.grad += (exps[i]! / total - (i === target ? 1 : 0)) * out.grad;
    });
  });
};

/** Шаг градиентного спуска: против градиента на lr, потом обнулить градиенты. */
export const sgdStep = (params: readonly Value[], lr: number): void => {
  for (const p of params) {
    p.data -= lr * p.grad;
    p.grad = 0;
  }
};

export type Training = {
  readonly steps: number;
  readonly lr: number;
  readonly batch: number;
  readonly seed: number;
};

/** Нейробиграмма, обученная спуском на мини-батчах; возвращает веса и потерю каждого шага. */
export const trainBigram = (
  data: readonly (readonly [number, number])[],
  size: number,
  training: Training,
): { weights: number[][]; losses: number[] } => {
  const weights = Array.from({ length: size }, () => Array.from({ length: size }, () => value(0)));
  const random = mulberry32(training.seed);
  const losses: number[] = [];
  for (let step = 0; step < training.steps; step++) {
    const batch = Array.from(
      { length: training.batch },
      () => data[Math.floor(random() * data.length)]!,
    );
    const loss = sum(batch.map(([prev, next]) => crossEntropyLoss(weights[prev]!, next))).div(
      batch.length,
    );
    loss.backward();
    sgdStep(weights.flat(), training.lr);
    losses.push(loss.data);
  }
  return { weights: weights.map((row) => row.map((w) => w.data)), losses };
};
