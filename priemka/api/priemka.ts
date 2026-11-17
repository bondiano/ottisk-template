import type OpenAI from 'openai';

import type { IntakeRun, Layout, LayoutIssue, Letter, Order, Tariff, Usage } from '../contracts';
import { quote } from '../fixtures/prices';
import { addUsage, NO_USAGE, toUsage } from './chat';
import { reviewLayout } from './layout';
import { costUsd, type Ledger, QuotaExceeded, queue } from './limits';
import { extractOrder, OrderRejected, type Send } from './order';
import { type RetryOptions, withRetry } from './retry';

export type PriemkaOptions = RetryOptions & {
  readonly model: string;
  readonly system: string;
  readonly tariff: Tariff;
  /** Когда идёт запрос: от часа зависит цена (пик и не пик). */
  readonly now: () => Date;
  readonly ledger: Ledger;
  /** Макет по id из вложения; `undefined`, если такого нет. */
  readonly layouts: (id: string) => Layout | undefined;
  /** Ожидание места у лимита запросов перед каждым запросом к модели. */
  readonly limit?: () => Promise<void>;
  readonly timeoutMs?: number;
  /** Попыток получить заказ, который проходит схему. */
  readonly maxAttempts?: number;
};

const run = (letter: Letter, fields: Partial<IntakeRun>): IntakeRun => ({
  letterId: letter.id,
  status: 'done',
  order: null,
  reasons: [],
  layoutIssues: [],
  usage: NO_USAGE,
  costUsd: 0,
  modelCalls: 0,
  ...fields,
});

const message = (error: unknown): string => (error instanceof Error ? error.message : String(error));

/** Письмо в проверенный заказ: квота, лимит, повторы, схема, макеты, смета и цена прогона. */
export const intake = async (
  client: OpenAI,
  letter: Letter,
  options: PriemkaOptions,
): Promise<IntakeRun> => {
  try {
    options.ledger.check(letter.client);
  } catch (error) {
    if (error instanceof QuotaExceeded) return run(letter, { status: 'stopped', reasons: [error.message] });
    throw error;
  }
  let modelCalls = 0;
  let usage: Usage = NO_USAGE;
  const send: Send = (body) =>
    withRetry(async () => {
      await options.limit?.();
      modelCalls++;
      const response = await client.chat.completions.create(body, {
        maxRetries: 0,
        timeout: options.timeoutMs ?? 30_000,
      });
      usage = addUsage(usage, toUsage(response.usage));
      return response;
    }, options);
  const finish = (fields: Partial<IntakeRun>): IntakeRun => {
    const cost = costUsd(usage, options.tariff, options.now());
    options.ledger.charge(letter.client, cost);
    return run(letter, { usage, costUsd: cost, modelCalls, ...fields });
  };

  let order: Order;
  try {
    ({ order } = await extractOrder(
      client,
      { model: options.model, system: options.system, letter },
      { send, ...(options.maxAttempts === undefined ? {} : { maxAttempts: options.maxAttempts }) },
    ));
  } catch (error) {
    return finish({
      status: error instanceof OrderRejected ? 'needs-human' : 'failed',
      reasons: [message(error)],
    });
  }

  const layoutIssues: LayoutIssue[] = [];
  const reasons: string[] = [...order.questions];
  for (const attachment of letter.attachments) {
    if (attachment.layout === undefined) continue;
    const layout = options.layouts(attachment.layout);
    if (!layout) {
      reasons.push(`нет данных макета ${attachment.name}`);
      continue;
    }
    const review = await reviewLayout(client, layout, { model: options.model, send });
    layoutIssues.push(...review.issues);
  }
  reasons.push(...layoutIssues.map((issue) => `${issue.page === null ? '' : `стр. ${issue.page}: `}${issue.message}`));
  if (order.items.every((item) => item.quantity !== null)) {
    try {
      quote(order.items, order.rush);
    } catch (error) {
      reasons.push(message(error));
    }
  }
  return finish({ status: reasons.length === 0 ? 'done' : 'needs-human', order, reasons, layoutIssues });
};

/** Пачка писем: не больше `concurrency` сразу, итоги в порядке писем и общая цена. */
export const intakeBatch = async (
  client: OpenAI,
  letters: readonly Letter[],
  options: PriemkaOptions & { readonly concurrency: number },
): Promise<{ readonly runs: readonly IntakeRun[]; readonly costUsd: number }> => {
  const line = queue(options.concurrency);
  const runs = await Promise.all(letters.map((letter) => line(() => intake(client, letter, options))));
  return { runs, costUsd: runs.reduce((sum, item) => sum + item.costUsd, 0) };
};
