import type OpenAI from 'openai';
import type {
  ChatCompletionCreateParamsNonStreaming,
  ChatCompletionMessage,
} from 'openai/resources/chat/completions';

import type { Usage } from '../contracts';
import { type CallOptions, messagesFor, toUsage } from './chat';

const nullable = (values: readonly string[]) => ({ type: ['string', 'null'], enum: [...values, null] });

/**
JSON Schema заказа (`Order` из contracts.ts) для строгого режима: все поля обязательны,
лишних полей нет, «не знаю» это `null`. Ограничения вроде «тираж больше нуля»
строгий режим не держит, их проверяет Zod (этап 5).
*/
export const ORDER_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['customer', 'items', 'deadline', 'rush', 'questions'],
  properties: {
    customer: { type: 'string', description: 'Как подписан клиент' },
    items: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['product', 'quantity', 'format', 'paper', 'colors', 'finishing'],
        properties: {
          product: {
            type: 'string',
            enum: ['business-cards', 'flyers', 'booklets', 'posters', 'stickers', 'menus', 'certificates'],
          },
          quantity: { type: ['integer', 'null'], description: 'Тираж; null, если в письме его нет' },
          format: { type: ['string', 'null'], description: 'A5, 90x50, d50' },
          paper: nullable([
            'offset-80',
            'coated-130',
            'coated-170',
            'coated-300',
            'carton-250',
            'design-300',
            'sticker-film',
          ]),
          colors: nullable(['4+0', '4+4', '1+0']),
          finishing: {
            type: 'array',
            items: {
              type: 'string',
              enum: ['lamination-matte', 'lamination-gloss', 'folding', 'creasing', 'rounding', 'die-cut'],
            },
          },
        },
      },
    },
    deadline: { type: ['string', 'null'], description: 'YYYY-MM-DD; null, если срока нет или он неоднозначен' },
    rush: { type: 'boolean' },
    questions: { type: 'array', items: { type: 'string' }, description: 'Что уточнить у клиента' },
  },
} as const;

/** Как попросить у модели JSON: режим JSON, генерация по схеме или вызов инструмента. */
export type Format = 'json_object' | 'json_schema' | 'tool';

export const SAVE_ORDER = 'save_order';

/** Поля запроса под формат. */
export const formatFields = (format: Format): Partial<ChatCompletionCreateParamsNonStreaming> =>
  format === 'json_object'
    ? { response_format: { type: 'json_object' } }
    : format === 'json_schema'
      ? {
          response_format: {
            type: 'json_schema',
            json_schema: { name: 'order', strict: true, schema: ORDER_SCHEMA },
          },
        }
      : {
          tools: [
            {
              type: 'function',
              function: {
                name: SAVE_ORDER,
                description: 'Сохранить заказ из письма клиента',
                strict: true,
                parameters: ORDER_SCHEMA,
              },
            },
          ],
          tool_choice: { type: 'function', function: { name: SAVE_ORDER } },
        };

/** Режим JSON у DeepSeek и OpenAI требует слова «json» в промпте. */
export const jsonSystem = (system: string): string =>
  /json/i.test(system) ? system : `${system}\nОтветь одним объектом JSON.`;

/** Строка JSON из ответа: текст сообщения или аргументы вызова `save_order`. */
export const structuredText = (message: ChatCompletionMessage, format: Format): string => {
  if (format !== 'tool') return message.content ?? '';
  const call = (message.tool_calls ?? []).find(
    (item) => item.type === 'function' && item.function.name === SAVE_ORDER,
  );
  if (call?.type !== 'function') throw new Error(`модель не вызвала ${SAVE_ORDER}`);
  return call.function.arguments;
};

export type Structured = {
  readonly value: unknown;
  readonly raw: string;
  readonly usage: Usage;
  readonly finishReason: string;
};

export const askStructured = async (
  client: OpenAI,
  request: { readonly model: string; readonly system: string; readonly user: string; readonly format: Format },
  options?: CallOptions,
): Promise<Structured> => {
  const system = request.format === 'json_object' ? jsonSystem(request.system) : request.system;
  const response = await client.chat.completions.create(
    { model: request.model, messages: messagesFor(system, request.user), ...formatFields(request.format) },
    options,
  );
  const choice = response.choices[0];
  if (!choice) throw new Error('модель не вернула ответа');
  if (choice.finish_reason === 'length') throw new Error('ответ обрезан лимитом токенов');
  const raw = structuredText(choice.message, request.format);
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    throw new Error(`ответ не JSON: ${raw.slice(0, 40)}`);
  }
  return { value, raw, usage: toUsage(response.usage), finishReason: choice.finish_reason };
};
