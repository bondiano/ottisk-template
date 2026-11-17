/**
Общие типы «Приёмки»: о них договорились все модули изделия.

Модуль живёт в своей папке (`src/api/` этапы 1-10, `src/env/`, `src/prompts/` и
`src/evals/`, `src/mcp/`, `src/rag/`, `src/agent/`, `src/graph/`, `src/harness/`,
`src/team/`) и получает соседей параметром этими типами, а не импортом чужой
папки. Поэтому модули пишутся отдельно и складываются в одно изделие. Здесь только
типы: схемы Zod и функции живут в модулях (схема заказа в `src/api/order.ts`).
Карта модулей: docs/llm-agents-priemka.md.
*/

// --- Письма и заказы

export type Attachment = {
  readonly name: string;
  /** id макета в `fixtures/layouts.ts`, если вложение это макет. */
  readonly layout?: string;
};

/** Письмо клиента «Оттиску»: почта, мессенджер или запись звонка. */
export type Letter = {
  readonly id: string;
  /** Клиент для квот и истории заказов: `kafe-pyshka`. */
  readonly client: string;
  /** Как подписался отправитель. */
  readonly from: string;
  readonly channel: 'email' | 'messenger' | 'phone';
  /** ISO с часовым поясом Посада (+03:00). */
  readonly receivedAt: string;
  readonly subject: string | null;
  readonly text: string;
  readonly attachments: readonly Attachment[];
};

export type ProductId =
  | 'business-cards'
  | 'flyers'
  | 'booklets'
  | 'posters'
  | 'stickers'
  | 'menus'
  | 'certificates';

export type PaperId =
  | 'offset-80'
  | 'coated-130'
  | 'coated-170'
  | 'coated-300'
  | 'carton-250'
  | 'design-300'
  | 'sticker-film';

export type FinishingId =
  | 'lamination-matte'
  | 'lamination-gloss'
  | 'folding'
  | 'creasing'
  | 'rounding'
  | 'die-cut';

/** Красочность: лицо + оборот. */
export type Colors = '4+0' | '4+4' | '1+0';

/**
Позиция заказа. Неизвестное в письме это `null`, а не выдумка: строгий
структурированный ответ требует все поля, поэтому «не знаю» выражается `null`.
*/
export type OrderItem = {
  readonly product: ProductId;
  readonly quantity: number | null;
  /** Обрезной формат: `A5`, `90x50`, `d50` для круглой наклейки. */
  readonly format: string | null;
  readonly paper: PaperId | null;
  readonly colors: Colors | null;
  readonly finishing: readonly FinishingId[];
};

/** Заказ, который «Приёмка» достаёт из письма. Скидки в заказе нет: её даёт только человек. */
export type Order = {
  readonly customer: string;
  readonly items: readonly OrderItem[];
  /** `YYYY-MM-DD`; `null`, если срока нет или он неоднозначен (тогда вопрос в `questions`). */
  readonly deadline: string | null;
  readonly rush: boolean;
  /** Что уточнить у клиента; пусто, если всё ясно. */
  readonly questions: readonly string[];
};

// --- Прайс

export type PriceTier = { readonly from: number; readonly each: number };

export type Product = {
  readonly id: ProductId;
  readonly title: string;
  /** Форматы и множитель цены к цене ступени: `{ A5: 1, A4: 1.8 }`; первый формат базовый. */
  readonly formats: Readonly<Record<string, number>>;
  /** Тираж меньше минимального считается по минимальному. */
  readonly minQuantity: number;
  /** Цена штуки в рублях при 4+0 на базовой бумаге, по ступеням тиража. */
  readonly tiers: readonly PriceTier[];
  /** Приладка: разово за заказ. */
  readonly setup: number;
  readonly defaultPaper: PaperId;
};

export type Paper = {
  readonly id: PaperId;
  /** Артикул со склада и из Памятки: `МТ-250`. */
  readonly article: string;
  readonly title: string;
  readonly gsm: number;
  /** Доплата за лист, ₽; к цене ступени добавляется разница с бумагой по умолчанию. */
  readonly each: number;
};

