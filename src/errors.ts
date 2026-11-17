import { Data } from 'effect';

/** MODEL или ключ не сходятся с тем, что ждёт команда. */
export class ConfigError extends Data.TaggedError('ConfigError')<{
  readonly message: string;
}> {}

/** Вызов модели или приёмщика упал ожидаемо. */
export class RunError extends Data.TaggedError('RunError')<{
  readonly message: string;
  readonly cause?: unknown;
}> {}
