import type { Capability, Modality, Skill } from '../registry';
import type { Recipe, RecipeStep } from '../registry/recipes';

/* ------------------------------------------------------------------ payloads */

/** A value flowing between pipeline steps. Binary rides as base64, never a URL. */
export type TextPayload = { modality: 'text'; text: string };
export type ImagePayload = { modality: 'image'; base64: string; mimeType: string };
export type HostedAudioPayload = {
  modality: 'audio';
  base64: string;
  mimeType: string;
  durationSec?: number;
};
/**
 * The on-device voice route.
 *
 * The Web Speech API only exists in the visitor's browser, so the server cannot
 * return audio bytes for it. It hands back the text plus a marker and the client
 * speaks it locally. X-Ray labels this honestly as an on-device route rather
 * than dressing it up as a hosted model.
 */
export type OnDeviceAudioPayload = { modality: 'audio'; onDevice: true; text: string };

export type AudioPayload = HostedAudioPayload | OnDeviceAudioPayload;

export type Payload = TextPayload | ImagePayload | AudioPayload;

export function isOnDeviceAudio(p: Payload): p is OnDeviceAudioPayload {
  return p.modality === 'audio' && 'onDevice' in p;
}

export interface StepInput {
  payload: Payload;
  /** User's own instruction, kept alongside media for vision/chat steps. */
  instruction?: string;
  systemPrompt?: string;
}

export interface StepUsage {
  inputTokens?: number;
  outputTokens?: number;
  audioSeconds?: number;
  neurons?: number;
}

export interface StepOutput {
  payload: Payload;
  usage?: StepUsage;
}

/* -------------------------------------------------------------------- errors */

export type ErrorKind =
  | 'rate_limit'
  | 'quota_exhausted'
  | 'auth'
  | 'unavailable'
  | 'bad_input'
  | 'timeout'
  | 'unknown';

export interface NormalizedError {
  kind: ErrorKind;
  /** Whether trying a DIFFERENT model for this step is worth doing. */
  retryable: boolean;
  message: string;
  status?: number;
}

export class RouterError extends Error {
  constructor(
    readonly normalized: NormalizedError,
    readonly capabilityId?: string,
  ) {
    super(normalized.message);
    this.name = 'RouterError';
  }
}

/* --------------------------------------------------------------- the adapter */

export interface ProviderAdapter {
  id: string;
  /** False when the required credentials are absent from the environment. */
  isConfigured(): boolean;
  invoke(cap: Capability, input: StepInput, signal: AbortSignal): Promise<StepOutput>;
  normalizeError(error: unknown): NormalizedError;
}

/* ----------------------------------------------------------------- planning */

export interface PlannedStep {
  index: number;
  title: string;
  skill: Skill;
  from: Modality;
  to: Modality;
  optional: boolean;
  systemPrompt?: string;
  /** Ordered, already filtered by configuration and live quota health. */
  candidates: Capability[];
  recipeStep: RecipeStep;
}

export interface Plan {
  recipe: Recipe;
  steps: PlannedStep[];
}

/* -------------------------------------------------------------------- X-Ray */

export interface AttemptTrace {
  capabilityId: string;
  provider: string;
  model: string;
  label: string;
  ok: boolean;
  latencyMs: number;
  usage?: StepUsage;
  error?: NormalizedError;
}

/** Human-readable shape of a payload, e.g. '51 KB image' or '4s audio'. */
export interface PayloadSummary {
  modality: Modality;
  label: string;
  bytes?: number;
  chars?: number;
  durationSec?: number;
}

export interface StepTrace {
  index: number;
  title: string;
  from: Modality;
  to: Modality;
  /** Every attempt in order; length > 1 means a fallback happened here. */
  attempts: AttemptTrace[];
  /** The attempt that produced the output, if any. */
  resolvedCapabilityId?: string;
  skipped?: boolean;
  latencyMs: number;
  /** What actually went in and came out of this step. */
  input?: PayloadSummary;
  output?: PayloadSummary;
}

/** Everything this run consumed, summed across steps. */
export interface UsageTotals {
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  audioSeconds: number;
  neurons: number;
  /** Billable upstream calls -- failed attempts count too. */
  providerCalls: number;
}

/**
 * What this run drew from each free-tier budget.
 *
 * The whole point of the product is that free quota is finite and shared, so
 * X-Ray shows the cost of what you just did, not only its speed.
 */
export interface BucketConsumption {
  bucket: string;
  provider: string;
  requests: number;
  tokens?: number;
  audioSeconds?: number;
  neurons?: number;
  /** Daily ceiling for the dimension that matters most on this bucket. */
  limitLabel?: string;
}

export interface XRayTrace {
  pair: string;
  task: string;
  totalLatencyMs: number;
  providersUsed: string[];
  fallbackOccurred: boolean;
  retryCount: number;
  steps: StepTrace[];
  totals: UsageTotals;
  consumption: BucketConsumption[];
  /** Wall-clock time not spent waiting on a provider (routing, encoding). */
  overheadMs: number;
  startedAt: string;
  /** Populated when the whole task failed. */
  error?: NormalizedError;
}

/* ------------------------------------------------------------- SSE protocol */

export type RunEvent =
  | { type: 'plan'; pair: string; steps: Array<{ index: number; title: string; candidate: string }> }
  | { type: 'step_start'; index: number; title: string; capabilityId: string; label: string }
  | { type: 'step_retry'; index: number; failed: string; next: string; reason: string }
  | { type: 'step_done'; index: number; capabilityId: string; latencyMs: number; usage?: StepUsage }
  | { type: 'step_skipped'; index: number; reason: string }
  | { type: 'result'; payload: Payload }
  | { type: 'trace'; trace: XRayTrace }
  | { type: 'error'; error: NormalizedError };
