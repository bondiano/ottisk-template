import type OpenAI from 'openai';
import { APIConnectionError, APIError } from 'openai';

import type { Letter, Order } from '../contracts';
import { extractOrder, type Extract, type Send } from './order';
import { StreamCut } from './stream';

/** Временная ошибка не модели (трекер, база): её можно повторить. */
export class Temporary extends Error {
  override readonly name = 'Temporary';
}

export type RetryOptions = {
  /** Всего попыток, вместе с первой. */
  readonly maxAttempts?: number;
  readonly baseMs?: number;
  readonly maxMs?: number;
  readonly sleep: (ms: number) => Promise<void>;
  readonly random?: () => number;
};

/** Полный джиттер: случайная пауза от нуля до `baseMs · 2^(попытка−1)`, не больше `maxMs`. */
export const backoffMs = (attempt: number, random: () => number, baseMs = 500, maxMs = 8000): number =>
  Math.round(random() * Math.min(maxMs, baseMs * 2 ** (attempt - 1)));

/** Что повторять: лимит частоты, сбой сервера, таймаут, обрыв; не повторять квоту, ключ и кривой запрос. */
export const retryable = (error: unknown): boolean => {
  if (error instanceof StreamCut || error instanceof Temporary) return true;
  if (error instanceof APIConnectionError) return true;
  if (!(error instanceof APIError) || error.status === undefined) return false;
  if (error.status === 429) return error.code !== 'insufficient_quota';
  return error.status === 408 || error.status === 409 || error.status >= 500;
};

/** `retry-after` в секундах из ответа провайдера, в миллисекундах; `null`, если заголовка нет. */
export const retryAfterMs = (error: unknown): number | null => {
  const header = error instanceof APIError ? error.headers?.get('retry-after') : null;
  const seconds = header ? Number(header) : Number.NaN;
  return Number.isFinite(seconds) ? seconds * 1000 : null;
};

export const withRetry = async <T>(
  call: (attempt: number) => Promise<T>,
  options: RetryOptions,
): Promise<T> => {
  const maxAttempts = options.maxAttempts ?? 3;
  const random = options.random ?? Math.random;
  for (let attempt = 1; ; attempt++) {
    try {
      return await call(attempt);
    } catch (error) {
      if (attempt >= maxAttempts || !retryable(error)) throw error;
      const pause = backoffMs(attempt, random, options.baseMs, options.maxMs);
      await options.sleep(Math.max(pause, retryAfterMs(error) ?? 0));
    }
  }
};

/** Запрос к модели с повторами; повторы самого SDK выключены, иначе попытки умножаются. */
export const sendWithRetry = (
  client: OpenAI,
  options: RetryOptions & { readonly timeoutMs?: number },
): Send => {
  const timeout = options.timeoutMs ?? 30_000;
  return (body) => withRetry(() => client.chat.completions.create(body, { maxRetries: 0, timeout }), options);
};

/** Один черновик на письмо, сколько бы раз его ни сохраняли. */
export const idempotencyKey = (letter: Letter): string => `draft:${letter.client}:${letter.id}`;

export type SaveDraft = (order: Order, key: string) => Promise<string>;

/**
Письмо в черновик: модель с повторами, потом черновик со своими повторами и тем же
ключом. Сбой черновика не спрашивает модель заново.
*/
export const draftWithRetry = async (
  client: OpenAI,
  input: Extract,
  options: RetryOptions & { readonly timeoutMs?: number; readonly saveDraft: SaveDraft },
): Promise<{ readonly order: Order; readonly draftId: string }> => {
  const { order } = await extractOrder(client, input, { send: sendWithRetry(client, options) });
  const key = idempotencyKey(input.letter);
  const draftId = await withRetry(() => options.saveDraft(order, key), options);
  return { order, draftId };
};
