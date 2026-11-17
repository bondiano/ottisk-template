/**
Болванка v2: детерминированная модель для проверок «Приёмки».

Настоящая модель на один и тот же разговор отвечает по-разному и стоит
денег, поэтому проверки зовут Болванку. Она говорит по протоколу OpenAI
(`POST …/chat/completions` и `POST …/embeddings`) и подключается к
настоящему SDK как `fetch`:
`new OpenAI({ baseURL: 'http://bolvanka/v1', apiKey: 'bolvanka', fetch })`,
а к LangChain так же через `configuration: { baseURL, apiKey, fetch }`.
Код, который принимает клиент параметром, у себя так же работает с DeepSeek.

Сценарий это ходы по порядку: Болванка берёт первый ещё не сыгранный ход,
чьё условие подходит к разговору, и отвечает им. Ход с `repeat: true`
можно играть сколько угодно. id вызовов Болванка выдаёт сама.

Сверх Болванки Наборщика ход умеет сбой (`fail`: статус с телом ошибки
OpenAI, 429 с `retry-after` или зависание до отмены запроса), обрыв стрима
(`cut`) и свой `usage` (кассеты). На `stream: true` тот же ответ уходит
дельтами SSE (bolvanka-stream.ts), эмбеддинги считаются по триграммам
(bolvanka-embeddings.ts), кассеты превращаются в ходы в bolvanka-cassette.ts.
*/
import { embed, embeddingData } from './bolvanka-embeddings';
import { streamResponse } from './bolvanka-stream';

export type ToolCall = {
  readonly id: string;
  readonly type: 'function';
  readonly function: { readonly name: string; readonly arguments: string };
};

type Part = {
  readonly type: string;
  readonly text?: string;
  readonly image_url?: { readonly url: string; readonly detail?: string };
};
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
  readonly tools?: readonly {
    readonly type?: string;
    readonly function: {
      readonly name: string;
      readonly description?: string;
      readonly parameters?: unknown;
      readonly strict?: boolean | null;
    };
  }[];
  readonly tool_choice?: unknown;
  readonly response_format?: {
    readonly type: 'text' | 'json_object' | 'json_schema';
    readonly json_schema?: {
      readonly name: string;
      readonly schema?: unknown;
      readonly strict?: boolean | null;
    };
  };
  readonly stream?: boolean | null;
  readonly stream_options?: { readonly include_usage?: boolean } | null;
  readonly temperature?: number | null;
  readonly max_tokens?: number | null;
  readonly max_completion_tokens?: number | null;
};

/** Что условие хода знает кроме разговора: весь запрос и номер попытки того же запроса с единицы. */
export type Context = { readonly request: Request; readonly attempt: number };

/** Условие хода: смотрит на разговор и подписано словами для сообщения об ошибке. */
export type Condition = {
  readonly label: string;
  readonly test: (messages: readonly Message[], context: Context) => boolean;
};

/** Вызов инструмента; `raw` отдаёт аргументы строкой как есть, например битый JSON. */
export type Call = {
  readonly name: string;
  readonly args?: Readonly<Record<string, unknown>>;
  readonly raw?: string;
};

/** Сбой вместо ответа: статус с телом ошибки OpenAI или `hang`, ответ до отмены запроса. */
export type Failure =
  | {
      readonly status: number;
      readonly message?: string;
      /** Секунды в заголовке `retry-after`. */
      readonly retryAfter?: number;
      /** `error.code`; у 429 по умолчанию `rate_limit_exceeded`, у квоты `insufficient_quota`. */
      readonly code?: string;
    }
  | 'hang';

export type Usage = {
  readonly prompt_tokens: number;
  readonly completion_tokens: number;
  readonly cached_tokens?: number;
};

