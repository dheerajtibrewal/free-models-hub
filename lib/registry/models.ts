import type { Capability } from './types';

/**
 * The capability catalogue.
 *
 * VERIFY BEFORE TRUSTING: free tiers and model ids churn constantly.  Run
 * `npm run probe` to list what each provider actually exposes to our keys
 * today; entries flagged `unverified` in `notes` have not been confirmed
 * against a live account yet and carry a deliberately low priority so a
 * verified model always wins.
 *
 * Facts verified 26 Sep 2026:
 *  - Groq limits are ORG-level, hence the shared 'groq:chat' bucket.
 *  - llama-3.1-8b-instant / llama-3.3-70b-versatile LEFT Groq's free tier on
 *    16 Aug 2026 and are deliberately absent.
 *  - OpenRouter :free models are capped at 50 requests/DAY under $10 lifetime
 *    credit, so every OpenRouter entry is last-resort priority.
 */
export const CAPABILITIES: Capability[] = [
  // ---------------------------------------------------------------- Groq: text
  {
    id: 'groq:gpt-oss-120b',
    provider: 'groq',
    modelId: 'openai/gpt-oss-120b',
    label: 'GPT-OSS 120B',
    accepts: ['text'],
    emits: 'text',
    skills: ['chat'],
    freePlanEligible: true,
    quota: { bucket: 'groq:chat', rpm: 30, rpd: 1000, tpm: 8000, tpd: 200000 },
    priority: 10,
    // Verified 27 Sep 2026: no OTPM ceiling on this model (8,000 max_tokens
    // accepted), unlike qwen.
    maxOutputTokens: 2048,
    notes:
      'Primary reasoning model. TEXT ONLY despite Groq docs listing vision: ' +
      'verified 27 Sep 2026 that array message content is rejected outright ' +
      '("content must be a string"). Qwen 3.8 27B is the vision route.',
  },
  {
    id: 'groq:gpt-oss-20b',
    provider: 'groq',
    modelId: 'openai/gpt-oss-20b',
    label: 'GPT-OSS 20B',
    accepts: ['text'],
    emits: 'text',
    skills: ['chat'],
    freePlanEligible: true,
    quota: { bucket: 'groq:chat', rpm: 30, rpd: 1000, tpm: 8000, tpd: 200000 },
    priority: 20,
    maxOutputTokens: 2048,
    notes: 'Fastest Groq free text model; good for prompt-rewrite steps.',
  },

  {
    id: 'groq:qwen3.8-27b',
    provider: 'groq',
    modelId: 'qwen/qwen3.8-27b',
    label: 'Qwen 3.8 27B',
    accepts: ['text', 'image'],
    emits: 'text',
    skills: ['chat', 'vision'],
    freePlanEligible: true,
    // otpm is per-MODEL and applies only here: gpt-oss accepts 8,000 output
    // tokens happily, qwen caps at 1,000/minute. The org-level request limits
    // still come from the shared groq:chat bucket.
    // Groq's nominal OTPM here is 1,000, but its internal accounting charges
    // more than our reservation does -- budgeting against the full figure
    // still produced a 429 on the third call. 700 is a deliberate margin so
    // we block cleanly on our side instead of burning a provider call.
    quota: { bucket: 'groq:chat', rpm: 30, rpd: 1000, tpm: 8000, tpd: 200000, otpm: 700 },
    // The ONLY Groq model that accepts images, so it leads for vision while
    // sitting behind gpt-oss for plain chat.
    priority: 10,
    // Groq charges the REQUESTED max_tokens against OTPM, not the tokens
    // actually generated -- so 700 would allow only one call per minute.
    // 300 leaves room for three, and the tightened prompt emits ~100.
    maxOutputTokens: 300,
    notes: 'Verified vision-capable 27 Sep 2026. Shares the org-level chat budget.',
  },

  // ------------------------------------------------------------- Groq: audio in
  {
    id: 'groq:whisper-large-v3-turbo',
    provider: 'groq',
    modelId: 'whisper-large-v3-turbo',
    label: 'Whisper Large v3 Turbo',
    accepts: ['audio'],
    emits: 'text',
    skills: ['transcribe'],
    freePlanEligible: true,
    quota: {
      bucket: 'groq:whisper',
      rpm: 20,
      rpd: 2000,
      audioSecPerHour: 7200,
      audioSecPerDay: 28800,
    },
    priority: 10,
    maxAudioSeconds: 120,
    notes: 'Preferred transcription route: fast and the most generous free budget.',
  },
  {
    id: 'groq:whisper-large-v3',
    provider: 'groq',
    modelId: 'whisper-large-v3',
    label: 'Whisper Large v3',
    accepts: ['audio'],
    emits: 'text',
    skills: ['transcribe'],
    freePlanEligible: true,
    quota: {
      bucket: 'groq:whisper',
      rpm: 20,
      rpd: 2000,
      audioSecPerHour: 7200,
      audioSecPerDay: 28800,
    },
    priority: 20,
    maxAudioSeconds: 120,
  },

  // ------------------------------------------------------------ Groq: audio out
  {
    id: 'groq:orpheus-tts',
    provider: 'groq',
    modelId: 'canopylabs/orpheus-v1-english',
    label: 'Orpheus v1',
    accepts: ['text'],
    emits: 'audio',
    skills: ['tts'],
    freePlanEligible: true,
    quota: { bucket: 'groq:tts', rpm: 10, rpd: 100 },
    priority: 30,
    notes:
      'Verified present on this key 27 Sep 2026 (playai-tts, the previous id, ' +
      'is gone). Browser SpeechSynthesis remains the guaranteed fallback.',
  },

  // ------------------------------------------------- Cloudflare: image out (key)
  {
    id: 'cloudflare:flux-1-schnell',
    provider: 'cloudflare',
    modelId: '@cf/black-forest-labs/flux-1-schnell',
    label: 'FLUX.1 Schnell',
    accepts: ['text'],
    emits: 'image',
    skills: ['image-gen'],
    freePlanEligible: true,
    // Conservative: sources disagree between ~20 and ~59 neurons per 1024px
    // image. We assume the expensive end so we under-promise rather than 429.
    quota: { bucket: 'cloudflare:neurons', neuronsPerCall: 58 },
    priority: 10,
    // FLUX Schnell rejects width/height outright ("unevaluated properties").
    providerParams: { steps: 4 },
    notes: 'Fastest free image route. ~170 images/day. Takes steps, NOT width/height.',
  },
  {
    id: 'cloudflare:sdxl-base',
    provider: 'cloudflare',
    modelId: '@cf/stabilityai/stable-diffusion-xl-base-1.0',
    label: 'Stable Diffusion XL',
    accepts: ['text'],
    emits: 'image',
    skills: ['image-gen'],
    freePlanEligible: true,
    quota: { bucket: 'cloudflare:neurons', neuronsPerCall: 58 },
    priority: 20,
    providerParams: { width: 1024, height: 1024 },
    notes: 'Fallback image generator. Slower than FLUX (~19s) but reliable.',
  },

  // ------------------------------------------------------- Cloudflare: fallbacks
  {
    id: 'cloudflare:whisper-turbo',
    provider: 'cloudflare',
    modelId: '@cf/openai/whisper-large-v3-turbo',
    label: 'Whisper Turbo (Cloudflare)',
    accepts: ['audio'],
    emits: 'text',
    skills: ['transcribe'],
    freePlanEligible: true,
    quota: { bucket: 'cloudflare:neurons', neuronsPerCall: 12 },
    priority: 30,
    maxAudioSeconds: 120,
    notes: 'Transcription fallback once the Groq Whisper budget is exhausted.',
  },
  // REMOVED: cloudflare:llava-1.5-7b (@cf/llava-hf/llava-1.5-7b-hf).
  // Failed every attempt on 27 Sep 2026 -- 503 "Unknown internal error", then
  // 200 with an empty body -- while costing ~9s per try. A fallback that never
  // succeeds is worse than no fallback: it is pure added latency in front of
  // the one that works. Vision now falls straight through to OpenRouter.
  // (@cf/meta/llama-3.2-11b-vision-instruct is gated behind a one-time model
  // agreement; @cf/moondream/... returns an unparsed empty envelope.)

  {
    id: 'cloudflare:llama-3.2-3b',
    provider: 'cloudflare',
    modelId: '@cf/meta/llama-3.2-3b-instruct',
    label: 'Llama 3.2 3B (Cloudflare)',
    accepts: ['text'],
    emits: 'text',
    skills: ['chat'],
    freePlanEligible: true,
    quota: { bucket: 'cloudflare:neurons', neuronsPerCall: 10 },
    priority: 40,
    notes:
      'Text fallback when the Groq chat budget is spent. Uses the standard ' +
      'messages/response shape, unlike @cf/openai/gpt-oss-120b which returns ' +
      'a reasoning envelope.',
  },
  {
    id: 'cloudflare:melotts',
    provider: 'cloudflare',
    modelId: '@cf/myshell-ai/melotts',
    label: 'MeloTTS',
    accepts: ['text'],
    emits: 'audio',
    skills: ['tts'],
    freePlanEligible: true,
    quota: { bucket: 'cloudflare:neurons', neuronsPerCall: 10 },
    priority: 40,
    notes: 'Server-side TTS fallback ahead of the on-device browser voice.',
  },

  // ------------------------------------------------- OpenRouter: last resort only
  {
    id: 'openrouter:nemotron-3-super-free',
    provider: 'openrouter',
    modelId: 'nvidia/nemotron-3-super-120b-a12b:free',
    label: 'Nemotron 3 Super 120B (OpenRouter)',
    accepts: ['text'],
    emits: 'text',
    skills: ['chat'],
    freePlanEligible: true,
    quota: { bucket: 'openrouter:free', rpm: 20, rpd: 50 },
    priority: 90,
    notes: 'Only 50 requests/day. Genuine last resort.',
  },
  {
    id: 'openrouter:gemma-4-31b-free',
    provider: 'openrouter',
    modelId: 'google/gemma-4-31b-it:free',
    label: 'Gemma 4 31B (OpenRouter)',
    accepts: ['text', 'image'],
    emits: 'text',
    skills: ['vision', 'chat'],
    freePlanEligible: true,
    quota: { bucket: 'openrouter:free', rpm: 20, rpd: 50 },
    priority: 90,
    notes: 'Vision-capable last resort. Verified against the live free list 27 Sep 2026.',
  },

  // ------------------------------------------- Browser: on-device, zero quota
  {
    id: 'browser:speech-synthesis',
    provider: 'browser',
    modelId: 'web-speech-api',
    label: 'On-device voice (Web Speech API)',
    accepts: ['text'],
    emits: 'audio',
    skills: ['tts'],
    freePlanEligible: true,
    // No upstream cost at all: this runs in the visitor's own browser.
    quota: { bucket: 'browser:local' },
    priority: 99,
    notes:
      'Runs on the visitor device, costs no quota and cannot rate-limit. ' +
      'Surfaced honestly in X-Ray as an on-device route, never as a hosted model.',
  },
];
