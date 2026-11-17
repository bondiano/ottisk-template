/**
Прайс «Оттиска» на ноябрь 2026 года и расчёт сметы по нему.

Цена штуки: цена ступени тиража × множитель формата × множитель красочности, плюс
разница бумаги с бумагой по умолчанию, плюс отделка; к сумме приладка. Тираж меньше
минимального считается по минимальному. Срочность (до срока меньше 48 часов) это +50%.
Чего в прайсе нет (печать на ткани, тиснение), того «Оттиск» не делает.
*/
import type {
  Colors,
  FinishingId,
  OrderItem,
  PaperId,
  PriceList,
  ProductId,
  Quote,
  QuoteLine,
} from '../contracts';

export const PRICE_LIST: PriceList = {
  updatedAt: '2026-11-01',
  products: [
    {
      id: 'business-cards',
      title: 'Визитки',
      formats: { '90x50': 1 },
      minQuantity: 100,
      tiers: [
        { from: 100, each: 3.5 },
        { from: 500, each: 2.4 },
        { from: 1000, each: 1.8 },
      ],
      setup: 400,
      defaultPaper: 'coated-300',
    },
    {
      id: 'flyers',
      title: 'Листовки',
      formats: { A5: 1, A6: 0.6, A4: 1.8 },
      minQuantity: 100,
      tiers: [
        { from: 100, each: 6 },
        { from: 500, each: 4 },
        { from: 1000, each: 3 },
        { from: 5000, each: 2.2 },
      ],
      setup: 500,
      defaultPaper: 'coated-130',
    },
    {
      id: 'booklets',
      title: 'Буклеты (евробуклет, два сгиба)',
      formats: { A4: 1 },
      minQuantity: 100,
      tiers: [
        { from: 100, each: 22 },
        { from: 500, each: 15 },
        { from: 1000, each: 12 },
      ],
      setup: 900,
      defaultPaper: 'coated-130',
    },
    {
      id: 'posters',
      title: 'Афиши и плакаты',
      formats: { A3: 1, A2: 2.2, A1: 4 },
      minQuantity: 1,
      tiers: [
        { from: 1, each: 180 },
        { from: 10, each: 120 },
        { from: 50, each: 90 },
      ],
      setup: 0,
      defaultPaper: 'coated-170',
    },
    {
      id: 'stickers',
      title: 'Наклейки',
      formats: { d50: 1, d70: 1.5, '50x50': 1 },
      minQuantity: 100,
      tiers: [
        { from: 100, each: 5 },
        { from: 500, each: 3.2 },
        { from: 1000, each: 2.5 },
      ],
      setup: 600,
      defaultPaper: 'sticker-film',
    },
    {
      id: 'menus',
      title: 'Меню',
      formats: { A4: 1, A3: 1.9 },
      minQuantity: 10,
      tiers: [
        { from: 10, each: 95 },
        { from: 50, each: 70 },
      ],
      setup: 300,
      defaultPaper: 'coated-300',
    },
    {
      id: 'certificates',
      title: 'Грамоты и дипломы',
      formats: { A4: 1 },
      minQuantity: 10,
      tiers: [
        { from: 10, each: 60 },
        { from: 50, each: 45 },
      ],
      setup: 200,
      defaultPaper: 'design-300',
    },
  ],
  papers: [
    { id: 'offset-80', article: 'ОФ-80', title: 'Офсетная 80 г/м²', gsm: 80, each: 0 },
    { id: 'coated-130', article: 'МЛ-130', title: 'Мелованная 130 г/м²', gsm: 130, each: 0.5 },
    { id: 'coated-170', article: 'МЛ-170', title: 'Мелованная 170 г/м²', gsm: 170, each: 0.9 },
    {
      id: 'carton-250',
      article: 'МТ-250',
      title: 'Картон мелованный матовый 250 г/м²',
      gsm: 250,
      each: 1.3,
    },
    { id: 'coated-300', article: 'МЛ-300', title: 'Мелованная 300 г/м²', gsm: 300, each: 1.6 },
    { id: 'design-300', article: 'ДЗ-300', title: 'Дизайнерская 300 г/м²', gsm: 300, each: 4 },
    {
      id: 'sticker-film',
      article: 'ПЛ-СК',
      title: 'Плёнка самоклеящаяся',
      gsm: 0,
      each: 1.2,
    },
  ],
  finishing: [
    { id: 'lamination-matte', title: 'Ламинация матовая', each: 2.5, minGsm: 150 },
    { id: 'lamination-gloss', title: 'Ламинация глянцевая', each: 2.5, minGsm: 150 },
    { id: 'folding', title: 'Фальцовка', each: 0.8 },
    { id: 'creasing', title: 'Биговка', each: 0.6 },
    { id: 'rounding', title: 'Скругление углов', each: 0.4 },
    { id: 'die-cut', title: 'Вырубка по контуру', each: 1.5 },
  ],
  colors: { '4+0': 1, '4+4': 1.6, '1+0': 0.6 },
  rush: { surcharge: 0.5, hours: 48 },
};