export type Turn = {
  readonly say?: string;
  readonly calls?: readonly Call[];
  readonly when?: Condition;
  readonly repeat?: boolean;
  readonly finishReason?: 'stop' | 'tool_calls' | 'length';
  readonly fail?: Failure;
  /** Стрим обрывается после стольких дельт ответа (дельта с ролью не считается). */
  readonly cut?: number;
  /** `usage` ответа вместо своего подсчёта: так кассета отдаёт настоящие цифры. */
  readonly usage?: Usage;
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

/** Попытка номер `n` одного и того же запроса: повтор после сбоя приходит с `attempt(2)`. */
export const attempt = (n: number): Condition => ({
  label: `попытка №${n} того же запроса`,
  test: (_messages, context) => context.attempt === n,
});

export const withFormat = (type: 'json_object' | 'json_schema'): Condition => ({
  label: `запрос просит response_format ${type}`,
  test: (_messages, context) => context.request.response_format?.type === type,
});

export const withTool = (name: string): Condition => ({
  label: `в запросе есть инструмент ${name}`,
  test: (_messages, context) =>
    (context.request.tools ?? []).some((tool) => tool.function.name === name),
});

export const streaming: Condition = {
  label: 'запрос со stream: true',
  test: (_messages, context) => context.request.stream === true,
};

export const withImage: Condition = {
  label: 'в последнем сообщении пользователя есть картинка',
  test: (messages) => {
    const content = last(messages, 'user')?.content;
    return typeof content === 'object' && (content ?? []).some((p) => p.type === 'image_url');
  },
};

/** Все условия сразу. */
export const all = (...conditions: readonly Condition[]): Condition => ({
  label: conditions.map((condition) => condition.label).join(' и '),
  test: (messages, context) => conditions.every((condition) => condition.test(messages, context)),
});

/** Приближение токенайзера: слово или знак препинания это один токен, плюс 4 на сообщение. */
const TOKEN = /[\p{L}\p{N}_]+|[^\p{L}\p{N}_\s]/gu;
export const countTokens = (text: string): number => text.match(TOKEN)?.length ?? 0;

/** Картинка на входе стоит столько токенов, сколько бы ни весила. */
export const IMAGE_TOKENS = 85;

const messageTokens = (message: Message): number =>
  4 +
  countTokens(textOf(message.content)) +
  (typeof message.content === 'object' ? (message.content ?? []) : []).filter(
    (part) => part.type === 'image_url',
  ).length *
    IMAGE_TOKENS +
  (message.tool_calls ?? []).reduce(
    (sum, call) => sum + countTokens(call.function.name) + countTokens(call.function.arguments),
    0,
  );

// Части запроса в порядке префикса: описания инструментов, формат ответа, сообщения.
const prefixOf = (request: Request): { key: string; tokens: number }[] => {
  const extra = [request.tools, request.response_format].map((value) => {
    const key = value === undefined ? '' : JSON.stringify(value);
    return { key, tokens: countTokens(key) };
  });
  return [
    ...extra,
    ...request.messages.map((m) => ({ key: JSON.stringify(m), tokens: messageTokens(m) })),
  ];
};

const json = (status: number, body: unknown, headers: Record<string, string> = {}): Response =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', ...headers },
  });

const ERROR_TYPES: Readonly<Record<number, string>> = {
  400: 'invalid_request_error',
  401: 'authentication_error',
  403: 'permission_error',
  404: 'not_found_error',
  429: 'rate_limit_exceeded',
};

const MESSAGES: Readonly<Record<number, string>> = {
  429: 'болванка: слишком много запросов',
  500: 'болванка: внутренняя ошибка',
  503: 'болванка: модель перегружена, повторите позже',
};

const failure = (status: number, message: string, code: string | null = null, headers = {}) =>
  json(
    status,
    {
      error: {
        message,
        type: status >= 500 ? 'server_error' : (ERROR_TYPES[status] ?? 'invalid_request_error'),
        code,
        param: null,
      },
    },
    headers,
  );

// 400, а не 500: на 5xx SDK повторяет запрос, и ошибка сценария пришла бы трижды и с паузами.
const refuse = (message: string): Response => failure(400, message, 'bolvanka');

// Ответ не приходит, пока клиент сам не отменит запрос: так проверяют таймауты.
const hang = (signal: AbortSignal | null | undefined): Promise<Response> =>
  new Promise((_resolve, reject) => {
    if (!signal) {
      reject(new Error('болванка: ход hang ждёт отмены, а у запроса нет signal'));
      return;
    }
    if (signal.aborted) {
      reject(signal.reason);
      return;
    }
    signal.addEventListener('abort', () => reject(signal.reason), { once: true });
  });

const describeLast = (messages: readonly Message[]): string => {
  const message = messages.at(-1);
  if (!message) return 'пустой разговор';
  const calls = (message.tool_calls ?? []).map((call) => call.function.name).join(', ');
  return `${message.role}: ${textOf(message.content) || calls || '(пусто)'}`;
};

/** Запрос, как он дошёл до Болванки: заголовки с ключами в нижнем регистре. */
export type Sent = {
  readonly url: string;
  readonly headers: Readonly<Record<string, string>>;
  readonly body: unknown;
};

export type Bolvanka = {
  readonly fetch: (
    input: string | URL | globalThis.Request,
    init?: RequestInit,
  ) => Promise<Response>;
  /** Каждый запрос к модели (`/chat/completions`), по порядку. */
  readonly seen: readonly Request[];
  /** Каждый HTTP-запрос, включая эмбеддинги, с заголовками. */
  readonly requests: readonly Sent[];
};

