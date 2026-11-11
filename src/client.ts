import OpenAI from 'openai';

import { bolvanka } from './bolvanka';
import type { Config } from './config';
import { scenario } from './scenario';

/** Один и тот же код приёмщика, два клиента: Болванка без сети и DeepSeek со своим ключом. */
export const makeClient = (config: Config): { client: OpenAI; model: string } =>
  config.model === 'deepseek'
    ? {
        client: new OpenAI({ baseURL: 'https://api.deepseek.com', apiKey: config.apiKey }),
        model: 'deepseek-flash',
      }
    : {
        client: new OpenAI({
          baseURL: 'http://bolvanka/v1',
          apiKey: 'bolvanka',
          fetch: bolvanka(scenario).fetch,
        }),
        model: 'bolvanka',
      };

/** Цены `deepseek-flash` за миллион токенов: вход без кэша и выход (api-docs.deepseek.com, 2026-11-11). */
export const DEEPSEEK_FLASH = {
  offPeak: { input: 0.15, output: 0.6 },
  peak: { input: 0.3, output: 1.2 },
  checked: '2026-11-11',
} as const;

export const cost = (
  promptTokens: number,
  completionTokens: number,
  rate: { input: number; output: number },
): number => (promptTokens * rate.input + completionTokens * rate.output) / 1_000_000;
