import { Effect } from 'effect';
import { describe, expect, it } from 'vitest';

import { cost, DEEPSEEK_FLASH } from './client';
import { loadConfig } from './config';
import { ConfigError } from './errors';

describe('loadConfig', () => {
  it('defaults to bolvanka', async () => {
    const config = await Effect.runPromise(loadConfig({}));
    expect(config).toEqual({ model: 'bolvanka' });
  });

  it('requires DEEPSEEK_API_KEY for deepseek', async () => {
    const error = await Effect.runPromise(Effect.flip(loadConfig({ MODEL: 'deepseek' })));
    expect(error).toBeInstanceOf(ConfigError);
    expect(error.message).toContain('DEEPSEEK_API_KEY');
  });

  it('accepts deepseek with a key', async () => {
    const config = await Effect.runPromise(
      loadConfig({ MODEL: 'deepseek', DEEPSEEK_API_KEY: 'sk-test' }),
    );
    expect(config).toEqual({ model: 'deepseek', apiKey: 'sk-test' });
  });

  it('rejects unknown MODEL', async () => {
    const error = await Effect.runPromise(Effect.flip(loadConfig({ MODEL: 'claude' })));
    expect(error.message).toContain('бывает bolvanka или deepseek');
  });
});

describe('cost', () => {
  it('prices a million tokens at the listed rate', () => {
    expect(cost(1_000_000, 0, DEEPSEEK_FLASH.offPeak)).toBeCloseTo(0.15);
    expect(cost(0, 1_000_000, DEEPSEEK_FLASH.offPeak)).toBeCloseTo(0.6);
  });
});
