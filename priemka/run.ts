import { randomUUID } from 'node:crypto';

import { Console, Effect } from 'effect';
import OpenAI from 'openai';

import { readEnvFile } from '../src/config';
import { ConfigError, RunError } from '../src/errors';
import { isPeak, ledger, rateLimiter } from './api/limits';
import { intakeBatch } from './api/priemka';
import { connect, type Env, gigachatOAuth } from './api/providers';
import { bolvanka } from './bolvanka';
import type { IntakeRun, Usage } from './contracts';
import { LAYOUTS } from './fixtures/layouts';
import { letter } from './fixtures/letters';
import { RUB_PER_USD, TARIFFS } from './fixtures/tariffs';
import { MORNING, scenario } from './scenario';

/**
`pnpm priemka [L01 L13 …]`: «Приёмка» урока 126 на письмах из fixtures/letters.ts.
MODEL=bolvanka (по умолчанию) идёт без сети и ключа, deepseek, openrouter, yandex и
gigachat с ключами из `.env`. Конфиг проверяется до первого запроса.
*/
const SYSTEM = [
  'Ты «Приёмка», помощник менеджера заказов типографии «Оттиск». Из письма клиента заполни бланк заказа по схеме.',
  '* customer: как подписан клиент, фирма или имя.',
  '* items: позиция на каждое изделие; product, paper, colors и finishing только из перечислений схемы. 4+4 это печать с двух сторон, 4+0 с одной.',
  '* Чего в письме нет, то null: тираж, бумагу и срок не придумывай.',
  '* deadline: дата YYYY-MM-DD, считай от даты «Получено»; срок неоднозначен, тогда null и вопрос.',
  '* rush: true, только если клиент просит срочно.',
  '* questions: что менеджеру уточнить у клиента; пустой массив, если всё ясно.',
  '* Скидок, цен и обещаний в бланке нет: их решает человек.',
].join('\n');

/** У GigaChat вместо ключа токен на 30 минут: берём его по ключу авторизации, если готового нет. */
const gigachatToken = (env: Env): Effect.Effect<Env, ConfigError> =>
  Effect.gen(function* () {
    const authKey = env['GIGACHAT_AUTH_KEY']?.trim();
    if (env['GIGACHAT_ACCESS_TOKEN']?.trim() || !authKey) return env;
    const { url, init } = gigachatOAuth(authKey, randomUUID());
    const response = yield* Effect.tryPromise({
      try: () => fetch(url, init),
      catch: (cause) =>
        new ConfigError({
          message: cause instanceof Error ? cause.message : String(cause),
        }),
    });
    const body = (yield* Effect.promise(() =>
      response.json().catch(() => ({})),
    )) as { access_token?: string };
    if (!response.ok || !body.access_token) {
      return yield* new ConfigError({
        message: `GigaChat не выдал токен (${response.status}): проверь GIGACHAT_AUTH_KEY`,
      });
    }
    return { ...env, GIGACHAT_ACCESS_TOKEN: body.access_token };
  });

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));
const now = () => new Date();

const setup = Effect.gen(function* () {
  yield* readEnvFile();
  const provider = process.env['MODEL']?.trim() || 'bolvanka';
  const ids = process.argv.slice(2);
  const letters = (ids.length > 0 ? ids : [...MORNING]).map(letter);
  const env = provider === 'gigachat' ? yield* gigachatToken(process.env) : process.env;
  const connection = yield* Effect.try({
    try: () => connect(provider, env),
    catch: (error) => {
      const cause =
        error instanceof Error && error.cause instanceof Error ? `: ${error.cause.message}` : '';
      const message = error instanceof Error ? `${error.message}${cause}` : String(error);
      return new ConfigError({
        message: message.includes('GIGACHAT_ACCESS_TOKEN')
          ? 'нет ключа: задай GIGACHAT_AUTH_KEY (или GIGACHAT_ACCESS_TOKEN, он живёт 30 минут)'
          : message,
      });
    },
  });
  return { letters, connection };
});

