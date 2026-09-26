import { describe, expect, it } from 'vitest';
import { statusToError } from '@/lib/providers/http';

/**
 * Error classification decides whether fallback happens at all, so a
 * misclassified status silently removes a route's safety net.
 */
describe('statusToError', () => {
  it('treats 429 as retryable so the next candidate is tried', () => {
    const e = statusToError(429, 'rate limit exceeded');
    expect(e.kind).toBe('rate_limit');
    expect(e.retryable).toBe(true);
  });

  it('keeps auth failures retryable -- a different PROVIDER may still work', () => {
    expect(statusToError(401, 'bad key').retryable).toBe(true);
    expect(statusToError(403, 'forbidden').retryable).toBe(true);
  });

  it('treats a genuine payload error as non-retryable', () => {
    const e = statusToError(400, 'messages[0].content must be a string');
    expect(e.kind).toBe('bad_input');
    expect(e.retryable).toBe(false);
  });

  // Regression: Groq returns 400 model_terms_required for a model whose licence
  // the org has not accepted. Classifying that as bad_input stopped the run dead
  // and text->audio failed instead of falling through to the on-device voice.
  it('keeps a provider-side 400 retryable so fallback still runs', () => {
    const terms = statusToError(
      400,
      '{"error":{"message":"The model `canopylabs/orpheus-v1-english` requires terms acceptance.","code":"model_terms_required"}}',
    );
    expect(terms.kind).toBe('unavailable');
    expect(terms.retryable).toBe(true);
  });

  it('keeps a decommissioned-model 400 retryable', () => {
    for (const detail of [
      'model has been decommissioned',
      'The model `foo` does not exist',
      'this model is no longer supported',
    ]) {
      expect(statusToError(400, detail).retryable).toBe(true);
    }
  });

  it('treats 5xx and 404 as retryable', () => {
    expect(statusToError(500, 'boom').retryable).toBe(true);
    expect(statusToError(503, 'overloaded').retryable).toBe(true);
    expect(statusToError(404, 'no such model').retryable).toBe(true);
  });
});
