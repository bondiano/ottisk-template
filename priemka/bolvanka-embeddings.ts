/**
Эмбеддинги Болванки: детерминированный вектор из символьных триграмм.

Текст приводится к нижнему регистру, «ё» становится «е», всё, кроме букв и цифр,
становится пробелом, по краям добавляется по пробелу. Каждая триграмма (три подряд
идущих символа) хэшируется FNV-1a в одну из `dimensions` ячеек, вектор нормируется
до длины 1. Строки с общими кусками слов получаются близкими по косинусу, поэтому
поиск ведёт себя правдоподобно. Смысла вектор не знает: «бумага» и «картон» далеки,
а «ламинация» и «ламинировать» близки. Пустой текст даёт нулевой вектор.
*/

export const EMBEDDING_DIMENSIONS = 256;

const normalize = (text: string): string =>
  ` ${text
    .toLowerCase()
    .replaceAll('ё', 'е')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim()} `;

export const trigrams = (text: string): string[] => {
  const chars = [...normalize(text)];
  return chars.slice(2).map((_, index) => chars.slice(index, index + 3).join(''));
};

const fnv1a = (text: string): number => {
  let hash = 0x811c9dc5;
  for (const char of text) {
    hash ^= char.codePointAt(0) ?? 0;
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash;
};

export const embed = (text: string, dimensions = EMBEDDING_DIMENSIONS): number[] => {
  const vector = Array.from({ length: dimensions }, () => 0);
  for (const gram of trigrams(text)) {
    const cell = fnv1a(gram) % dimensions;
    vector[cell] = (vector[cell] ?? 0) + 1;
  }
  const norm = Math.sqrt(vector.reduce((sum, x) => sum + x * x, 0));
  return norm === 0 ? vector : vector.map((x) => x / norm);
};

// SDK openai по умолчанию просит encoding_format: 'base64' и сам разбирает float32.
const base64 = (vector: readonly number[]): string => {
  const bytes = new Uint8Array(Float32Array.from(vector).buffer);
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
};

export const embeddingData = (
  inputs: readonly string[],
  asBase64: boolean,
  dimensions: number | undefined,
) =>
  inputs.map((text, index) => {
    const vector = embed(text, dimensions);
    return { object: 'embedding', index, embedding: asBase64 ? base64(vector) : vector };
  });
