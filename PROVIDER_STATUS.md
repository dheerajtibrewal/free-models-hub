# Provider status

**Last verified: 2026-09-26**  ·  regenerate with `npm run probe -- --write-status`

Free inference tiers change without notice — model ids are renamed, retired, or
moved behind a paid plan. This file records what each provider actually exposed
to the configured keys at the time above. It is generated, never hand-edited.

> All catalogue entries resolved against live provider model lists.

## groq

| Capability | Model id | Status | Free-tier budget (as configured) |
|---|---|---|---|
| GPT-OSS 120B | `openai/gpt-oss-120b` | ✅ resolved | 30 rpm · 1,000/day · 200k tokens/day |
| GPT-OSS 20B | `openai/gpt-oss-20b` | ✅ resolved | 30 rpm · 1,000/day · 200k tokens/day |
| Qwen 3.8 27B | `qwen/qwen3.8-27b` | ✅ resolved | 30 rpm · 1,000/day · 200k tokens/day · 700 output tokens/min |
| Whisper Large v3 Turbo | `whisper-large-v3-turbo` | ✅ resolved | 20 rpm · 2,000/day · 28,800 audio-sec/day |
| Whisper Large v3 | `whisper-large-v3` | ✅ resolved | 20 rpm · 2,000/day · 28,800 audio-sec/day |
| Orpheus v1 | `canopylabs/orpheus-v1-english` | ✅ resolved | 10 rpm · 100/day |

## cloudflare

| Capability | Model id | Status | Free-tier budget (as configured) |
|---|---|---|---|
| FLUX.1 Schnell | `@cf/black-forest-labs/flux-1-schnell` | ✅ resolved | ~58 neurons/call |
| Stable Diffusion XL | `@cf/stabilityai/stable-diffusion-xl-base-1.0` | ✅ resolved | ~58 neurons/call |
| Whisper Turbo (Cloudflare) | `@cf/openai/whisper-large-v3-turbo` | ✅ resolved | ~12 neurons/call |
| Llama 3.2 3B (Cloudflare) | `@cf/meta/llama-3.2-3b-instruct` | ✅ resolved | ~10 neurons/call |
| MeloTTS | `@cf/myshell-ai/melotts` | ✅ resolved | ~10 neurons/call |

## openrouter

| Capability | Model id | Status | Free-tier budget (as configured) |
|---|---|---|---|
| Nemotron 3 Super 120B (OpenRouter) | `nvidia/nemotron-3-super-120b-a12b:free` | ✅ resolved | 20 rpm · 50/day |
| Gemma 4 31B (OpenRouter) | `google/gemma-4-31b-it:free` | ✅ resolved | 20 rpm · 50/day |

## browser

| Capability | Model id | Status | Free-tier budget (as configured) |
|---|---|---|---|
| On-device voice (Web Speech API) | `web-speech-api` | ✅ on-device | no upstream budget |

---

Budgets are the values the router enforces in `lib/registry/models.ts`, not a
quote of the provider's published limits. The router treats them as ceilings:
when one is reached, that model stops being a routing candidate.
