import { cost, DEEPSEEK_FLASH, makeClient } from './client';
import { loadConfig, readEnvFile } from './config';
import { answer } from './reception';

readEnvFile();
const config = loadConfig();
const { client, model } = makeClient(config);
const question = process.argv[2] ?? 'Сколько стоят 500 визиток?';

const reply = await answer(client, model, question);
console.log(`Клиент: ${question}`);
console.log(`Приёмщик (${model}): ${reply.text}`);
console.log(`Токены: ${reply.promptTokens} на входе, ${reply.completionTokens} на выходе`);
if (config.model === 'deepseek') {
  const offPeak = cost(reply.promptTokens, reply.completionTokens, DEEPSEEK_FLASH.offPeak);
  const peak = cost(reply.promptTokens, reply.completionTokens, DEEPSEEK_FLASH.peak);
  console.log(
    `Цена запуска: $${offPeak.toFixed(6)} вне пика, $${peak.toFixed(6)} в пик (цены на ${DEEPSEEK_FLASH.checked})`,
  );
} else {
  console.log('Цена запуска: $0, это Болванка. С MODEL=deepseek здесь будет цена в долларах.');
}
