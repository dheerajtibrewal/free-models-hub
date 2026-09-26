import { beforeEach, describe, expect, it } from 'vitest';
import { RECIPES, recipeBySlug } from '@/lib/registry';
import { plan } from '@/lib/router/planner';
import { RouterError } from '@/lib/router/types';
import type { QuotaSnapshot } from '@/lib/quota/guard';
import { FIELD } from '@/lib/quota/keys';

/** All providers configured, nothing consumed. */
function freshSnapshot(buckets: Record<string, Record<string, number>> = {}): QuotaSnapshot {
  return { visitorUsed: 0, visitorLimit: 15, buckets, degraded: false };
}

beforeEach(() => {
  process.env.GROQ_API_KEY = 'test';
  process.env.CLOUDFLARE_ACCOUNT_ID = 'test';
  process.env.CLOUDFLARE_API_TOKEN = 'test';
  process.env.OPENROUTER_API_KEY = 'test';
});

describe('recipes', () => {
  it('covers seven modality pairs with unique slugs', () => {
    expect(RECIPES).toHaveLength(7);
    expect(new Set(RECIPES.map((r) => r.slug)).size).toBe(7);
    expect(new Set(RECIPES.map((r) => r.pair)).size).toBe(7);
  });

  it('chains each recipe so every step consumes the previous step output', () => {
    for (const recipe of RECIPES) {
      for (let i = 1; i < recipe.steps.length; i++) {
        expect(recipe.steps[i]!.from).toBe(recipe.steps[i - 1]!.to);
      }
    }
  });
});

describe('plan', () => {
  it('resolves every recipe to at least one candidate per required step', () => {
    for (const recipe of RECIPES) {
      const resolved = plan(recipe, freshSnapshot());
      for (const step of resolved.steps) {
        if (!step.optional) expect(step.candidates.length).toBeGreaterThan(0);
      }
    }
  });

  it('composes audio->image as transcribe -> prompt rewrite -> image generation', () => {
    const resolved = plan(recipeBySlug('audio-to-image')!, freshSnapshot());
    expect(resolved.steps.map((s) => s.skill)).toEqual(['transcribe', 'chat', 'image-gen']);

    // The middle step is what a pure modality graph search would omit: it is
    // there for quality, not to bridge a gap, so it must carry a system prompt.
    expect(resolved.steps[1]!.systemPrompt).toBeTruthy();
  });

  it('orders candidates by priority so the most generous free tier wins', () => {
    const resolved = plan(recipeBySlug('audio-to-text')!, freshSnapshot());
    const ids = resolved.steps[0]!.candidates.map((c) => c.id);
    expect(ids[0]).toBe('groq:whisper-large-v3-turbo');
    // Cloudflare Whisper exists but sits behind Groq's larger free budget.
    expect(ids).toContain('cloudflare:whisper-turbo');
    expect(ids.indexOf('groq:whisper-large-v3-turbo')).toBeLessThan(
      ids.indexOf('cloudflare:whisper-turbo'),
    );
  });

  it('drops a model whose daily request budget is spent', () => {
    const exhausted = freshSnapshot({ 'groq:whisper': { [FIELD.rpd]: 2000 } });
    const resolved = plan(recipeBySlug('audio-to-text')!, exhausted);
    const ids = resolved.steps[0]!.candidates.map((c) => c.id);

    expect(ids).not.toContain('groq:whisper-large-v3-turbo');
    expect(ids).not.toContain('groq:whisper-large-v3');
    // Still routable: Cloudflare picks it up.
    expect(ids[0]).toBe('cloudflare:whisper-turbo');
  });

  it('refuses text->image once the neuron pool cannot fund another image', () => {
    // Image generation is Cloudflare-only, so an exhausted neuron pool makes the
    // whole route unroutable -- and it must fail at PLAN time, before the
    // optional enrichment step spends a Groq call it can never cash in.
    const exhausted = freshSnapshot({ 'cloudflare:neurons': { [FIELD.neurons]: 9_990 } });
    expect(() => plan(recipeBySlug('text-to-image')!, exhausted)).toThrow(/daily allowance/);
  });

  it('reports an unconfigured provider distinctly from an exhausted one', () => {
    // These are different problems with different fixes; conflating them sends
    // the operator chasing quota when the real issue is a missing key.
    delete process.env.CLOUDFLARE_ACCOUNT_ID;
    delete process.env.CLOUDFLARE_API_TOKEN;
    try {
      plan(recipeBySlug('text-to-image')!, freshSnapshot());
      throw new Error('expected plan to throw');
    } catch (e) {
      expect(e).toBeInstanceOf(RouterError);
      expect((e as RouterError).normalized.kind).toBe('unavailable');
      expect((e as RouterError).normalized.message).toMatch(/isn't configured/);
    }
  });

  it('reports exhausted quota as quota_exhausted when a model does exist', () => {
    const exhausted = freshSnapshot({ 'cloudflare:neurons': { [FIELD.neurons]: 10_000 } });
    try {
      plan(recipeBySlug('text-to-image')!, exhausted);
      throw new Error('expected plan to throw');
    } catch (e) {
      expect((e as RouterError).normalized.kind).toBe('quota_exhausted');
    }
  });

  it('keeps a Cloudflare image model while the pool can still fund one call', () => {
    // 58 neurons per image against a 10k pool: 9,900 used still leaves room.
    const nearlySpent = freshSnapshot({ 'cloudflare:neurons': { [FIELD.neurons]: 9_900 } });
    const resolved = plan(recipeBySlug('text-to-image')!, nearlySpent);
    expect(resolved.steps.find((s) => s.skill === 'image-gen')!.candidates.length).toBeGreaterThan(0);
  });

  it('excludes providers with no credentials', () => {
    delete process.env.GROQ_API_KEY;
    const resolved = plan(recipeBySlug('text-to-text')!, freshSnapshot());
    expect(resolved.steps[0]!.candidates.every((c) => c.provider !== 'groq')).toBe(true);
  });

  it('fails before spending anything when a required step has no route', () => {
    delete process.env.CLOUDFLARE_ACCOUNT_ID;
    delete process.env.CLOUDFLARE_API_TOKEN;
    // Image generation only exists on Cloudflare, so text->image becomes unroutable.
    expect(() => plan(recipeBySlug('text-to-image')!, freshSnapshot())).toThrow(RouterError);
  });

  it('tolerates an unroutable OPTIONAL step instead of failing the task', () => {
    // Prompt enrichment is optional; with no chat provider it must be skippable
    // while image generation still resolves.
    delete process.env.GROQ_API_KEY;
    delete process.env.OPENROUTER_API_KEY;
    const resolved = plan(recipeBySlug('text-to-image')!, freshSnapshot(), {
      onlyCapabilityIds: ['cloudflare:flux-1-schnell'],
    });

    const enrich = resolved.steps.find((s) => s.skill === 'chat')!;
    expect(enrich.optional).toBe(true);
    expect(enrich.candidates).toHaveLength(0);
    expect(resolved.steps.find((s) => s.skill === 'image-gen')!.candidates).toHaveLength(1);
  });

  it('never offers a model that is not free-plan eligible', () => {
    for (const recipe of RECIPES) {
      for (const step of plan(recipe, freshSnapshot()).steps) {
        expect(step.candidates.every((c) => c.freePlanEligible)).toBe(true);
      }
    }
  });
});
