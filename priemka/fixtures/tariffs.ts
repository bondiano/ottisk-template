/**
Цены DeepSeek за миллион токенов в долларах, проверено 2026-11-11 по
api-docs.deepseek.com (docs/LLM_AGENTS_SOURCES.md §1). Пик 01:00-04:00 и
06:00-10:00 UTC с понедельника по пятницу (04:00-07:00 и 09:00-13:00 по Москве),
вне пика вдвое дешевле. Праздники КНР здесь не учтены.
*/
import type { Tariff } from '../contracts';

const PEAK = {
  peakDays: [1, 2, 3, 4, 5],
  peakHoursUtc: [
    [1, 4],
    [6, 10],
  ],
} as const;

export const TARIFFS: Readonly<Record<string, Tariff>> = {
  'deepseek-flash': {
    model: 'deepseek-flash',
    offPeak: { input: 0.15, cachedInput: 0.003, output: 0.6 },
    peak: { input: 0.3, cachedInput: 0.006, output: 1.2 },
    ...PEAK,
  },
  'deepseek-v4-pro': {
    model: 'deepseek-v4-pro',
    offPeak: { input: 0.66, cachedInput: 0.022, output: 1.98 },
    peak: { input: 1.32, cachedInput: 0.044, output: 3.96 },
    ...PEAK,
  },
};

/** Учебный курс для пересчёта в рубли, не биржевой: у себя подставь курс на дату. */
export const RUB_PER_USD = 90;
