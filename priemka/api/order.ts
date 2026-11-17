import type OpenAI from 'openai';
import type {
  ChatCompletion,
  ChatCompletionCreateParamsNonStreaming,
  ChatCompletionMessageParam,
} from 'openai/resources/chat/completions';
import * as z from 'zod';

import type { Letter, Order, Usage } from '../contracts';
import { addUsage, letterText, NO_USAGE, toUsage } from './chat';
import { formatFields, structuredText } from './structured';

export const OrderItemSchema = z.strictObject({
  product: z.enum(['business-cards', 'flyers', 'booklets', 'posters', 'stickers', 'menus', 'certificates']),
  quantity: z.number().int().positive().nullable(),
  format: z.string().min(1).nullable(),
  paper: z
    .enum(['offset-80', 'coated-130', 'coated-170', 'coated-300', 'carton-250', 'design-300', 'sticker-film'])
    .nullable(),
  colors: z.enum(['4+0', '4+4', '1+0']).nullable(),
  finishing: z.array(
    z.enum(['lamination-matte', 'lamination-gloss', 'folding', 'creasing', 'rounding', 'die-cut']),
  ),
});

/** Схема заказа: форма из contracts.ts плюс то, чего строгий режим провайдера не держит. */
export const OrderSchema = z.strictObject({
  customer: z.string().min(1),
  items: z.array(OrderItemSchema).min(1),
  deadline: z.iso.date().nullable(),
  rush: z.boolean(),
  questions: z.array(z.string()),
}) satisfies z.ZodType<Order>;

export type Parsed =
  | { readonly ok: true; readonly order: Order }
  | { readonly ok: false; readonly error: string };

/** Дешёвый ремонт до повтора: снять обёртку ```json и всё до первой `{` и после последней `}`. */
export const repairJson = (raw: string): string => {
  const unfenced = raw.replace(/```(?:json)?/gi, '');
  const start = unfenced.indexOf('{');
  const end = unfenced.lastIndexOf('}');
  return start === -1 || end < start ? unfenced.trim() : unfenced.slice(start, end + 1);
};

const RU = { error: z.locales.ru().localeError };

/** Ответ модели в заказ: ремонт, JSON, схема, срок не раньше дня письма. Ошибки строками `путь: что не так`. */
export const parseOrder = (raw: string, receivedAt: string): Parsed => {
  let value: unknown;
  try {
    value = JSON.parse(repairJson(raw));
  } catch {
    return { ok: false, error: `(корень): ответ не JSON: ${raw.slice(0, 40)}` };
  }
  const day = receivedAt.slice(0, 10);
  const result = OrderSchema.refine((order) => order.deadline === null || order.deadline >= day, {
    path: ['deadline'],
    message: `срок раньше дня письма (${day})`,
  }).safeParse(value, RU);
  if (result.success) return { ok: true, order: result.data };
  const error = result.error.issues
    .map((issue) => `${issue.path.join('.') || '(корень)'}: ${issue.message}`)
    .join('\n');
  return { ok: false, error };
};

/** Как уходит один запрос к модели. По умолчанию прямо клиентом; этап 6 подставит повторы. */
export type Send = (body: ChatCompletionCreateParamsNonStreaming) => Promise<ChatCompletion>;

export type Extract = {
  readonly model: string;
  readonly system: string;
  readonly letter: Letter;
};

export type Extracted = {
  readonly order: Order;
  /** Сколько ответов модели понадобилось. */
  readonly attempts: number;
  readonly usage: Usage;
};

/** Модель так и не прислала заказ, который прошёл проверку; `error` это последняя ошибка проверки. */
export class OrderRejected extends Error {
  override readonly name = 'OrderRejected';
  constructor(
    readonly error: string,
    readonly attempts: number,
    readonly usage: Usage,
  ) {
    super(`заказ не прошёл проверку (попыток: ${attempts}): ${error}`);
  }
}

export const extractOrder = async (
  client: OpenAI,
  input: Extract,
  options: { readonly maxAttempts?: number; readonly send?: Send } = {},
): Promise<Extracted> => {
  const maxAttempts = options.maxAttempts ?? 2;
  const send: Send = options.send ?? ((body) => client.chat.completions.create(body));
  const messages: ChatCompletionMessageParam[] = [
    { role: 'system', content: input.system },
    { role: 'user', content: letterText(input.letter) },
  ];
  let usage = NO_USAGE;
  let error = '';
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const response = await send({
      model: input.model,
      messages: [...messages],
      ...formatFields('json_schema'),
    });
    usage = addUsage(usage, toUsage(response.usage));
    const choice = response.choices[0];
    const raw = choice ? structuredText(choice.message, 'json_schema') : '';
    const parsed: Parsed =
      choice?.finish_reason === 'length'
        ? { ok: false, error: '(корень): ответ обрезан лимитом токенов' }
        : parseOrder(raw, input.letter.receivedAt);
    if (parsed.ok) return { order: parsed.order, attempts: attempt, usage };
    error = parsed.error;
    messages.push(
      { role: 'assistant', content: raw },
      {
        role: 'user',
        content: `Ответ не прошёл проверку:\n${error}\nИсправь и пришли заказ целиком.`,
      },
    );
  }
  throw new OrderRejected(error, maxAttempts, usage);
};
