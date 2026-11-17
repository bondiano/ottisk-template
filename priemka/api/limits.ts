import type { Clock, Price, Tariff, Usage } from '../contracts';

/** Пик по UTC: день недели из `peakDays` и час внутри одного из окон `[с, до)`. */
export const isPeak = (tariff: Tariff, at: Date): boolean => {
  const hour = at.getUTCHours();
  return (
    tariff.peakDays.includes(at.getUTCDay()) &&
    tariff.peakHoursUtc.some(([from, to]) => hour >= from && hour < to)
  );
};

/** Цена ответа в долларах: кэшированный вход по своей цене, остальной вход и выход по своей. */
export const costUsd = (usage: Usage, tariff: Tariff, at: Date): number => {
  const price: Price = isPeak(tariff, at) ? tariff.peak : tariff.offPeak;
  return (
    ((usage.inputTokens - usage.cachedTokens) * price.input +
      usage.cachedTokens * price.cachedInput +
      usage.outputTokens * price.output) /
    1_000_000
  );
};

/** Очередь: не больше `concurrency` задач сразу, остальные ждут по порядку прихода. */
export const queue = (concurrency: number) => {
  let running = 0;
  const waiting: (() => void)[] = [];
  return async <T>(task: () => Promise<T>): Promise<T> => {
    if (running >= concurrency) await new Promise<void>((resolve) => waiting.push(resolve));
    else running++;
    try {
      return await task();
    } finally {
      // Место переходит следующему прямо из рук в руки: иначе его перехватит новый вызов.
      const next = waiting.shift();
      if (next) next();
      else running--;
    }
  };
};

/** Не больше `perMinute` запросов за любые 60 секунд: лишний ждёт, пока старый выйдет из окна. */
export const rateLimiter = (options: {
  readonly perMinute: number;
  readonly now: Clock;
  readonly sleep: (ms: number) => Promise<void>;
}) => {
  const granted: number[] = [];
  return async (): Promise<void> => {
    for (;;) {
      const now = options.now();
      while (granted.length > 0 && (granted[0] ?? 0) <= now - 60_000) granted.shift();
      if (granted.length < options.perMinute) {
        granted.push(now);
        return;
      }
      await options.sleep((granted[0] ?? now) + 60_000 - now);
    }
  };
};

/** Квота клиента исчерпана: запрос к модели не уходит. */
export class QuotaExceeded extends Error {
  override readonly name = 'QuotaExceeded';
}

export type Ledger = {
  /** Бросает `QuotaExceeded`, если клиент уже потратил бюджет. */
  readonly check: (client: string) => void;
  readonly charge: (client: string, usd: number) => void;
  readonly spent: (client: string) => number;
};

/** Учёт денег по клиентам с бюджетом на каждого в долларах. */
export const ledger = (budgetUsd: number): Ledger => {
  const spent = new Map<string, number>();
  return {
    check: (client) => {
      const used = spent.get(client) ?? 0;
      if (used >= budgetUsd) {
        throw new QuotaExceeded(
          `квота клиента ${client} исчерпана: потрачено $${used.toFixed(4)} из $${budgetUsd.toFixed(4)}`,
        );
      }
    },
    charge: (client, usd) => spent.set(client, (spent.get(client) ?? 0) + usd),
    spent: (client) => spent.get(client) ?? 0,
  };
};
