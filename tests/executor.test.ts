import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Capability } from '@/lib/registry';
import type {
  Payload,
  Plan,
  PlannedStep,
  ProviderAdapter,
  RunEvent,
  StepInput,
} from '@/lib/router/types';
import { RouterError } from '@/lib/router/types';

/**
 * The executor is tested against mock adapters only: proving composition and
 * fallback must never spend a request from a 1,000/day free pool.
 */
const invocations: Array<{ capId: string; payload: Payload }> = [];
const behaviours = new Map<string, (input: StepInput) => Payload>();

function mockAdapter(id: string): ProviderAdapter {
  return {
    id,
    isConfigured: () => true,
    async invoke(cap, input) {
      invocations.push({ capId: cap.id, payload: input.payload });
      const behaviour = behaviours.get(cap.id);
      if (!behaviour) {
        throw new RouterError({ kind: 'unavailable', retryable: true, message: `${cap.id} down` });
      }
      return { payload: behaviour(input), usage: { inputTokens: 10, outputTokens: 5 } };
    },
    normalizeError: (error) =>
      error instanceof RouterError
        ? error.normalized
        : { kind: 'unknown', retryable: true, message: String(error) },
  };
}

vi.mock('@/lib/providers', () => ({
  adapterFor: (provider: string) => mockAdapter(provider),
  ADAPTERS: {
    groq: { isConfigured: () => true },
    cloudflare: { isConfigured: () => true },
    openrouter: { isConfigured: () => true },
    browser: { isConfigured: () => true },
  },
}));

// Counters are irrelevant here and must not reach the network.
vi.mock('@/lib/quota/guard', () => ({
  commit: vi.fn(async () => undefined),
  penalize: vi.fn(async () => undefined),
  isHealthy: () => ({ bucket: 'x', healthy: true }),
}));

const { execute } = await import('@/lib/router/executor');

function cap(id: string, provider: string, emits: 'text' | 'image' | 'audio'): Capability {
  return {
    id,
    provider: provider as Capability['provider'],
    modelId: id,
    label: id,
    accepts: ['text'],
    emits,
    skills: ['chat'],
    freePlanEligible: true,
    quota: { bucket: `${provider}:test`, rpd: 100 },
    priority: 10,
  };
}

function step(index: number, title: string, candidates: Capability[], optional = false): PlannedStep {
  const to = candidates[0]?.emits ?? 'text';
  return {
    index,
    title,
    skill: 'chat',
    from: 'text',
    to,
    optional,
    candidates,
    recipeStep: { skill: 'chat', from: 'text', to, title },
  };
}

function makePlan(steps: PlannedStep[]): Plan {
  return {
    recipe: {
      pair: 'text->image',
      slug: 'text-to-image',
      title: 'Test pipeline',
      blurb: '',
      action: 'Run',
      steps: steps.map((s) => s.recipeStep),
    },
    steps,
  };
}

async function run(plan: Plan) {
  const events: RunEvent[] = [];
  const result = await execute({
    plan,
    input: { modality: 'text', text: 'seed' },
    visitorId: 'test-visitor',
    emit: (e) => events.push(e),
    signal: new AbortController().signal,
  });
  return { ...result, events };
}

beforeEach(() => {
  invocations.length = 0;
  behaviours.clear();
});

