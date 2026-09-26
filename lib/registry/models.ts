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
    accepts: ['text', 'image'],
    emits: 'text',
    skills: ['chat', 'vision'],
    freePlanEligible: true,
    quota: { bucket: 'groq:chat', rpm: 30, rpd: 1000, tpm: 8000, tpd: 200000 },
    priority: 10,
    notes: 'Primary reasoning + vision model on the Groq free tier.',
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
    notes: 'Fastest Groq free text model; good for prompt-rewrite steps.',
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
    modelId: 'playai-tts',
    label: 'Groq TTS (preview)',
    accepts: ['text'],
    emits: 'audio',
    skills: ['tts'],
    freePlanEligible: true,
    quota: { bucket: 'groq:tts', rpm: 10, rpd: 100 },
    priority: 30,
    notes:
      'unverified — Groq TTS sits in the preview tier and the model id moves. ' +
      'Browser SpeechSynthesis is the guaranteed fallback behind this.',
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
    notes: 'The only genuinely free image generator in the stack. ~170 images/day.',
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
    notes: 'Fallback image generator when the FLUX budget is spent.',
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
  {
    id: 'cloudflare:llama-3.2-11b-vision',
    provider: 'cloudflare',
    modelId: '@cf/meta/llama-3.2-11b-vision-instruct',
    label: 'Llama 3.2 11B Vision',
    accepts: ['text', 'image'],
    emits: 'text',
    skills: ['vision', 'chat'],
    freePlanEligible: true,
    quota: { bucket: 'cloudflare:neurons', neuronsPerCall: 10 },
    priority: 30,
    notes: 'Vision fallback. Cloudflare Llama is unaffected by Groq tier changes.',
  },
  {
    id: 'cloudflare:llama-3.1-8b',
    provider: 'cloudflare',
    modelId: '@cf/meta/llama-3.1-8b-instruct',
    label: 'Llama 3.1 8B (Cloudflare)',
    accepts: ['text'],
    emits: 'text',
    skills: ['chat'],
    freePlanEligible: true,
    quota: { bucket: 'cloudflare:neurons', neuronsPerCall: 6 },
    priority: 40,
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
    id: 'openrouter:llama-3.3-70b-free',
    provider: 'openrouter',
    modelId: 'meta-llama/llama-3.3-70b-instruct:free',
    label: 'Llama 3.3 70B (OpenRouter)',
    accepts: ['text'],
    emits: 'text',
    skills: ['chat'],
    freePlanEligible: true,
    quota: { bucket: 'openrouter:free', rpm: 20, rpd: 50 },
    priority: 90,
    notes: 'Only 50 requests/day. Genuine last resort.',
  },
  {
    id: 'openrouter:qwen-2.5-vl-72b-free',
    provider: 'openrouter',
    modelId: 'qwen/qwen-2.5-vl-72b-instruct:free',
    label: 'Qwen2.5 VL 72B (OpenRouter)',
    accepts: ['text', 'image'],
    emits: 'text',
    skills: ['vision', 'chat'],
    freePlanEligible: true,
    quota: { bucket: 'openrouter:free', rpm: 20, rpd: 50 },
    priority: 90,
    notes: 'unverified model id — confirm with `npm run probe`.',
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
