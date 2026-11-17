/**
Стрим Болванки: тот же ответ, порезанный на дельты SSE (`chat.completion.chunk`), как у OpenAI.

Порядок событий: дельта с ролью; куски текста по словам (слово вместе с пробелами
после него); на каждый вызов дельта с id и именем, потом аргументы кусками по 12 символов;
дельта с `finish_reason`; с `stream_options.include_usage` чанк с `usage` и пустым
`choices`; `data: [DONE]`. Ход с `cut: n` после n дельт ответа рвёт соединение ошибкой
чтения тела, как упавшая сеть. Отмена запроса (`signal`) рвёт стрим ошибкой отмены.
События отдаются по одному на чтение, поэтому отмена между дельтами успевает сработать.
*/

type Completion = {
  readonly id: string;
  readonly model: string;
  readonly message: {
    readonly content?: unknown;
    readonly tool_calls?: readonly {
      readonly id: string;
      readonly function: { readonly name: string; readonly arguments: string };
    }[];
  };
  readonly finishReason: string;
  readonly usage: unknown;
};

type Options = {
  readonly includeUsage: boolean;
  readonly cut: number | undefined;
  readonly signal: AbortSignal | null | undefined;
};

/** Куски текста по словам: склейка кусков даёт исходный текст. */
export const words = (text: string): string[] => text.split(/(?<=\s)(?=\S)/u).filter(Boolean);

const pieces = (text: string): string[] => text.match(/.{1,12}/gsu) ?? [];

export const streamResponse = (completion: Completion, options: Options): Response => {
  const chunk = (delta: unknown, finishReason: string | null = null) => ({
    id: completion.id,
    object: 'chat.completion.chunk',
    created: 0,
    model: completion.model,
    choices: [{ index: 0, delta, finish_reason: finishReason, logprobs: null }],
  });
  const text = typeof completion.message.content === 'string' ? completion.message.content : '';
  const answer = [
    ...words(text).map((piece) => chunk({ content: piece })),
    ...(completion.message.tool_calls ?? []).flatMap((call, index) => [
      chunk({
        tool_calls: [
          { index, id: call.id, type: 'function', function: { name: call.function.name, arguments: '' } },
        ],
      }),
      ...pieces(call.function.arguments).map((part) =>
        chunk({ tool_calls: [{ index, function: { arguments: part } }] }),
      ),
    ]),
  ];
  const kept = options.cut === undefined ? answer : answer.slice(0, options.cut);
  const events = [
    chunk({ role: 'assistant' }),
    ...kept,
    ...(options.cut === undefined
      ? [
          chunk({}, completion.finishReason),
          ...(options.includeUsage ? [{ ...chunk({}), choices: [], usage: completion.usage }] : []),
        ]
      : []),
  ].map((event) => `data: ${JSON.stringify(event)}\n\n`);
  if (options.cut === undefined) events.push('data: [DONE]\n\n');

  const encoder = new TextEncoder();
  const { signal } = options;
  let next = 0;
  const body = new ReadableStream<Uint8Array>(
    {
      pull(controller) {
        if (signal?.aborted) {
          controller.error(signal.reason);
          return;
        }
        const event = events[next++];
        if (event !== undefined) controller.enqueue(encoder.encode(event));
        // Так Node сообщает об упавшем соединении посреди тела.
        else if (options.cut !== undefined) controller.error(new TypeError('terminated'));
        else controller.close();
      },
    },
    { highWaterMark: 0 },
  );
  return new Response(body, {
    status: 200,
    headers: { 'content-type': 'text/event-stream', 'cache-control': 'no-cache' },
  });
};