export const bolvanka = (turns: readonly Turn[]): Bolvanka => {
  const seen: Request[] = [];
  const requests: Sent[] = [];
  const played = new Set<number>();
  const attempts = new Map<string, number>();
  const prefixes: string[][] = [];
  let ids = 0;

  const usageOf = (turn: Turn, request: Request, message: Message) => {
    const prefix = prefixOf(request);
    const keys = prefix.map((part) => part.key);
    // Кэш префикса: начало запроса, которое уже приходило, идёт в cached_tokens.
    const shared = Math.max(
      0,
      ...prefixes.map((earlier) => {
        const differs = keys.findIndex((key, index) => earlier[index] !== key);
        return differs === -1 ? keys.length : differs;
      }),
    );
    prefixes.push(keys);
    const own = turn.usage;
    const prompt = own?.prompt_tokens ?? prefix.reduce((sum, part) => sum + part.tokens, 0);
    const cached =
      own?.cached_tokens ?? prefix.slice(0, shared).reduce((sum, part) => sum + part.tokens, 0);
    const completion = own?.completion_tokens ?? messageTokens(message);
    return {
      prompt_tokens: prompt,
      completion_tokens: completion,
      total_tokens: prompt + completion,
      prompt_tokens_details: { cached_tokens: cached },
    };
  };

  const reply = (turn: Turn, request: Request, signal: AbortSignal | null | undefined) => {
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
    const completion = {
      id: `chatcmpl-bolvanka-${seen.length}`,
      model: request.model,
      message,
      finishReason: turn.finishReason ?? (toolCalls.length > 0 ? 'tool_calls' : 'stop'),
      usage: usageOf(turn, request, message),
    };
    if (request.stream === true) {
      return streamResponse(completion, {
        includeUsage: request.stream_options?.include_usage === true,
        cut: turn.cut,
        signal,
      });
    }
    return json(200, {
      id: completion.id,
      object: 'chat.completion',
      created: 0,
      model: completion.model,
      choices: [
        {
          index: 0,
          message: { ...message, refusal: null },
          finish_reason: completion.finishReason,
          logprobs: null,
        },
      ],
      usage: completion.usage,
    });
  };

  const chat = async (request: Request, signal: AbortSignal | null | undefined) => {
    seen.push(request);
    const key = JSON.stringify(request.messages);
    const context = { request, attempt: (attempts.get(key) ?? 0) + 1 };
    attempts.set(key, context.attempt);
    const number = turns.findIndex(
      (turn, index) =>
        (turn.repeat === true || !played.has(index)) &&
        (turn.when ?? always).test(request.messages, context),
    );
    const turn = turns[number];
    if (turn === undefined) {
      const waiting = turns.filter((t, index) => t.repeat === true || !played.has(index));
      const expected =
        waiting.map((t) => (t.when ?? always).label).join('; ') || 'ничего, сценарий кончился';
      return refuse(`ход не найден: ожидали ${expected}; пришло ${describeLast(request.messages)}`);
    }
    if (turn.cut !== undefined && request.stream !== true) {
      return refuse('ход с обрывом (cut) играется только в стриме, а пришло stream: false');
    }
    played.add(number);
    const fail = turn.fail;
    if (fail === 'hang') return hang(signal);
    if (fail !== undefined) {
      const code = fail.code ?? (fail.status === 429 ? 'rate_limit_exceeded' : null);
      const message = fail.message ?? MESSAGES[fail.status] ?? `болванка: ошибка ${fail.status}`;
      const headers: Record<string, string> =
        fail.retryAfter === undefined ? {} : { 'retry-after': String(fail.retryAfter) };
      return failure(fail.status, message, code, headers);
    }
    return reply(turn, request, signal);
  };

  const embeddings = (body: {
    model?: string;
    input?: unknown;
    encoding_format?: string;
    dimensions?: number;
  }) => {
    const inputs = typeof body.input === 'string' ? [body.input] : body.input;
    if (!Array.isArray(inputs) || !inputs.every((text) => typeof text === 'string')) {
      return refuse('болванка: эмбеддинги считаются только для строки или массива строк');
    }
    const tokens = inputs.reduce((sum: number, text: string) => sum + countTokens(text), 0);
    return json(200, {
      object: 'list',
      model: body.model ?? 'bolvanka-embed',
      data: embeddingData(inputs, body.encoding_format === 'base64', body.dimensions),
      usage: { prompt_tokens: tokens, total_tokens: tokens },
    });
  };

  const fetch: Bolvanka['fetch'] = async (input, init) => {
    const native = input instanceof globalThis.Request ? input : undefined;
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    const text = native ? await native.text() : init?.body;
    const headers = new Headers(native ? native.headers : init?.headers);
    let body: unknown = {};
    try {
      body = typeof text === 'string' && text !== '' ? JSON.parse(text) : {};
    } catch {
      return refuse('болванка: тело запроса не JSON');
    }
    requests.push({ url, headers: Object.fromEntries(headers.entries()), body });
    const path = new URL(url, 'http://bolvanka').pathname;
    if (path.endsWith('/embeddings')) return embeddings(body as Parameters<typeof embeddings>[0]);
    if (!path.endsWith('/chat/completions')) {
      return refuse(`болванка знает только /chat/completions и /embeddings, пришло ${url}`);
    }
    return chat(body as Request, native?.signal ?? init?.signal);
  };

  return { fetch, seen, requests };
};

export { embed };
