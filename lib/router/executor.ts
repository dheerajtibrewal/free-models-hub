import type { Capability } from '../registry';
import { adapterFor } from '../providers';
import { commit, penalize, type UsageRecord } from '../quota/guard';
import { numberFromEnv } from '../env';
import type {
  AttemptTrace,
  BucketConsumption,
  NormalizedError,
  Payload,
  PayloadSummary,
  Plan,
  PlannedStep,
  RunEvent,
  StepInput,
  StepTrace,
  UsageTotals,
  XRayTrace,
} from './types';
import { isOnDeviceAudio } from './types';
import { RouterError } from './types';

export interface ExecuteArgs {
  plan: Plan;
  /** The user's original input, feeding step 0. */
  input: Payload;
  /** Free-text instruction that rides alongside media inputs. */
  instruction?: string;
  visitorId: string;
  emit: (event: RunEvent) => void;
  signal: AbortSignal;
}

export interface ExecuteResult {
  output?: Payload;
  trace: XRayTrace;
}

// Read per-call rather than at module load, so a misconfigured value cannot be
// frozen in at cold start. `min` rejects a 0 that would abort every request
// before it left the building.
const stepTimeoutMs = () => numberFromEnv('STEP_TIMEOUT_MS', 45_000, { min: 1000, max: 55_000 });

/**
 * Run a plan step by step.
 *
 * Fallback is deliberately scoped to the FAILING STEP rather than the pipeline:
 * completed steps keep their outputs, so a failure in image generation never
 * re-spends the transcription and prompt-rewrite calls that already succeeded.
 * On a three-step audio->image task that is the difference between burning one
 * extra call and burning four.
 */
export async function execute(args: ExecuteArgs): Promise<ExecuteResult> {
  const { plan, emit, signal, visitorId } = args;
  const startedAt = Date.now();

  const steps: StepTrace[] = [];
  const usageRecords: UsageRecord[] = [];
  const providersUsed = new Set<string>();
  let retryCount = 0;
  let fallbackOccurred = false;

  let current: Payload = args.input;
  let carriedInstruction = args.instruction;
  let failure: NormalizedError | undefined;

  for (const step of plan.steps) {
    const stepStart = Date.now();
    const stepInputSummary = summarizePayload(current);
    const attempts: AttemptTrace[] = [];
    let produced: Payload | undefined;
    let resolvedCapabilityId: string | undefined;

    for (let i = 0; i < step.candidates.length; i++) {
      const cap = step.candidates[i];
      if (!cap) break;

      emit({
        type: 'step_start',
        index: step.index,
        title: step.title,
        capabilityId: cap.id,
        label: cap.label,
      });

      const attemptStart = Date.now();
      try {
        const output = await invokeWithTimeout(cap, buildInput(step, current, carriedInstruction), signal);
        const latencyMs = Date.now() - attemptStart;

        attempts.push({
          capabilityId: cap.id,
          provider: cap.provider,
          model: cap.modelId,
          label: cap.label,
          ok: true,
          latencyMs,
          usage: output.usage,
        });

        usageRecords.push({ capability: cap, usage: output.usage });
        providersUsed.add(cap.provider);
        produced = output.payload;
        resolvedCapabilityId = cap.id;

        emit({
          type: 'step_done',
          index: step.index,
          capabilityId: cap.id,
          latencyMs,
          usage: output.usage,
        });
        break;
      } catch (error) {
        const normalized = adapterFor(cap.provider).normalizeError(error);
        const latencyMs = Date.now() - attemptStart;

        attempts.push({
          capabilityId: cap.id,
          provider: cap.provider,
          model: cap.modelId,
          label: cap.label,
          ok: false,
          latencyMs,
          error: normalized,
        });

        // Record the 429 so the NEXT request skips this model instead of
        // spending another call to rediscover the same limit.
        if (normalized.kind === 'rate_limit') {
          void penalize(cap);
        }

        if (signal.aborted) {
          failure = { kind: 'timeout', retryable: false, message: 'run cancelled' };
          break;
        }

        const next = step.candidates[i + 1];
        if (!normalized.retryable || !next) {
          failure = normalized;
          break;
        }

        retryCount++;
        fallbackOccurred = true;
        emit({
          type: 'step_retry',
          index: step.index,
          failed: cap.label,
          next: next.label,
          reason: normalized.message.slice(0, 160),
        });
      }
    }

    const latencyMs = Date.now() - stepStart;

    if (!produced) {
      // An optional step is a quality improvement, not a modality bridge: pass
      // its input straight through rather than failing the whole task.
      if (step.optional) {
        steps.push({
          index: step.index,
          title: step.title,
          from: step.from,
          to: step.to,
          attempts,
          skipped: true,
          latencyMs,
          input: stepInputSummary,
          output: stepInputSummary,
        });
        emit({
          type: 'step_skipped',
          index: step.index,
          reason:
            attempts.length === 0
              ? 'no free model available for this optional step'
              : (failure?.message ?? 'optional step unavailable').slice(0, 160),
        });
        failure = undefined;
        continue;
      }

      steps.push({
        index: step.index,
        title: step.title,
        from: step.from,
        to: step.to,
        attempts,
        latencyMs,
        input: stepInputSummary,
      });

      const trace = buildTrace(
        plan,
        steps,
        providersUsed,
        retryCount,
        fallbackOccurred,
        startedAt,
        usageRecords,
        failure,
      );
      await commit(visitorId, usageRecords, false);
      emit({ type: 'trace', trace });
      return { trace };
    }

    steps.push({
      index: step.index,
      title: step.title,
      from: step.from,
      to: step.to,
      attempts,
      resolvedCapabilityId,
      latencyMs,
      input: stepInputSummary,
      output: summarizePayload(produced),
    });

    current = produced;
    // The user's instruction applies to the first step only; downstream steps
    // consume the previous step's output as their whole input.
    carriedInstruction = undefined;
  }

  const trace = buildTrace(
    plan,
    steps,
    providersUsed,
    retryCount,
    fallbackOccurred,
    startedAt,
    usageRecords,
  );

  // Only a run that actually produced output charges the visitor's allowance.
  await commit(visitorId, usageRecords, true);

  emit({ type: 'result', payload: current });
  emit({ type: 'trace', trace });

  return { output: current, trace };
}

