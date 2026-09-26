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
  notes?: string;
}

export interface CapabilityQuery {
  skill: Skill;
  accepts?: Modality;
  emits?: Modality;
}
