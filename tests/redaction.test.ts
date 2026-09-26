import { describe, expect, it } from 'vitest';
import { redact, statusToError } from '@/lib/providers/http';

/**
 * Provider errors are shown verbatim in X-Ray on purpose -- that transparency
 * is the product. But the raw text carries account identifiers that must never
 * reach a public browser payload.
 *
 * NOTE: every credential below is synthetic. Never paste a real key into a
 * test fixture -- this file is committed, and a redaction test that leaks the
 * secrets it redacts defeats its own purpose.
 */
describe('redact', () => {
  it('strips the Groq organisation id', () => {
    const real =
      'Rate limit reached for model `qwen/qwen3.8-27b` in organization `org_01EXAMPLEFAKEORGID000000` service tier `on_demand`';
    const safe = redact(real);
    expect(safe).not.toContain('org_01EXAMPLEFAKEORGID000000');
    expect(safe).toContain('org_[redacted]');
    // The useful part of the message must survive.
    expect(safe).toContain('Rate limit reached');
    expect(safe).toContain('qwen/qwen3.8-27b');
  });

  it('strips a Cloudflare account id from a URL', () => {
    const safe = redact('POST /client/v4/accounts/abcdef0123456789abcdef0123456789/ai/run failed');
    expect(safe).not.toContain('abcdef0123456789abcdef0123456789');
  });

  it('strips API keys of every provider shape', () => {
    const safe = redact(
      'auth failed for gsk_FAKEEXAMPLEKEY0000000000000000 and sk-or-v1-0000fake1111example2222key3333 and cfat_FAKEEXAMPLETOKEN0000000000',
    );
    expect(safe).not.toMatch(/gsk_[A-Za-z0-9]{12,}/);
    expect(safe).not.toMatch(/sk-or-v1-[a-f0-9]{12,}/);
    expect(safe).not.toMatch(/cfat_[A-Za-z0-9]{12,}/);
  });

  it('strips any 32-char hex identifier', () => {
    expect(redact('id 0123456789abcdef0123456789abcdef here')).toContain('[redacted-id]');
  });

  it('leaves ordinary error text untouched', () => {
    const plain = 'The model requires terms acceptance. Please accept at the console.';
    expect(redact(plain)).toBe(plain);
  });

  it('redacts through the status mapper, which is what the adapters call', () => {
    const e = statusToError(429, 'limit for org `org_01EXAMPLEFAKEORGID000000` reached');
    expect(e.message).not.toContain('org_01EXAMPLEFAKEORGID000000');
  });
});
