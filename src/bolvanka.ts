/**
Болванка: детерминированная модель для проверок «Оттиска».

Настоящая модель на один и тот же разговор отвечает по-разному и стоит
денег, поэтому проверки зовут Болванку. Она говорит по протоколу
OpenAI (`POST …/chat/completions`) и подключается к настоящему SDK как
`fetch`: `new OpenAI({ baseURL: 'http://bolvanka/v1', apiKey: 'bolvanka', fetch })`.
Код, который принимает клиент параметром, у себя так же работает с DeepSeek.

Сценарий это ходы по порядку: Болванка берёт первый ещё не сыгранный ход,
чьё условие подходит к разговору, и отвечает им. Ход с `repeat: true`
можно играть сколько угодно. id вызовов Болванка выдаёт сама.
*/

export type ToolCall = {
  readonly id: string;
  readonly type: 'function';
  readonly function: { readonly name: string; readonly arguments: string };
};

type Part = { readonly type: string; readonly text?: string };
type Content = string | readonly Part[] | null | undefined;

export type Message = {
  readonly role: 'system' | 'developer' | 'user' | 'assistant' | 'tool';
  readonly content?: Content;
  readonly tool_calls?: readonly ToolCall[];
  readonly tool_call_id?: string;
};

export type Request = {
  readonly model: string;
  readonly messages: readonly Message[];
  readonly tools?: readonly { readonly function: { readonly name: string } }[];
  readonly stream?: boolean;
};

/** Условие хода: смотрит на разговор и подписано словами для сообщения об ошибке. */
export type Condition = {
  readonly label: string;
  readonly test: (messages: readonly Message[]) => boolean;
};

/** Вызов инструмента; `raw` отдаёт аргументы строкой как есть, например битый JSON. */
export type Call = {
  readonly name: string;
  readonly args?: Readonly<Record<string, unknown>>;
  readonly raw?: string;
};

export type Turn = {
  readonly say?: string;
  readonly calls?: readonly Call[];
  readonly when?: Condition;
  readonly repeat?: boolean;
  readonly finishReason?: 'stop' | 'tool_calls' | 'length';
};

export const textOf = (content: Content): string =>
  typeof content === 'string' ? content : (content ?? []).map((part) => part.text ?? '').join('');

const last = (messages: readonly Message[], role: Message['role']): Message | undefined =>
  messages.findLast((message) => message.role === role);

// Результаты инструментов, пришедшие после последнего ответа модели.
const lastResults = (messages: readonly Message[]): string[] => {
  const tail = messages.slice(messages.findLastIndex((m) => m.role === 'assistant') + 1);
  return tail.filter((m) => m.role === 'tool').map((m) => textOf(m.content));
};

export const always: Condition = { label: 'что угодно', test: () => true };

export const lastUserIncludes = (fragment: string): Condition => ({
  label: `последнее сообщение пользователя содержит «${fragment}»`,
  test: (messages) => textOf(last(messages, 'user')?.content).includes(fragment),
});

export const toolResultIncludes = (fragment: string): Condition => ({
  label: `ответ инструмента содержит «${fragment}»`,
  test: (messages) => lastResults(messages).some((result) => result.includes(fragment)),
});

export const systemIncludes = (fragment: string): Condition => ({
  label: `системный промпт содержит «${fragment}»`,
  test: (messages) =>
    messages.some(
      (m) =>
        (m.role === 'system' || m.role === 'developer') && textOf(m.content).includes(fragment),
    ),
});

/** Приближение токенайзера: слово или знак препинания это один токен, плюс 4 на сообщение. */
const TOKEN = /[\p{L}\p{N}_]+|[^\p{L}\p{N}_\s]/gu;
export const countTokens = (text: string): number => text.match(TOKEN)?.length ?? 0;

const messageTokens = (message: Message): number =>
  4 +
  countTokens(textOf(message.content)) +
  (message.tool_calls ?? []).reduce(
    (sum, call) => sum + countTokens(call.function.name) + countTokens(call.function.arguments),
    0,
  );

const json = (status: number, body: unknown): Response =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

// 400, а не 500: на 5xx SDK повторяет запрос, и ошибка сценария пришла бы трижды и с паузами.
const refuse = (message: string): Response =>
  json(400, { error: { message, type: 'bolvanka', code: null, param: null } });

const describeLast = (messages: readonly Message[]): string => {
  const message = messages.at(-1);
  if (!message) return 'пустой разговор';
  const calls = (message.tool_calls ?? []).map((call) => call.function.name).join(', ');
  return `${message.role}: ${textOf(message.content) || calls || '(пусто)'}`;
};

export type Bolvanka = {
  readonly fetch: (
    input: string | URL | globalThis.Request,
    init?: RequestInit,
  ) => Promise<Response>;
  /** Каждый запрос к модели, по порядку. */
  readonly seen: readonly Request[];
};

export const bolvanka = (turns: readonly Turn[]): Bolvanka => {
  const seen: Request[] = [];
  const played = new Set<number>();
  let ids = 0;

  const reply = (turn: Turn, request: Request): Response => {
    const toolCalls: ToolCall[] = (turn.calls ?? []).map((call) => ({
      id: `call_${String(++ids).padStart(3, '0')}`,
      type: 'function',
      function: { name: call.name, arguments: call.raw ?? JSON.stringify(call.args ?? {}) },
    }));
    const message: Message = {
      role: 'assistant',
      content: turn.say ?? null,
      ...(toolCalls.length > 0 ? { tool_calls: toolCalls } : {}),
    };
    const prompt = request.messages.reduce((sum, m) => sum + messageTokens(m), 0);
    const completion = messageTokens(message);
    return json(200, {
      id: `chatcmpl-bolvanka-${seen.length}`,
      object: 'chat.completion',
      created: 0,
      model: request.model,
      choices: [
        {
          index: 0,
          message: { ...message, refusal: null },
          finish_reason: turn.finishReason ?? (toolCalls.length > 0 ? 'tool_calls' : 'stop'),
          logprobs: null,
        },
      ],
      usage: {
        prompt_tokens: prompt,
        completion_tokens: completion,
        total_tokens: prompt + completion,
      },
    });
  };

  const fetch: Bolvanka['fetch'] = async (input, init) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    if (!url.endsWith('/chat/completions'))
      return refuse(`болванка знает только /chat/completions, пришло ${url}`);
    const request = JSON.parse(String(init?.body ?? '{}')) as Request;
    seen.push(request);
    if (request.stream) return refuse('болванка пока не умеет стрим');
    const number = turns.findIndex(
      (turn, index) =>
        (turn.repeat === true || !played.has(index)) &&
        (turn.when ?? always).test(request.messages),
    );
    const turn = turns[number];
    if (turn === undefined) {
      const waiting = turns.filter((t, index) => t.repeat === true || !played.has(index));
      const expected =
        waiting.map((t) => (t.when ?? always).label).join('; ') || 'ничего, сценарий кончился';
      return refuse(`ход не найден: ожидали ${expected}; пришло ${describeLast(request.messages)}`);
    }
    played.add(number);
    return reply(turn, request);
  };

  return { fetch, seen };
};
