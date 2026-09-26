import { afterEach, describe, expect, it } from 'vitest';
import { booleanFromEnv, numberFromEnv, stringFromEnv } from '@/lib/env';

afterEach(() => {
  delete process.env.TEST_NUM;
  delete process.env.TEST_BOOL;
  delete process.env.TEST_STR;
});

/**
 * Regression suite for the bug that took production down twice.
 *
 * A variable defined in a hosting dashboard but left blank arrives as '', and
 * `Number('' ?? 45000)` is 0 -- not the fallback. That turned a 45s step
 * timeout into 0ms, so every upstream call aborted in ~3ms and the whole site
 * reported "step timed out" while working perfectly in local dev, where the
 * variable was simply absent.
 */
describe('numberFromEnv', () => {
  it('falls back when the variable is absent', () => {
    expect(numberFromEnv('TEST_NUM', 45_000)).toBe(45_000);
  });

  it('falls back when the variable is defined but EMPTY', () => {
    process.env.TEST_NUM = '';
    expect(numberFromEnv('TEST_NUM', 45_000)).toBe(45_000);
  });

  it('falls back on whitespace', () => {
    process.env.TEST_NUM = '   ';
    expect(numberFromEnv('TEST_NUM', 45_000)).toBe(45_000);
  });

  it('falls back on a non-numeric value rather than returning NaN', () => {
    process.env.TEST_NUM = 'forty-five thousand';
    expect(numberFromEnv('TEST_NUM', 45_000)).toBe(45_000);
  });

  it('rejects a value below min -- a 0 timeout aborts every call instantly', () => {
    process.env.TEST_NUM = '0';
    expect(numberFromEnv('TEST_NUM', 45_000, { min: 1000 })).toBe(45_000);
  });

  it('rejects negatives', () => {
    process.env.TEST_NUM = '-1';
    expect(numberFromEnv('TEST_NUM', 45_000)).toBe(45_000);
  });

  it('clamps back to the fallback above max', () => {
    // A step timeout longer than the platform function limit is unusable.
    process.env.TEST_NUM = '999999';
    expect(numberFromEnv('TEST_NUM', 45_000, { max: 55_000 })).toBe(45_000);
  });

  it('uses a genuinely valid value', () => {
    process.env.TEST_NUM = '30000';
    expect(numberFromEnv('TEST_NUM', 45_000, { min: 1000, max: 55_000 })).toBe(30_000);
  });

  it('never returns 0, NaN or a negative for any input', () => {
    for (const v of ['', ' ', 'abc', '0', '-5', 'NaN', 'Infinity', '1e999']) {
      process.env.TEST_NUM = v;
      const n = numberFromEnv('TEST_NUM', 45_000, { min: 1000, max: 55_000 });
      expect(Number.isFinite(n)).toBe(true);
      expect(n).toBeGreaterThan(0);
    }
  });
});

describe('stringFromEnv', () => {
  it('treats empty and whitespace as absent, never returning an empty string', () => {
    for (const v of ['', '   ']) {
      process.env.TEST_STR = v;
      expect(stringFromEnv('TEST_STR')).toBeUndefined();
    }
  });

  it('trims a real value', () => {
    process.env.TEST_STR = '  diana  ';
    expect(stringFromEnv('TEST_STR')).toBe('diana');
  });
});

describe('booleanFromEnv', () => {
  it('treats blank as the fallback, not as false-by-accident', () => {
    process.env.TEST_BOOL = '';
    expect(booleanFromEnv('TEST_BOOL', true)).toBe(true);
  });

  it('accepts the usual affirmatives and negatives', () => {
    for (const v of ['1', 'true', 'YES', 'on']) {
      process.env.TEST_BOOL = v;
      expect(booleanFromEnv('TEST_BOOL')).toBe(true);
    }
    for (const v of ['0', 'false', 'NO', 'off']) {
      process.env.TEST_BOOL = v;
      expect(booleanFromEnv('TEST_BOOL')).toBe(false);
    }
  });
});
