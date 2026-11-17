import type OpenAI from 'openai';
import type { ChatCompletionMessageParam } from 'openai/resources/chat/completions';
import type { CompletionUsage } from 'openai/resources/completions';

import type { Letter, Usage } from '../contracts';

/** Что можно передать SDK вторым аргументом: отмена, таймаут, повторы самого SDK. */
export type CallOptions = {
  readonly signal?: AbortSignal;
  readonly timeout?: number;
  readonly maxRetries?: number;
};

export type Ask = {
  readonly model: string;
  readonly system: string;
  readonly user: string;
  readonly temperature?: number;
  readonly maxTokens?: number;
};

export type Reply = {
  readonly text: string;
  readonly finishReason: string;
  readonly usage: Usage;
};

export const NO_USAGE: Usage = { inputTokens: 0, cachedTokens: 0, outputTokens: 0 };

export const addUsage = (a: Usage, b: Usage): Usage => ({
  inputTokens: a.inputTokens + b.inputTokens,
  cachedTokens: a.cachedTokens + b.cachedTokens,
  outputTokens: a.outputTokens + b.outputTokens,
});

/** `usage` ответа OpenAI в наши поля; без `usage` (бывает у стрима) нули. */
export const toUsage = (usage: CompletionUsage | null | undefined): Usage => ({
  inputTokens: usage?.prompt_tokens ?? 0,
  cachedTokens: usage?.prompt_tokens_details?.cached_tokens ?? 0,
  outputTokens: usage?.completion_tokens ?? 0,
});

/** Письмо текстом для модели: шапка с отправителем, датой, темой и вложениями, пустая строка, текст. */
export const letterText = (letter: Letter): string =>
  [
    `От: ${letter.from}`,
    `Получено: ${letter.receivedAt}`,
    ...(letter.subject === null ? [] : [`Тема: ${letter.subject}`]),
    ...(letter.attachments.length === 0
      ? []
      : [`Вложения: ${letter.attachments.map((file) => file.name).join(', ')}`]),
    '',
    letter.text,
  ].join('\n');

export const messagesFor = (system: string, user: string): ChatCompletionMessageParam[] => [
  { role: 'system', content: system },
  { role: 'user', content: user },
];

export const ask = async (client: OpenAI, request: Ask, options?: CallOptions): Promise<Reply> => {
  const response = await client.chat.completions.create(
    {
      model: request.model,
      messages: messagesFor(request.system, request.user),
      ...(request.temperature === undefined ? {} : { temperature: request.temperature }),
      ...(request.maxTokens === undefined ? {} : { max_tokens: request.maxTokens }),
    },
    options,
  );
  const choice = response.choices[0];
  if (!choice) throw new Error('модель не вернула ответа');
  return {
    text: choice.message.content ?? '',
    finishReason: choice.finish_reason,
    usage: toUsage(response.usage),
  };
};

/** Тот же запрос в формате Anthropic Messages: системный промпт отдельным полем, `max_tokens` обязателен. */
export const toAnthropic = (request: Ask) => ({
  model: request.model,
  max_tokens: request.maxTokens ?? 1024,
  system: request.system,
  messages: [{ role: 'user' as const, content: request.user }],
  ...(request.temperature === undefined ? {} : { temperature: request.temperature }),
});
