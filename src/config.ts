/**
Конфиг шаблона из `.env`. Проверяется на старте: если чего-то не хватает,
команда говорит, какой переменной, и не ходит в сеть.
*/
import { Effect, Match, Schema } from 'effect';

import { ConfigError } from './errors';

export type Config =
  | { readonly model: 'bolvanka' }
  | { readonly model: 'deepseek'; readonly apiKey: string };

const HelloModel = Schema.Literals(['bolvanka', 'deepseek']);

/** Прочитать `.env` в `process.env`, если файл есть. */
export const readEnvFile = (): Effect.Effect<void> =>
  Effect.sync(() => {
    try {
      process.loadEnvFile();
    } catch {
      // Файла .env нет: остаются переменные окружения и значения по умолчанию.
    }
  });

/**
Конфиг для `pnpm hello`: Болванка без ключа или DeepSeek с `DEEPSEEK_API_KEY`.
*/
export const loadConfig = (
  env: NodeJS.ProcessEnv = process.env,
): Effect.Effect<Config, ConfigError> =>
  Effect.gen(function* () {
    const raw = env['MODEL'] ?? 'bolvanka';
    const model = yield* Schema.decodeUnknownEffect(HelloModel)(raw).pipe(
      Effect.mapError(
        () => new ConfigError({ message: `MODEL=${raw}: бывает bolvanka или deepseek` }),
      ),
    );
    return yield* Match.value(model).pipe(
      Match.when('bolvanka', () => Effect.succeed({ model: 'bolvanka' as const })),
      Match.when('deepseek', () => {
        const apiKey = env['DEEPSEEK_API_KEY'];
        if (!apiKey) {
          return Effect.fail(
            new ConfigError({ message: 'MODEL=deepseek, но DEEPSEEK_API_KEY в .env пуст' }),
          );
        }
        return Effect.succeed({ model: 'deepseek' as const, apiKey });
      }),
      Match.exhaustive,
    );
  });