export type Finishing = {
  readonly id: FinishingId;
  readonly title: string;
  readonly each: number;
  /** Ниже этой плотности операцию не делаем (Памятка технолога). */
  readonly minGsm?: number;
};

export type PriceList = {
  readonly updatedAt: string;
  readonly products: readonly Product[];
  readonly papers: readonly Paper[];
  readonly finishing: readonly Finishing[];
  /** Множитель цены за красочность. */
  readonly colors: Readonly<Record<Colors, number>>;
  /** Срочность: наценка в долях, если до срока меньше `hours` часов. */
  readonly rush: { readonly surcharge: number; readonly hours: number };
};

export type QuoteLine = {
  readonly item: OrderItem;
  readonly title: string;
  readonly quantity: number;
  readonly each: number;
  readonly setup: number;
  readonly sum: number;
};

/** Смета в рублях, округлённая до рубля. */
export type Quote = {
  readonly lines: readonly QuoteLine[];
  readonly subtotal: number;
  readonly rush: number;
  readonly total: number;
};

// --- Макеты

export type Box = { readonly x: number; readonly y: number; readonly w: number; readonly h: number };

/** Кусок текстового слоя PDF: цвета текста и фона, кегль в пунктах, рамка в мм от угла обреза. */
export type TextRun = {
  readonly text: string;
  readonly color: string;
  readonly background: string;
  readonly sizePt: number;
  readonly box: Box;
};

export type LayoutPage = {
  readonly number: number;
  /** Обрезной формат, мм. */
  readonly trim: { readonly w: number; readonly h: number };
  /** Вылет за обрез с каждой стороны, мм (BleedBox минус TrimBox). */
  readonly bleed: number;
  readonly colorSpace: 'CMYK' | 'RGB';
  readonly images: readonly { readonly name: string; readonly dpi: number }[];
  readonly text: readonly TextRun[];
};

/** Метаданные макета, как их достаёт разбор PDF; `preview` это картинка страницы для модели. */
export type Layout = {
  readonly id: string;
  readonly file: string;
  readonly pages: readonly LayoutPage[];
  readonly fonts: readonly { readonly name: string; readonly embedded: boolean }[];
  readonly preview: string;
};

export type LayoutIssue = {
  readonly code:
    | 'bleed'
    | 'margin'
    | 'dpi'
    | 'fonts'
    | 'color-space'
    | 'small-text'
    | 'hidden-text'
    | 'visual';
  readonly page: number | null;
  readonly message: string;
  /** Кто нашёл: код по метаданным или модель по картинке. */
  readonly source: 'code' | 'model';
};

// --- Учёт заказов «Оттиска»

export type OrderStatus =
  | 'new'
  | 'awaiting-layout'
  | 'awaiting-approval'
  | 'approved'
  | 'printing'
  | 'ready'
  | 'delivered'
  | 'cancelled';

export type OrderRecord = {
  readonly id: string;
  readonly client: string;
  readonly customer: string;
  readonly title: string;
  /** Что печатали: по этому «как в прошлый раз». */
  readonly items: readonly OrderItem[];
  readonly status: OrderStatus;
  readonly updatedAt: string;
  /** Обещанная дата готовности, `YYYY-MM-DD`. */
  readonly promised: string | null;
  readonly total: number;
};

// --- Деньги за модель

/** Токены одного или нескольких ответов; `cachedTokens` входят в `inputTokens`. */
export type Usage = {
  readonly inputTokens: number;
  readonly cachedTokens: number;
  readonly outputTokens: number;
};

/** Цена за миллион токенов в долларах. */
export type Price = {
  readonly input: number;
  readonly cachedInput: number;
  readonly output: number;
};

export type Tariff = {
  readonly model: string;
  readonly offPeak: Price;
  readonly peak: Price;
  /** Дни недели пика по UTC (0 воскресенье) и часы `[с, до)` по UTC. */
  readonly peakDays: readonly number[];
  readonly peakHoursUtc: readonly (readonly [number, number])[];
};