function buildInput(step: PlannedStep, payload: Payload, instruction?: string): StepInput {
  return {
    payload,
    instruction,
    systemPrompt: step.systemPrompt,
  };
}

async function invokeWithTimeout(cap: Capability, input: StepInput, outer: AbortSignal) {
  const adapter = adapterFor(cap.provider);
  if (!adapter) {
    throw new RouterError({
      kind: 'unavailable',
      retryable: true,
      message: `no adapter for provider ${cap.provider}`,
    });
  }

  const controller = new AbortController();
  const onAbort = () => controller.abort();
  outer.addEventListener('abort', onAbort, { once: true });
  const timer = setTimeout(() => controller.abort(), stepTimeoutMs());

  try {
    return await adapter.invoke(cap, input, controller.signal);
  } finally {
    clearTimeout(timer);
    outer.removeEventListener('abort', onAbort);
  }
}

function buildTrace(
  plan: Plan,
  steps: StepTrace[],
  providersUsed: Set<string>,
  retryCount: number,
  fallbackOccurred: boolean,
  startedAt: number,
  usageRecords: UsageRecord[],
  error?: NormalizedError,
): XRayTrace {
  const totalLatencyMs = Date.now() - startedAt;
  // Every attempt counts as a provider call -- a failed one still cost a
  // request against somebody's quota.
  const allAttempts = steps.flatMap((s) => s.attempts);
  const providerCalls = allAttempts.filter((a) => a.provider !== 'browser').length;
  const upstreamMs = allAttempts.reduce((sum, a) => sum + a.latencyMs, 0);

  const totals: UsageTotals = {
    inputTokens: 0,
    outputTokens: 0,
    totalTokens: 0,
    audioSeconds: 0,
    neurons: 0,
    providerCalls,
  };
  for (const a of allAttempts) {
    totals.inputTokens += a.usage?.inputTokens ?? 0;
    totals.outputTokens += a.usage?.outputTokens ?? 0;
    totals.audioSeconds += a.usage?.audioSeconds ?? 0;
    totals.neurons += a.usage?.neurons ?? 0;
  }
  totals.totalTokens = totals.inputTokens + totals.outputTokens;

  return {
    pair: plan.recipe.pair,
    task: plan.recipe.title,
    totalLatencyMs,
    providersUsed: [...providersUsed],
    fallbackOccurred,
    retryCount,
    steps,
    totals,
    consumption: summarizeConsumption(usageRecords),
    overheadMs: Math.max(0, totalLatencyMs - upstreamMs),
    startedAt: new Date(startedAt).toISOString(),
    error,
  };
}

/** Roll per-call usage up into the free-tier budgets it actually drew from. */
function summarizeConsumption(records: UsageRecord[]): BucketConsumption[] {
  const byBucket = new Map<string, BucketConsumption>();

  for (const { capability, usage } of records) {
    if (capability.provider === 'browser') continue;
    const { bucket, rpd, tpd, audioSecPerDay, neuronsPerCall } = capability.quota;

    const entry = byBucket.get(bucket) ?? {
      bucket,
      provider: capability.provider,
      requests: 0,
      limitLabel: rpd
        ? `${rpd.toLocaleString()} requests/day`
        : neuronsPerCall
          ? '10,000 neurons/day'
          : undefined,
    };

    entry.requests += 1;
    const tokens = (usage?.inputTokens ?? 0) + (usage?.outputTokens ?? 0);
    if (tpd !== undefined && tokens > 0) entry.tokens = (entry.tokens ?? 0) + tokens;
    if (audioSecPerDay !== undefined && usage?.audioSeconds) {
      entry.audioSeconds = (entry.audioSeconds ?? 0) + usage.audioSeconds;
    }
    if (neuronsPerCall !== undefined) {
      entry.neurons = (entry.neurons ?? 0) + (usage?.neurons ?? neuronsPerCall);
    }
    byBucket.set(bucket, entry);
  }

  return [...byBucket.values()];
}

/** Describe a payload without carrying its bytes into the trace. */
function summarizePayload(payload: Payload): PayloadSummary {
  if (payload.modality === 'text') {
    const chars = payload.text.length;
    return {
      modality: 'text',
      chars,
      label: `${chars.toLocaleString()} chars`,
    };
  }
  if (isOnDeviceAudio(payload)) {
    return { modality: 'audio', label: 'on-device voice', chars: payload.text.length };
  }
  const bytes = Math.round((payload.base64.length * 3) / 4);
  const size = bytes > 1024 * 1024 ? `${(bytes / 1048576).toFixed(1)} MB` : `${Math.round(bytes / 1024)} KB`;
  if (payload.modality === 'audio') {
    return {
      modality: 'audio',
      bytes,
      durationSec: payload.durationSec,
      label: payload.durationSec ? `${Math.round(payload.durationSec)}s · ${size}` : size,
    };
  }
  return { modality: 'image', bytes, label: size };
}
