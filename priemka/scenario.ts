import { lastUserIncludes, type Turn, withImage } from './bolvanka';
import type { Order, OrderItem } from './contracts';
import { letter } from './fixtures/letters';

/** Утренняя пачка `pnpm priemka` без аргументов. */
export const MORNING = ['L01', 'L13', 'L07', 'L10', 'L06', 'L04'] as const;

const item = (
  product: OrderItem['product'],
  quantity: number | null,
  format: string | null,
  paper: OrderItem['paper'],
  colors: OrderItem['colors'],
  finishing: OrderItem['finishing'] = [],
): OrderItem => ({ product, quantity, format, paper, colors, finishing });

/** Как эти письма разобрал бы внимательный человек; так на них отвечает Болванка. */
const ORDERS: Readonly<Record<(typeof MORNING)[number], Order>> = {
  L01: {
    customer: 'Кафе «Пышка»',
    items: [item('business-cards', 500, '90x50', 'coated-300', '4+4', ['lamination-matte'])],
    deadline: '2026-11-20',
    rush: false,
    questions: [],
  },
  L13: {
    customer: 'Магазин «Петровы»',
    items: [item('business-cards', 200, '90x50', 'coated-300', '4+4', ['lamination-matte'])],
    deadline: null,
    rush: false,
    questions: [],
  },
  L07: {
    customer: 'Фитнес-клуб «Атлет»',
    items: [item('flyers', 2000, 'A5', null, '4+4')],
    deadline: null,
    rush: false,
    questions: ['К какому сроку нужны листовки?'],
  },
  L10: {
    customer: 'Турагентство «Компас»',
    items: [item('booklets', 500, 'A4', 'offset-80', '4+4', ['folding', 'lamination-gloss'])],
    deadline: '2026-11-27',
    rush: false,
    questions: ['Клиент спрашивает, выдержит ли бумага 80 г ламинацию'],
  },
  L06: {
    customer: 'Ресторан «Пристань»',
    items: [item('menus', 60, 'A4', null, '4+4', ['lamination-gloss'])],
    deadline: '2026-11-16',
    rush: false,
    questions: [],
  },
  L04: {
    customer: 'ИП Сидоров',
    items: [item('flyers', 500, 'A6', 'offset-80', '4+4')],
    deadline: null,
    rush: false,
    questions: ['К какой пятнице нужны листовки: к 13 или к 20 ноября?'],
  },
};

const about = (id: string) => lastUserIncludes(letter(id).text.slice(0, 30));

/**
Сценарий Болванки для `pnpm priemka`: утро как в уроке 126. Провайдер один раз
перегружен (503), один раз просит подождать (429 с `retry-after: 1`), «Атлет» в
первом ответе получает лишнее поле `discount`, а глазом макеты чистые: всё, что
в них не так, находит код.
*/
export const scenario: Turn[] = [
  { fail: { status: 503 }, when: about('L01') },
  { fail: { status: 429, retryAfter: 1 }, when: about('L13') },
  { say: JSON.stringify({ ...ORDERS.L07, discount: 40 }), when: about('L07') },
  {
    say: JSON.stringify(ORDERS.L07),
    when: lastUserIncludes('Нераспознанный ключ: "discount"'),
  },
  ...Object.entries(ORDERS)
    .filter(([id]) => id !== 'L07')
    .map(([id, order]): Turn => ({ say: JSON.stringify(order), when: about(id) })),
  { say: JSON.stringify({ issues: [] }), when: withImage, repeat: true },
];
