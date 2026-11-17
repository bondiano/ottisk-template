import type { Clock } from '../contracts';

export type ProviderId = 'bolvanka' | 'deepseek' | 'openrouter' | 'yandex' | 'gigachat';

export type Env = Readonly<Record<string, string | undefined>>;

export type Provider = {
  readonly id: ProviderId;
  readonly baseURL: string;
  /** Переменная с ключом; у Болванки ключа нет. */
  readonly keyVar: string | null;
  readonly modelVar: string;
  /** Модель по умолчанию; `null`, если модель надо назвать в окружении. */
  readonly model: string | null;
  /** Понимает ли провайдер роль `developer`. */
  readonly developerRole: boolean;
  /** Понимает ли провайдер `reasoning_effort`. */
  readonly reasoning: boolean;
  /** Как провайдер принимает инструменты: `tools` или устаревшие `functions`. */
  readonly tools: 'tools' | 'functions';
};

export const PROVIDERS: Readonly<Record<ProviderId, Provider>> = {
  bolvanka: {
    id: 'bolvanka',
    baseURL: 'http://bolvanka/v1',
    keyVar: null,
    modelVar: 'BOLVANKA_MODEL',
    model: 'bolvanka',
    developerRole: true,
    reasoning: true,
    tools: 'tools',
  },
  deepseek: {
    id: 'deepseek',
    baseURL: 'https://api.deepseek.com',
    keyVar: 'DEEPSEEK_API_KEY',
    modelVar: 'DEEPSEEK_MODEL',
    model: 'deepseek-flash',
    developerRole: true,
    reasoning: true,
    tools: 'tools',
  },
  openrouter: {
    id: 'openrouter',
    baseURL: 'https://openrouter.ai/api/v1',
    keyVar: 'OPENROUTER_API_KEY',
    modelVar: 'OPENROUTER_MODEL',
    model: null,
    developerRole: true,
    reasoning: true,
    tools: 'tools',
  },
  yandex: {
    id: 'yandex',
    baseURL: 'https://ai.api.cloud.yandex.net/v1',
    keyVar: 'YANDEX_API_KEY',
    modelVar: 'YANDEX_MODEL',
    model: 'yandexgpt-5.1',
    developerRole: false,
    reasoning: false,
    tools: 'tools',
  },
  gigachat: {
    id: 'gigachat',
    baseURL: 'https://api.giga.chat/v1',
    // Не постоянный ключ, а токен доступа OAuth на 30 минут (gigachatOAuth и tokenCache ниже).
    keyVar: 'GIGACHAT_ACCESS_TOKEN',
    modelVar: 'GIGACHAT_MODEL',
    model: 'GigaChat',
    developerRole: false,
    reasoning: false,
    tools: 'functions',
  },
};

/** Всё, что нужно `new OpenAI({ ...connection.options, fetch })`, и модель для запросов. */
export type Connection = {
  readonly provider: ProviderId;
  readonly model: string;
  readonly options: {
    readonly baseURL: string;
    readonly apiKey: string;
    readonly defaultHeaders: Readonly<Record<string, string>>;
    readonly project?: string;
  };
};

const need = (env: Env, name: string, what: string): string => {
  const value = env[name]?.trim();
  if (!value) throw new Error(`нет ${what}: задай ${name}`);
  return value;
};

export const connect = (provider: string, env: Env): Connection => {
  const spec = (PROVIDERS as Readonly<Record<string, Provider>>)[provider];
  if (!spec) {
    throw new Error(`неизвестный провайдер ${provider}: есть ${Object.keys(PROVIDERS).join(', ')}`);
  }
  const apiKey = spec.keyVar === null ? 'bolvanka' : need(env, spec.keyVar, 'ключа');
  const model = env[spec.modelVar]?.trim() || spec.model || need(env, spec.modelVar, 'модели');
  if (spec.id === 'yandex') {
    const folder = need(env, 'YANDEX_FOLDER_ID', 'каталога');
    return {
      provider: spec.id,
      model: `gpt://${folder}/${model}`,
      // Логи запросов у Яндекса включены по умолчанию; письма клиентов там не нужны.
      options: {
        baseURL: spec.baseURL,
        apiKey,
        project: folder,
        defaultHeaders: { 'x-data-logging-enabled': 'false' },
      },
    };
  }
  const headers: Record<string, string> =
    spec.id === 'openrouter' ? { 'X-OpenRouter-Title': 'Priemka Ottisk' } : {};
  return { provider: spec.id, model, options: { baseURL: spec.baseURL, apiKey, defaultHeaders: headers } };
};

type Body = Readonly<Record<string, unknown>> & {
  readonly messages: readonly { readonly role: string }[];
};

// GigaChat ждёт `functions` и `function_call` вместо `tools` и `tool_choice`.
const toFunctions = (tools: unknown, choice: unknown) => {
  const named = (choice as { function?: { name?: string } } | undefined)?.function?.name;
  return {
    functions: (tools as readonly { function: unknown }[]).map((tool) => tool.function),
    ...(choice === undefined ? {} : { function_call: named === undefined ? choice : { name: named } }),
  };
};

/** Тело запроса под провайдера: `developer` в `system`, `tools` в `functions`, `reasoning_effort` прочь. */
export const adapt = (provider: ProviderId, body: Body): Body => {
  const spec = PROVIDERS[provider];
  const { reasoning_effort: effort, tools, tool_choice: choice, ...rest } = body;
  const toolFields =
    tools === undefined
      ? {}
      : spec.tools === 'functions'
        ? toFunctions(tools, choice)
        : { tools, ...(choice === undefined ? {} : { tool_choice: choice }) };
  return {
    ...rest,
    messages: spec.developerRole
      ? body.messages
      : body.messages.map((m) => (m.role === 'developer' ? { ...m, role: 'system' } : m)),
    ...(effort !== undefined && spec.reasoning ? { reasoning_effort: effort } : {}),
    ...toolFields,
  };
};

/** Запрос токена GigaChat: ключ авторизации (Base64 от Client ID и Client Secret) и uuid запроса. */
export const gigachatOAuth = (authKey: string, rqUid: string) => ({
  url: 'https://ngw.devices.sberbank.ru:9443/api/v2/oauth',
  init: {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      Accept: 'application/json',
      RqUID: rqUid,
      Authorization: `Basic ${authKey}`,
    },
    body: 'scope=GIGACHAT_API_PERS',
  },
});

export type Token = { readonly token: string; readonly expiresAt: number };

/** Токен из кэша; новый берётся, когда до конца старого меньше `marginMs`. */
export const tokenCache = (fetchToken: () => Promise<Token>, now: Clock, marginMs = 60_000) => {
  let current: Token | null = null;
  return async (): Promise<string> => {
    if (current === null || current.expiresAt - now() < marginMs) current = await fetchToken();
    return current.token;
  };
};