// --- Приём письма целиком

export type IntakeStatus = 'done' | 'needs-human' | 'stopped' | 'failed';

/** Итог «Приёмки» на одном письме: его отдают босс 10, агент и workflow 34, граф, harness, команда. */
export type IntakeRun = {
  readonly letterId: string;
  readonly status: IntakeStatus;
  readonly order: Order | null;
  /** Почему не `done`: вопрос клиенту, проблема макета, исчерпанная квота, ошибка. */
  readonly reasons: readonly string[];
  readonly layoutIssues: readonly LayoutIssue[];
  readonly usage: Usage;
  readonly costUsd: number;
  /** Сколько запросов ушло к модели, включая неудачные. */
  readonly modelCalls: number;
};

export type Intake = (letter: Letter, signal?: AbortSignal) => Promise<IntakeRun>;

/**
Структурная часть `Runnable` LangChain: `invoke` есть у агента `createAgent`,
у скомпилированного графа и у обёртки над обычной функцией. Harness (AG18) и
команда (AG19) оборачивают именно его.
*/
export type Runnable<I, O> = {
  readonly invoke: (
    input: I,
    config?: {
      readonly signal?: AbortSignal;
      readonly configurable?: Readonly<Record<string, unknown>>;
    },
  ) => Promise<O>;
};

// --- Поиск по Памятке

export type Doc = { readonly id: string; readonly title: string; readonly text: string };

export type Chunk = {
  /** Устойчивый id для ссылок: `memo#bleed-1`. */
  readonly id: string;
  readonly docId: string;
  /** Заголовок раздела, откуда кусок. */
  readonly section: string;
  /** Страница Памятки, если документ на страницах. */
  readonly page: number | null;
  readonly text: string;
};

export type Hit = { readonly chunk: Chunk; readonly score: number };

/** Поиск: лучшие `k` кусков по запросу, от лучшего к худшему. */
export type Retriever = (query: string, k: number) => Promise<readonly Hit[]>;

/** Ссылка на источник: дословная цитата из куска. */
export type Citation = { readonly chunkId: string; readonly quote: string };

export type GroundedAnswer =
  | { readonly kind: 'answer'; readonly text: string; readonly citations: readonly Citation[] }
  | { readonly kind: 'no-answer'; readonly reason: string };

// --- Инструменты и опасные действия

/** Имена инструментов «Приёмки»: одни и те же в MCP-сервере, агенте, графе и команде. */
export type ToolName =
  | 'get_price'
  | 'get_order_status'
  | 'create_draft'
  | 'search_memo'
  | 'submit_print_job'
  | 'grant_discount';

export type ToolSpec = {
  readonly name: ToolName;
  readonly description: string;
  /** JSON Schema аргументов. */
  readonly parameters: Readonly<Record<string, unknown>>;
  /** Результат строкой для модели; ошибка тоже строка, а не исключение. */
  readonly run: (args: unknown) => Promise<string>;
};

/** Черновик заказа: заказ ещё не в печати и ни к чему не обязывает. */
export type Draft = {
  readonly id: string;
  readonly letterId: string;
  readonly order: Order;
  readonly quote: Quote;
};

/** Задание на тираж. Один ключ идемпотентности это одна печать, сколько бы раз задание ни пришло. */
export type PrintJob = {
  readonly orderId: string;
  readonly copies: number;
  readonly idempotencyKey: string;
};

export type PrintReceipt = {
  readonly jobId: string;
  readonly orderId: string;
  /** Сколько списано с клиента, ₽. */
  readonly charged: number;
  /** `true`, если задание с этим ключом уже было и машина его не печатала снова. */
  readonly duplicate: boolean;
};

export type DiscountRequest = {
  readonly orderId: string;
  readonly percent: number;
  readonly reason: string;
};

export type DiscountReceipt = { readonly orderId: string; readonly percent: number };

