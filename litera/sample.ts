/**
Визитки по началу строки (босс 30): три варианта, самый уверенный первым.

  pnpm litera:sample "Ремонт "
*/
import { CORPUS } from './corpus';
import { bestCards } from './litera';
import { vocabOf } from './loss';
import { transformerFromJson } from './transformer';
import { WEIGHTS } from './weights';

const prefix = process.argv[2] ?? 'Продам ';
const started = performance.now();
const cards = bestCards(transformerFromJson(WEIGHTS), vocabOf(CORPUS), prefix, 3, {
  seed: 1,
  topK: 8,
});
for (const { text, perplexity } of cards) console.log(`${perplexity.toFixed(2)}  ${text}`);
console.log(
  `Цена запуска: $0, считала твоя машина ${((performance.now() - started) / 1000).toFixed(1)} с.`,
);
