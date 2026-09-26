/**
 * Core domain vocabulary for the router.
 *
 * Everything the planner and executor know about providers comes from data
 * shaped by these types -- never from branching inside a route handler.  Free
 * tiers change monthly, so retiring a model must be a one-line data edit.
 */

export type Modality = 'text' | 'image' | 'audio';

export type Skill =
  | 'chat' // text -> text
  | 'vision' // text+image -> text
  | 'transcribe' // audio -> text
  | 'image-gen' // text -> image
  | 'tts'; // text -> audio

export type ProviderId = 'groq' | 'cloudflare' | 'openrouter' | 'browser';

/**
 * Budget dimensions a single call draws from.
 *
 * `bucket` matters more than it looks: Groq enforces its limits at the
 * ORGANISATION level, so every free chat model shares one pool.  Two models
 * with the same bucket must decrement the same counters.
 */
export interface QuotaSpec {
  bucket: string;
  rpm?: number;
  rpd?: number;
  tpm?: number;
  tpd?: number;
  audioSecPerDay?: number;
  audioSecPerHour?: number;
  /**
   * Output tokens per minute.
   *
   * Groq enforces this SEPARATELY from the token budget in its rate-limit
   * headers, and it is far tighter: 1,000 OTPM on qwen3.8-27b versus 8,000
   * input TPM. It only surfaces in the 429 body, never in a header.
   */
  otpm?: number;
  /** Cloudflare only: estimated neuron cost of one call, against 10k/day. */
  neuronsPerCall?: number;
}

export interface Capability {
  /** Stable identity, e.g. 'groq:whisper-large-v3-turbo'. */
  id: string;
  provider: ProviderId;
  /** Exact model id as the provider's API expects it. */
  modelId: string;
  label: string;
  accepts: Modality[];
  emits: Modality;
  skills: Skill[];
  /**
   * False for models that exist in a provider's catalogue but require a paid
   * plan.  The registry filters these out unconditionally -- the zero-cost
   * constraint is enforced here, not by remembering not to use them.
   */
  freePlanEligible: boolean;
  quota: QuotaSpec;
  /** Lower wins. Ties broken by declaration order. */
  priority: number;
  maxInputBytes?: number;
  maxAudioSeconds?: number;
  /**
   * Ceiling on generated tokens for one call.
   *
   * Must stay BELOW the model's OTPM or a single request can be rejected
   * outright for reserving more than the whole per-minute output budget.
   */
  maxOutputTokens?: number;
  /**
   * Extra provider-specific body fields for this model.
   *
   * Models in the same family disagree about their own parameters -- FLUX
   * Schnell REJECTS width/height that SDXL requires -- so the shape belongs
   * with the model in the registry, not in an if-chain inside the adapter.
   */
  providerParams?: Record<string, unknown>;
  notes?: string;
}

export interface CapabilityQuery {
  skill: Skill;
  accepts?: Modality;
  emits?: Modality;
}
