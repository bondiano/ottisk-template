import { Console, Effect } from 'effect';

import { cost, DEEPSEEK_FLASH, makeClient } from './client';
import { loadConfig, readEnvFile } from './config';
import { ConfigError, RunError } from './errors';
import { answer } from './reception';

const program = Effect.gen(function* () {
  yield* readEnvFile();
  const config = yield* loadConfig();
  const { client, model } = makeClient(config);
  const question = process.argv[2] ?? 'Сколько стоят 500 визиток?';

  const reply = yield* Effect.tryPromise({
    try: () => answer(client, model, question),
    catch: (cause) =>
      new RunError({
        message: cause instanceof Error ? cause.message : String(cause),
        cause,
      }),
  });

  yield* Console.log(`Клиент: ${question}`);
  yield* Console.log(`Приёмщик (${model}): ${reply.text}`);
  yield* Console.log(
    `Токены: ${reply.promptTokens} на входе, ${reply.completionTokens} на выходе`,
  );

  if (config.model === 'deepseek') {
    const offPeak = cost(reply.promptTokens, reply.completionTokens, DEEPSEEK_FLASH.offPeak);
    const peak = cost(reply.promptTokens, reply.completionTokens, DEEPSEEK_FLASH.peak);
    yield* Console.log(
      `Цена запуска: $${offPeak.toFixed(6)} вне пика, $${peak.toFixed(6)} в пик (цены на ${DEEPSEEK_FLASH.checked})`,
    );
  } else {
    yield* Console.log(
      'Цена запуска: $0, это Болванка. С MODEL=deepseek здесь будет цена в долларах.',
    );
  }
});

const exitMessage = (error: ConfigError | RunError): string =>
  error instanceof ConfigError ? `Конфиг: ${error.message}` : error.message;

Effect.runPromise(
  program.pipe(
    Effect.catch((error) =>
      Effect.sync(() => {
        console.error(exitMessage(error));
        process.exitCode = 1;
      }),
    ),
  ),
);
