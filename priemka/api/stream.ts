import type OpenAI from 'openai';
import type {
  ChatCompletionMessageParam,
  ChatCompletionTool,
} from 'openai/resources/chat/completions';

import type { Usage } from '../contracts';
import { NO_USAGE, toUsage } from './chat';

export type StreamRequest = {
  readonly model: string;
  readonly messages: readonly ChatCompletionMessageParam[];
  readonly tools?: readonly ChatCompletionTool[];
};

export type StreamedCall = { readonly id: string; readonly name: string; readonly arguments: string };

export type Streamed = {
  readonly text: string;
  readonly toolCalls: readonly StreamedCall[];
  /** `null`, если поток отменили до конца. */
  readonly finishReason: string | null;
  readonly usage: Usage;
  readonly cancelled: boolean;
};

/** Поток кончился без `finish_reason`: ответ неполный, что успело прийти, лежит в `partial`. */
export class StreamCut extends Error {
  override readonly name = 'StreamCut';
  constructor(
    readonly partial: string,
    options?: ErrorOptions,
  ) {
    super(`стрим оборвался после ${partial.length} символов`, options);
  }
}

export type StreamOptions = {
  /** Каждая дельта текста, как пришла. */
  readonly onText?: (delta: string) => void;
  readonly signal?: AbortSignal;
};

export const streamReply = async (
  client: OpenAI,
  request: StreamRequest,
  options: StreamOptions = {},
): Promise<Streamed> => {
  const stream = await client.chat.completions.create(
    {
      model: request.model,
      messages: [...request.messages],
      ...(request.tools === undefined ? {} : { tools: [...request.tools] }),
      stream: true,
      stream_options: { include_usage: true },
    },
    options.signal === undefined ? {} : { signal: options.signal },
  );
  let text = '';
  let finishReason: string | null = null;
  let usage = NO_USAGE;
  // Дельты вызова приходят кусками по `index`: первая с id и именем, дальше куски аргументов.
  const calls: { id: string; name: string; arguments: string }[] = [];
  try {
    for await (const chunk of stream) {
      if (chunk.usage) usage = toUsage(chunk.usage);
      const choice = chunk.choices[0];
      if (!choice) continue;
      const delta = choice.delta.content;
      if (delta) {
        text += delta;
        options.onText?.(delta);
      }
      for (const part of choice.delta.tool_calls ?? []) {
        const call = (calls[part.index] ??= { id: '', name: '', arguments: '' });
        if (part.id) call.id = part.id;
        if (part.function?.name) call.name = part.function.name;
        call.arguments += part.function?.arguments ?? '';
      }
      finishReason = choice.finish_reason ?? finishReason;
    }
  } catch (error) {
    if (!options.signal?.aborted) throw new StreamCut(text, { cause: error });
  }
  const cancelled = options.signal?.aborted === true;
  if (finishReason === null && !cancelled) throw new StreamCut(text);
  return { text, toolCalls: calls, finishReason: cancelled ? null : finishReason, usage, cancelled };
};
