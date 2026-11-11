import { lastUserIncludes, toolResultIncludes, type Turn } from './bolvanka';

/**
Сценарий Болванки для `pnpm hello`: один вопрос о цене. Условие «Сколько» нарочно
широкое, урок 04 разбирает, что из этого выходит.
*/
export const scenario: Turn[] = [
  {
    calls: [{ name: 'price', args: { item: 'визитки', copies: 500 } }],
    when: lastUserIncludes('Сколько'),
  },
  { say: 'Пятьсот визиток стоят 4500 ₽.', when: toolResultIncludes('"total":4500') },
];
