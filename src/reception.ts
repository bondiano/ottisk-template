import type OpenAI from 'openai';
import type { ChatCompletionMessageParam } from 'openai/resources/chat/completions';

/**
Приёмщик «Оттиска» на одном инструменте. Клиент модели приходит параметром:
в проверке это Болванка, у себя в шаблоне `ottisk-template` это DeepSeek.
*/
export const SYSTEM = 'Ты приёмщик типографии «Оттиск». Цены бери только из инструмента price.';

/** Цена за штуку, ₽. */
export const PRICES: Readonly<Record<string, number>> = { визитки: 9, листовки: 4, буклеты: 35 };

const PRICE_TOOL = {
  type: 'function' as const,
  function: {
    name: 'price',
    description: 'Цена тиража по прайсу «Оттиска»',
    parameters: {
      type: 'object',
      properties: {
        item: { type: 'string', description: 'визитки, листовки или буклеты' },
        copies: { type: 'integer', description: 'тираж, штук' },
      },
      required: ['item', 'copies'],
    },
  },
};

const price = (args: string): string => {
  const { item, copies } = JSON.parse(args) as { item: string; copies: number };
  const each = PRICES[item];
  return each === undefined
    ? JSON.stringify({ error: `в прайсе нет «${item}»` })
    : JSON.stringify({ item, copies, total: each * copies });
};

export type Answer = {
  readonly text: string;
  readonly promptTokens: number;
  readonly completionTokens: number;
};

/** Ответ на вопрос клиента: модель может позвать price, тогда ей отдаётся результат. */
export const answer = async (client: OpenAI, model: string, question: string): Promise<Answer> => {
  const messages: ChatCompletionMessageParam[] = [
    { role: 'system', content: SYSTEM },
    { role: 'user', content: question },
  ];
  let promptTokens = 0;
  let completionTokens = 0;
  for (let step = 0; step < 3; step++) {
    const response = await client.chat.completions.create({ model, messages, tools: [PRICE_TOOL] });
    promptTokens += response.usage?.prompt_tokens ?? 0;
    completionTokens += response.usage?.completion_tokens ?? 0;
    const message = response.choices[0]?.message;
    if (!message) throw new Error('модель не ответила');
    messages.push(message);
    const calls = (message.tool_calls ?? []).filter((call) => call.type === 'function');
    if (calls.length === 0) return { text: message.content ?? '', promptTokens, completionTokens };
    for (const call of calls) {
      messages.push({
        role: 'tool',
        tool_call_id: call.id,
        content: price(call.function.arguments),
      });
    }
  }
  throw new Error('приёмщик не ответил за три шага');
};