const product = (id: ProductId) => {
  const found = PRICE_LIST.products.find((item) => item.id === id);
  if (!found) throw new Error(`изделия ${id} нет в прайсе`);
  return found;
};

export const paper = (id: PaperId) => {
  const found = PRICE_LIST.papers.find((item) => item.id === id);
  if (!found) throw new Error(`бумаги ${id} нет в прайсе`);
  return found;
};

const finishing = (id: FinishingId) => {
  const found = PRICE_LIST.finishing.find((item) => item.id === id);
  if (!found) throw new Error(`отделки ${id} нет в прайсе`);
  return found;
};

const kopecks = (value: number): number => Math.round(value * 100) / 100;

/** Строка сметы; ошибка, если позицию нельзя посчитать или сделать. */
export const quoteLine = (item: OrderItem): QuoteLine => {
  const spec = product(item.product);
  if (item.quantity === null) throw new Error(`у позиции «${spec.title}» нет тиража`);
  if (!Number.isInteger(item.quantity) || item.quantity <= 0) {
    throw new Error(`тираж «${spec.title}» должен быть целым и больше нуля, пришло ${item.quantity}`);
  }
  const [base = ''] = Object.keys(spec.formats);
  const format = item.format ?? base;
  const formatFactor = spec.formats[format];
  if (formatFactor === undefined) {
    throw new Error(`формата ${format} у «${spec.title}» нет: есть ${Object.keys(spec.formats).join(', ')}`);
  }
  const sheet = paper(item.paper ?? spec.defaultPaper);
  const extras = item.finishing.map(finishing);
  for (const extra of extras) {
    if (extra.minGsm !== undefined && sheet.gsm < extra.minGsm) {
      throw new Error(
        `«${extra.title}» не делается на бумаге ${sheet.gsm} г/м²: нужно от ${extra.minGsm} г/м²`,
      );
    }
  }
  const quantity = Math.max(item.quantity, spec.minQuantity);
  const tier = spec.tiers.findLast((step) => step.from <= quantity) ?? spec.tiers[0];
  const colors: Colors = item.colors ?? '4+0';
  const each = kopecks(
    (tier?.each ?? 0) * formatFactor * PRICE_LIST.colors[colors] +
      sheet.each -
      paper(spec.defaultPaper).each +
      extras.reduce((sum, extra) => sum + extra.each, 0),
  );
  return {
    item,
    title: `${spec.title} ${format}, ${colors}, ${sheet.article}`,
    quantity,
    each,
    setup: spec.setup,
    sum: Math.round(each * quantity + spec.setup),
  };
};

export const quote = (items: readonly OrderItem[], rush = false): Quote => {
  const lines = items.map(quoteLine);
  const subtotal = lines.reduce((sum, line) => sum + line.sum, 0);
  const surcharge = rush ? Math.round(subtotal * PRICE_LIST.rush.surcharge) : 0;
  return { lines, subtotal, rush: surcharge, total: subtotal + surcharge };
};