describe('execute', () => {
  it('threads each step output into the next step input', async () => {
    const a = cap('a:one', 'groq', 'text');
    const b = cap('b:two', 'groq', 'text');
    behaviours.set('a:one', (i) => ({
      modality: 'text',
      text: `${(i.payload as { text: string }).text}->A`,
    }));
    behaviours.set('b:two', (i) => ({
      modality: 'text',
      text: `${(i.payload as { text: string }).text}->B`,
    }));

    const { output, trace } = await run(makePlan([step(0, 'A', [a]), step(1, 'B', [b])]));

    expect(output).toEqual({ modality: 'text', text: 'seed->A->B' });
    expect(trace.steps).toHaveLength(2);
    expect(trace.fallbackOccurred).toBe(false);
  });

  it('retries ONLY the failed step and never re-runs completed work', async () => {
    const first = cap('first:ok', 'groq', 'text');
    const primary = cap('second:primary', 'groq', 'image');
    const backup = cap('second:backup', 'cloudflare', 'image');

    behaviours.set('first:ok', () => ({ modality: 'text', text: 'prompt' }));
    // primary has no behaviour, so it throws a retryable error.
    behaviours.set('second:backup', () => ({
      modality: 'image',
      base64: 'aW1n',
      mimeType: 'image/png',
    }));

    const { output, trace } = await run(
      makePlan([step(0, 'First', [first]), step(1, 'Second', [primary, backup])]),
    );

    expect(output).toEqual({ modality: 'image', base64: 'aW1n', mimeType: 'image/png' });

    // This is the whole point: step 0 ran exactly once even though step 1 fell
    // back. Re-planning the pipeline would have spent its quota twice.
    expect(invocations.filter((i) => i.capId === 'first:ok')).toHaveLength(1);
    expect(invocations.map((i) => i.capId)).toEqual([
      'first:ok',
      'second:primary',
      'second:backup',
    ]);

    expect(trace.fallbackOccurred).toBe(true);
    expect(trace.retryCount).toBe(1);
    expect(trace.steps[1]!.attempts).toHaveLength(2);
    expect(trace.steps[1]!.attempts[0]!.ok).toBe(false);
    expect(trace.steps[1]!.attempts[1]!.ok).toBe(true);
    expect(trace.steps[1]!.resolvedCapabilityId).toBe('second:backup');
  });

  it('records the fallback as a step_retry event so the UI can show it live', async () => {
    const primary = cap('p', 'groq', 'text');
    const backup = cap('b', 'cloudflare', 'text');
    behaviours.set('b', () => ({ modality: 'text', text: 'ok' }));

    const { events } = await run(makePlan([step(0, 'Only', [primary, backup])]));
    const retry = events.find((e) => e.type === 'step_retry');

    expect(retry).toMatchObject({ type: 'step_retry', index: 0, failed: 'p', next: 'b' });
  });

  it('skips an exhausted OPTIONAL step and passes its input straight through', async () => {
    const enrich = cap('enrich', 'groq', 'text');
    const generate = cap('generate', 'cloudflare', 'image');
    // enrich has no behaviour and no backup -> it fails, but it is optional.
    behaviours.set('generate', (i) => ({
      modality: 'image',
      base64: Buffer.from((i.payload as { text: string }).text).toString('base64'),
      mimeType: 'image/png',
    }));

    const { output, trace } = await run(
      makePlan([step(0, 'Enrich', [enrich], true), step(1, 'Generate', [generate])]),
    );

    // The raw seed reached generation unchanged rather than the task failing.
    expect(output).toMatchObject({ modality: 'image' });
    expect(Buffer.from((output as { base64: string }).base64, 'base64').toString()).toBe('seed');
    expect(trace.steps[0]!.skipped).toBe(true);
    expect(trace.error).toBeUndefined();
  });

  it('fails the task when a REQUIRED step exhausts every candidate', async () => {
    const only = cap('nope', 'groq', 'text');
    const { output, trace } = await run(makePlan([step(0, 'Required', [only])]));

    expect(output).toBeUndefined();
    expect(trace.error).toBeDefined();
    expect(trace.steps[0]!.resolvedCapabilityId).toBeUndefined();
  });

  it('stops immediately on a non-retryable error instead of burning the backup', async () => {
    const primary = cap('bad-input', 'groq', 'text');
    const backup = cap('would-work', 'cloudflare', 'text');
    behaviours.set('would-work', () => ({ modality: 'text', text: 'never reached' }));

    // Override: a bad_input error means OUR payload is wrong, so another model
    // will reject it identically -- trying it would waste quota.
    behaviours.set('bad-input', () => {
      throw new RouterError({ kind: 'bad_input', retryable: false, message: 'malformed' });
    });

    const { output, trace } = await run(makePlan([step(0, 'Strict', [primary, backup])]));

    expect(output).toBeUndefined();
    expect(invocations.map((i) => i.capId)).toEqual(['bad-input']);
    expect(trace.error?.kind).toBe('bad_input');
  });
});
