/**
Конфиг шаблона из `.env`. Проверяется на старте: если чего-то не хватает,
команда говорит, какой переменной, и не ходит в сеть.
*/
export type Config =
  { readonly model: 'bolvanka' } | { readonly model: 'deepseek'; readonly apiKey: string };

export const loadConfig = (env: NodeJS.ProcessEnv = process.env): Config => {
  const model = env['MODEL'] ?? 'bolvanka';
  if (model === 'bolvanka') return { model };
  if (model !== 'deepseek') throw new Error(`MODEL=${model}: бывает bolvanka или deepseek`);
  const apiKey = env['DEEPSEEK_API_KEY'];
  if (!apiKey) throw new Error('MODEL=deepseek, но DEEPSEEK_API_KEY в .env пуст');
  return { model, apiKey };
};

export const readEnvFile = (): void => {
  try {
    process.loadEnvFile();
  } catch {
    // Файла .env нет: остаются переменные окружения и значения по умолчанию.
  }
};
