import { linear, type Matrix } from './mlp';
import { dot, sum, type Value } from './value';

/**
Голова self-attention. Каждая литера строки задаёт вопрос (query), подписывает
себя ключом (key) и несёт значение (value). Литера t смотрит только на литеры
0..t (маска будущего): вес литеры s это softmax по q_t · k_s / √d.
*/
export type Head = { readonly q: Matrix; readonly k: Matrix; readonly v: Matrix };

/** Softmax на узлах autograd; максимум вычитается константой. */
export const softmaxValues = (z: readonly Value[]): Value[] => {
  const top = Math.max(...z.map((v) => v.data));
  const exps = z.map((v) => v.sub(top).exp());
  const total = sum(exps);
  return exps.map((e) => e.div(total));
};

export type Attention = {
  readonly out: Value[][];
  /** weights[t][s]: сколько внимания литера t отдала литере s; над диагональю нули. */
  readonly weights: number[][];
};

export const attend = (xs: readonly (readonly Value[])[], head: Head): Attention => {
  const qs = xs.map((x) => linear(x, head.q));
  const ks = xs.map((x) => linear(x, head.k));
  const vs = xs.map((x) => linear(x, head.v));
  const scale = 1 / Math.sqrt(head.q.length);
  const out: Value[][] = [];
  const weights: number[][] = [];
  qs.forEach((q, t) => {
    const visible = ks.slice(0, t + 1);
    const w = softmaxValues(visible.map((k) => dot(q, k).mul(scale)));
    const size = vs[0]!.length;
    out.push(
      Array.from({ length: size }, (_, d) =>
        dot(
          w,
          vs.slice(0, t + 1).map((v) => v[d]!),
        ),
      ),
    );
    weights.push(xs.map((_, s) => (s <= t ? w[s]!.data : 0)));
  });
  return { out, weights };
};

/** Несколько голов смотрят по-разному; их выходы склеиваются и проходят проекцию. */
export const multiHead = (
  xs: readonly (readonly Value[])[],
  heads: readonly Head[],
  proj: Matrix,
): { out: Value[][]; weights: number[][][] } => {
  const results = heads.map((head) => attend(xs, head));
  const out = xs.map((_, t) =>
    linear(
      results.flatMap((r) => r.out[t]!),
      proj,
    ),
  );
  return { out, weights: results.map((r) => r.weights) };
};