const line = (run: IntakeRun): string => {
  const order = run.order;
  const what = order
    ? `${order.customer}: ${order.items
        .map((item) => `${item.product} ${item.quantity ?? '?'} шт. ${item.format ?? ''}`.trim())
        .join(', ')}, срок ${order.deadline ?? 'не указан'}`
    : 'заказа нет';
  return [
    `${run.letterId} ${run.status.padEnd(11)} ${what} · запросов ${run.modelCalls}`,
    ...run.reasons.map((reason) => `    ${reason}`),
  ].join('\n');
};

const program = Effect.gen(function* () {
  const { letters, connection } = yield* setup;
  const client = new OpenAI({
    ...connection.options,
    ...(connection.provider === 'bolvanka' ? { fetch: bolvanka(scenario).fetch } : {}),
  });
  const tariff = TARIFFS[connection.model];
  const priced = tariff ?? TARIFFS['deepseek-flash']!;

  yield* Console.log(
    `«Приёмка» на ${connection.provider}, модель ${connection.model}, писем ${letters.length}\n`,
  );
  const started = Date.now();
  const batch = yield* Effect.tryPromise({
    try: () =>
      intakeBatch(client, letters, {
        model: connection.model,
        system: SYSTEM,
        tariff: priced,
        now,
        sleep,
        ledger: ledger(0.05),
        limit: rateLimiter({ perMinute: 30, now: Date.now, sleep }),
        layouts: (id) => LAYOUTS.find((item) => item.id === id),
        concurrency: 2,
      }),
    catch: (cause) =>
      new RunError({
        message: cause instanceof Error ? cause.message : String(cause),
        cause,
      }),
  });

  for (const run of batch.runs) yield* Console.log(line(run));

  const usage = batch.runs.reduce<Usage>(
    (sum, run) => ({
      inputTokens: sum.inputTokens + run.usage.inputTokens,
      cachedTokens: sum.cachedTokens + run.usage.cachedTokens,
      outputTokens: sum.outputTokens + run.usage.outputTokens,
    }),
    { inputTokens: 0, cachedTokens: 0, outputTokens: 0 },
  );
  const count = (status: IntakeRun['status']) =>
    batch.runs.filter((run) => run.status === status).length;
  const calls = batch.runs.reduce((sum, run) => sum + run.modelCalls, 0);
  const hour = isPeak(priced, now()) ? 'в пик' : 'вне пика';
  const usd = batch.costUsd;
  const rub = `${(usd * RUB_PER_USD).toFixed(2)} ₽ по учебному курсу ${RUB_PER_USD} ₽ за доллар, не по биржевому`;

  yield* Console.log(
    `\nИтог: готово ${count('done')}, человеку ${count('needs-human')}, остановлено ${count('stopped')}, упало ${count('failed')} за ${((Date.now() - started) / 1000).toFixed(1)} с`,
  );
  yield* Console.log(`Запросов к модели: ${calls}`);
  yield* Console.log(
    `Токены: ${usage.inputTokens} на входе (из них ${usage.cachedTokens} из кэша), ${usage.outputTokens} на выходе`,
  );
  if (connection.provider === 'bolvanka') {
    yield* Console.log(
      `Цена прогона: $0, это Болванка. По тарифу ${priced.model} ${hour} было бы $${usd.toFixed(6)}, ${rub}.`,
    );
  } else if (tariff) {
    yield* Console.log(
      `Цена прогона: $${usd.toFixed(6)} по тарифу ${tariff.model} ${hour} (цены на 2026-11-11), ${rub}.`,
    );
  } else {
    yield* Console.log(
      `Цена прогона: тарифа ${connection.model} в шаблоне нет, умножь токены на цены провайдера. По тарифу ${priced.model} ${hour} это было бы $${usd.toFixed(6)}.`,
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