/** Порт типографии: настоящие побочные эффекты. В проверках его подменяет фейк с журналом. */
export type PrintShop = {
  readonly submitPrintJob: (job: PrintJob) => Promise<PrintReceipt>;
  readonly grantDiscount: (request: DiscountRequest) => Promise<DiscountReceipt>;
};

export type DangerousAction =
  | { readonly kind: 'print'; readonly job: PrintJob }
  | { readonly kind: 'discount'; readonly request: DiscountRequest };

/** Решение человека, как у `interrupt` в LangGraph: одобрить, исправить или отклонить. */
export type Decision =
  | { readonly kind: 'approve'; readonly by: string }
  | { readonly kind: 'edit'; readonly by: string; readonly action: DangerousAction }
  | { readonly kind: 'reject'; readonly by: string; readonly reason: string };

export type Approver = (action: DangerousAction) => Promise<Decision>;

// --- Время, лимиты, журнал, трассы

/** Часы: миллисекунды с эпохи. В проверках время двигает тест, а не `Date.now`. */
export type Clock = () => number;

export type Limits = {
  readonly maxSteps: number;
  readonly maxMs: number;
  readonly maxCostUsd: number;
};

export type Spent = { readonly steps: number; readonly ms: number; readonly costUsd: number };

export type StopReason =
  | 'done'
  | 'max-steps'
  | 'max-time'
  | 'max-cost'
  | 'policy'
  | 'rejected'
  | 'error';

/** Событие журнала выполнения; `at` по `Clock`. */
export type JournalEvent =
  | { readonly type: 'run-start'; readonly at: number; readonly runId: string; readonly input: string }
  | {
      readonly type: 'model-call';
      readonly at: number;
      readonly model: string;
      readonly usage: Usage;
      readonly costUsd: number;
      readonly ms: number;
    }
  | {
      readonly type: 'tool-call';
      readonly at: number;
      readonly tool: string;
      readonly args: unknown;
      readonly ok: boolean;
      readonly result: string;
    }
  | {
      readonly type: 'policy';
      readonly at: number;
      readonly tool: string;
      readonly verdict: 'allow' | 'deny' | 'ask';
      readonly reason: string;
    }
  | { readonly type: 'approval'; readonly at: number; readonly action: DangerousAction; readonly decision: Decision }
  | { readonly type: 'error'; readonly at: number; readonly message: string }
  | { readonly type: 'stop'; readonly at: number; readonly reason: StopReason; readonly spent: Spent };

export type Journal = (event: JournalEvent) => void;

type AttributeValue = string | number | boolean | readonly string[];

/**
Спан трассы в духе OpenTelemetry. У вызова модели имя `chat <модель>` и атрибуты
семантики GenAI: `gen_ai.operation.name`, `gen_ai.provider.name`,
`gen_ai.request.model`, `gen_ai.usage.input_tokens`, `gen_ai.usage.output_tokens`,
`gen_ai.response.finish_reasons`; у ошибки `error.type`.
*/
export type Span = {
  readonly traceId: string;
  readonly spanId: string;
  readonly parentId: string | null;
  readonly name: string;
  readonly startMs: number;
  readonly endMs: number;
  readonly status: 'ok' | 'error';
  readonly attributes: Readonly<Record<string, AttributeValue>>;
};

export type SpanSink = (span: Span) => void;

// --- Эвалы

/** Верный, пограничный, «данных нет», вредный. */
export type CaseKind = 'normal' | 'edge' | 'no-data' | 'harmful';

export type EvalCase<I, E> = {
  readonly id: string;
  readonly kind: CaseKind;
  readonly input: I;
  readonly expected: E;
};

export type Verdict = {
  readonly caseId: string;
  readonly check: string;
  readonly pass: boolean;
  readonly reason: string;
};

export type EvalReport = {
  readonly total: number;
  readonly passed: number;
  readonly byKind: Readonly<Record<CaseKind, { readonly total: number; readonly passed: number }>>;
  readonly verdicts: readonly Verdict[];
  readonly usage: Usage;
  readonly costUsd: number;
};
