import type OpenAI from 'openai';
import * as z from 'zod';

import type { Layout, LayoutIssue, Usage } from '../contracts';
import { NO_USAGE, toUsage } from './chat';
import type { Send } from './order';

/** Допуски из Памятки технолога: вылет (стр. 4), поле до текста (стр. 3), dpi (стр. 6), кегль (стр. 8). */
export type Spec = {
  readonly bleedMm: number;
  readonly marginMm: number;
  readonly minDpi: number;
  readonly minTextPt: number;
};

export const SPEC: Spec = { bleedMm: 3, marginMm: 5, minDpi: 300, minTextPt: 6 };

/** Что меряет код. Модель про это не спрашиваем, а если скажет, не верим. */
export const MEASURED: readonly LayoutIssue['code'][] = [
  'bleed',
  'margin',
  'dpi',
  'fonts',
  'color-space',
  'small-text',
];

const mm = (value: number): string => `${Math.round(value * 10) / 10} мм`;

/** Проверка кодом по данным файла: по страницам вылет, цвет, картинки, поля, кегль; потом шрифты. */
export const checkLayout = (layout: Layout, spec: Spec = SPEC): LayoutIssue[] => {
  const issue = (code: LayoutIssue['code'], page: number | null, message: string): LayoutIssue => ({
    code,
    page,
    message,
    source: 'code',
  });
  const pages = layout.pages.flatMap((page) => [
    ...(page.bleed < spec.bleedMm
      ? [issue('bleed', page.number, `вылет ${mm(page.bleed)}, нужно ${mm(spec.bleedMm)}`)]
      : []),
    ...(page.colorSpace === 'CMYK' ? [] : [issue('color-space', page.number, `страница в ${page.colorSpace}, нужен CMYK`)]),
    ...page.images
      .filter((image) => image.dpi < spec.minDpi)
      .map((image) =>
        issue('dpi', page.number, `картинка ${image.name} ${image.dpi} dpi, нужно от ${spec.minDpi}`),
      ),
    ...page.text.flatMap((run) => {
      const edge = Math.min(
        run.box.x,
        run.box.y,
        page.trim.w - run.box.x - run.box.w,
        page.trim.h - run.box.y - run.box.h,
      );
      return edge < spec.marginMm
        ? [issue('margin', page.number, `текст «${run.text}» в ${mm(edge)} от реза, нужно от ${mm(spec.marginMm)}`)]
        : [];
    }),
    ...page.text
      .filter((run) => run.sizePt < spec.minTextPt)
      .map((run) =>
        issue('small-text', page.number, `текст «${run.text}» кеглем ${run.sizePt} пт, нужно от ${spec.minTextPt}`),
      ),
  ]);
  const fonts = layout.fonts
    .filter((font) => !font.embedded)
    .map((font) => issue('fonts', null, `шрифт ${font.name} не внедрён`));
  return [...pages, ...fonts];
};

const ModelIssues = z.object({
  issues: z.array(
    z.object({ code: z.string(), page: z.number().int().nullable(), message: z.string() }),
  ),
});

export const LAYOUT_SYSTEM =
  'Ты технолог типографии. Посмотри на картинку макета и назови то, что видно глазом: перевёрнутый или обрезанный логотип, опечатки, пропавшие элементы. Ответь JSON вида {"issues":[{"code":"visual","page":1,"message":"..."}]}.';

/** Проверка моделью по картинке страницы: модель видит `preview`, а не данные файла. */
export const askModel = async (
  client: OpenAI,
  layout: Layout,
  options: { readonly model: string; readonly send?: Send },
): Promise<{ readonly issues: LayoutIssue[]; readonly usage: Usage }> => {
  const send: Send = options.send ?? ((body) => client.chat.completions.create(body));
  const response = await send({
    model: options.model,
    response_format: { type: 'json_object' },
    messages: [
      { role: 'system', content: LAYOUT_SYSTEM },
      {
        role: 'user',
        content: [
          { type: 'text', text: `Макет ${layout.file}, страниц: ${layout.pages.length}` },
          { type: 'image_url', image_url: { url: layout.preview } },
        ],
      },
    ],
  });
  const raw = response.choices[0]?.message.content ?? '';
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    throw new Error(`модель ответила о макете не JSON: ${raw.slice(0, 40)}`);
  }
  const parsed = ModelIssues.safeParse(value);
  if (!parsed.success) throw new Error('модель ответила о макете не по схеме');
  const issues = parsed.data.issues.map(
    (item): LayoutIssue => ({
      code: (MEASURED as readonly string[]).includes(item.code) ? (item.code as LayoutIssue['code']) : 'visual',
      page: item.page,
      message: item.message,
      source: 'model',
    }),
  );
  return { issues, usage: toUsage(response.usage) };
};

/**
Итог по макету: всё, что нашёл код, и от модели только то, чего код не меряет.
Если модель не ответила, проверка кодом остаётся, а про модель одна строка.
*/
export const reviewLayout = async (
  client: OpenAI,
  layout: Layout,
  options: { readonly model: string; readonly spec?: Spec; readonly send?: Send },
): Promise<{ readonly issues: LayoutIssue[]; readonly usage: Usage }> => {
  const code = checkLayout(layout, options.spec);
  try {
    const model = await askModel(client, layout, options);
    const visual = model.issues.filter((item) => !MEASURED.includes(item.code));
    return { issues: [...code, ...visual], usage: model.usage };
  } catch (error) {
    const message = `модель не проверила макет: ${error instanceof Error ? error.message : String(error)}`;
    return {
      issues: [...code, { code: 'visual', page: null, message, source: 'model' }],
      usage: NO_USAGE,
    };
  }
};
