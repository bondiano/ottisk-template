/**
Полное обучение Литеры (урок 28, босс 30): тот же трансформер этапа 10 на корпусе
визиток, но столько шагов, сколько в браузерном тесте не уместить. Каждый десятый
образец уходит в валидацию: видно, когда Литера начинает зубрить.

  pnpm litera:train [шагов, по умолчанию 4000]

Веса пишутся в litera/weights.ts, их берёт pnpm litera:sample.
*/
import { writeFileSync } from 'node:fs';

import { samples } from './counts';
import { CORPUS } from './corpus';
import { vocabOf } from './loss';
import {
  evaluate,
  initTransformer,
  sampleTransformer,
  sequencesOf,
  train,
  transformerToJson,
} from './transformer';

const steps = Number(process.argv[2] ?? 4000);
const vocab = vocabOf(CORPUS);
const config = {
  vocab: vocab.symbols.length,
  context: 24,
  embed: 24,
  heads: 3,
  hidden: 64,
  layers: 1,
};
const lines = samples(CORPUS);
const trainSet = sequencesOf(
  lines.filter((_, i) => i % 10 !== 0).join('\n'),
  vocab,
  config.context,
);
// Окно с каждой литеры: окон много, для замера хватит каждого пятого.
const validation = sequencesOf(
  lines.filter((_, i) => i % 10 === 0).join('\n'),
  vocab,
  config.context,
).filter((_, index) => index % 5 === 0);

const model = initTransformer(config, 1);
const started = performance.now();
const chunk = 250;
for (let done = 0; done < steps; done += chunk) {
  const lr = done < (steps * 3) / 4 ? 0.01 : 0.003;
  train(model, trainSet, { steps: Math.min(chunk, steps - done), lr, batch: 8, seed: done + 1 });
  const seconds = (performance.now() - started) / 1000;
  console.log(
    `шаг ${done + chunk}: потеря на обучении ${evaluate(
      model,
      trainSet.filter((_, index) => index % 50 === 0),
    ).toFixed(3)}, ` +
      `на валидации ${evaluate(model, validation).toFixed(3)}, ${seconds.toFixed(0)} с`,
  );
}

for (let seed = 0; seed < 3; seed++)
  console.log(`образец: ${sampleTransformer(model, vocab, { seed, temperature: 0.7 })}`);
writeFileSync(
  new URL('./weights.ts', import.meta.url),
  `/** Веса Литеры из pnpm litera:train. */\nexport const WEIGHTS = '${transformerToJson(model)}';\n`,
);
console.log(
  `Веса в litera/weights.ts. Цена запуска: $0, считала твоя машина ${((performance.now() - started) / 1000).toFixed(0)} с.`,
);
