<div align="center">

# Free LLM

**A task-first multimodal AI hub.**
Say what you want done — not which model does it.

Text · Image · Audio, routed across free inference tiers, composed when no single model can do the job, and explained end to end.

### [→ Try it live](https://free-models-hub.vercel.app)

[![Next.js](https://img.shields.io/badge/Next.js-15-000000?logo=next.js&logoColor=white)](https://nextjs.org)
[![TypeScript](https://img.shields.io/badge/TypeScript-strict-3178C6?logo=typescript&logoColor=white)](https://www.typescriptlang.org)
[![Tailwind CSS](https://img.shields.io/badge/Tailwind-v4-06B6D4?logo=tailwindcss&logoColor=white)](https://tailwindcss.com)
[![Cost](https://img.shields.io/badge/infra%20cost-%E2%82%B90-22C55E)](#the-zero-cost-constraint)
[![Tests](https://img.shields.io/badge/tests-57%20passing-22C55E)](#testing)

</div>

---

## The problem

Powerful open models are free to use right now. Actually using them is the hard part.

To transcribe a voice note and turn it into a picture today, you need to know that Whisper does speech-to-text but not image generation; that FLUX does images but only from text; that Groq hosts one but not the other; that Groq's free tier moved off Llama in August 2026; that OpenRouter's free models allow 50 requests a day, not 1,000; that Cloudflare bills in "neurons"; and that three different providers want three different request shapes for the same idea.

That is a routing problem, not a user problem. **Free LLM hides it entirely.**

```
        You say:   Audio  →  Image
 The app works out:  Whisper  →  LLM rewrites intent into a prompt  →  FLUX
                     ~3 seconds, three models, one click, ₹0
```

---

## What it does

Pick an input modality and an output modality. The router finds a free model that can do it, chains several when no single model can, falls back automatically when one is rate-limited, and shows you the full execution trace.

| Route | Pipeline | Typical |
|---|---|---|
| **Text → Text** | language model | ~0.6s |
| **Image → Text** | vision model | ~0.5s |
| **Audio → Text** | Whisper | ~0.7s |
| **Text → Image** | prompt enrichment *(optional)* → diffusion | ~3.5s |
| **Text → Audio** | hosted TTS → on-device voice fallback | ~0.5s |
| **Audio → Image** | Whisper → intent-to-prompt LLM → diffusion | ~3.0s |
| **Image → Audio** | vision model → TTS | ~4.8s |

No sign-up. No database. Nothing stored — generated media lives in your browser and is gone when you close the tab.

### X-Ray mode

Every result opens into a full execution trace: which provider and exact model ran each step, input and output tokens, audio seconds, Cloudflare neurons, per-step latency, routing overhead, every fallback attempt with the real error, and which shared free-tier budget paid for it.

Most AI tools hide the machinery. Here the machinery *is* the product, so none of it is hidden.

---

## Models and providers

Chosen by free-tier generosity, then verified against live keys — not from documentation.

### Groq — primary
`30 RPM · 1,000 requests/day · 200k tokens/day` per chat model

| Model | Role |
|---|---|
| `openai/gpt-oss-120b` | Primary reasoning and text generation |
| `openai/gpt-oss-20b` | Fast prompt-rewrite steps |
| `qwen/qwen3.8-27b` | **Vision** — the only Groq model that accepts images |
| `whisper-large-v3-turbo` | Speech-to-text (`2,000/day`, `28,800 audio-sec/day`) |
| `canopylabs/orpheus-v1-english` | Text-to-speech |

### Cloudflare Workers AI — images and breadth
`10,000 neurons/day` — roughly 170 images

| Model | Role |
|---|---|
| `@cf/black-forest-labs/flux-1-schnell` | **Primary image generation** (~2.5s) |
| `@cf/stabilityai/stable-diffusion-xl-base-1.0` | Image fallback (~19s) |
| `@cf/openai/whisper-large-v3-turbo` | Transcription fallback |
| `@cf/myshell-ai/melotts` | TTS fallback |
| `@cf/meta/llama-3.2-3b-instruct` | Text fallback |

### OpenRouter — last resort
`20 RPM` but only **50 requests/day** under $10 lifetime credit, so it is never a primary route.

`nvidia/nemotron-3-super-120b-a12b:free` · `google/gemma-4-31b-it:free` *(vision)*

### Browser — the floor
`Web Speech API` — runs on your own device, costs no quota, cannot rate-limit. The guaranteed fallback under hosted TTS, and labelled honestly in X-Ray as an on-device route.

> **Free tiers churn constantly.** Run `npm run probe` to ask each provider what it exposes to *your* keys today and flag any catalogue entry that no longer resolves. Four of the original entries were already stale when first verified.

---

## Architecture

```
Browser ──(normalizes media locally)──► POST /api/run ──► SSE events back
                                            │
              ┌─────────────────────────────┼─────────────────────────────┐
              │                             │                             │
        Quota Guard                  Route Planner                   Executor
   1 Upstash round-trip           recipe → candidates          per-step fallback
              │                             │                             │
              │                    Capability Registry           Provider Adapters
              │                     models + recipes        groq │ cloudflare │
              └──────── commit ─────────────┘               openrouter │ browser
```

### Five decisions worth knowing

**Recipes, not graph search.** Breadth-first search over a modality graph optimises for *reachability*, not quality. For audio→image it finds `audio → text → image` and feeds a raw transcript — *"uh so like, a cat with a crown, make it cinematic"* — straight into the image model. The good route needs a third step that rewrites spoken intent into a clean prompt, and that intent cannot be derived from modality edges. Each pair therefore has an explicit recipe in [`lib/registry/recipes.ts`](lib/registry/recipes.ts) whose steps declare a *capability requirement*; [`lib/router/planner.ts`](lib/router/planner.ts) resolves each to a ranked candidate list at request time.

**Fallback is scoped to the failing step.** Completed steps keep their outputs, so a failure in image generation never re-spends the transcription and prompt-rewrite calls that already succeeded. On a three-step route that is the difference between burning one extra call and burning four. See [`lib/router/executor.ts`](lib/router/executor.ts).

**The capability registry is data, not code.** Free tiers change monthly, so retiring a model is a one-line edit in [`lib/registry/models.ts`](lib/registry/models.ts) — never a branch inside a route handler. Per-model request shapes live there too, because models in one family disagree about their own parameters: FLUX Schnell *rejects* the `width`/`height` that SDXL *requires*.

**The quota guard fails open.** Upstash is an *optimiser* that stops us wasting calls on models already known to be spent — not the source of truth. The real backstop is the provider's own 429, which the executor already handles by falling back. A dead Redis must not take the site down. One `EVAL` reads every counter and one commits them, so a full day at Groq's ceiling costs roughly 60K of the free 500K commands/month.

**Everything streams.** `/api/run` returns Server-Sent Events. Not cosmetic: it gives live per-step progress on a pipeline that can run 10+ seconds, *and* it escapes Vercel's 4.5 MB **response** cap that a 1024px base64 image would otherwise brush against. Uploads stay under the matching request cap because media is normalized in the browser first — images downscaled to 1024px, audio to 16 kHz mono and capped at 120s.

---

## The zero-cost constraint

Target infrastructure and inference spend: **₹0**. Free inference tiers, free hosting, free counters, no database.

Holding that line shapes real decisions:

- The registry filters `freePlanEligible` unconditionally, so a paid model cannot be reached by forgetting a check.
- Failed attempts still count as spent quota, so X-Ray reports them in `providerCalls`.
- Test suites run entirely against mock adapters — proving composition and fallback must never spend a request from a 1,000/day pool.
- `npm run probe` performs no inference by default; live calls are opt-in behind `--live`.

### Shared keys: the accepted trade-off

This deployment uses **shared server-side keys** — visitors do not bring their own. Groq's 1,000 requests/day and Cloudflare's ~170 images/day are therefore consumed by *everyone combined*, and a traffic spike or one scripted client exhausts the day.

The guard degrades this gracefully rather than preventing it: per-visitor daily caps, routes greyed out *with the reason* before you pick them, and an honest "quota exhausted" state instead of a dead site. There is no bot protection in V1; Cloudflare Turnstile is the intended drop-in if abuse appears.

### Known limitation

**Vision is capped at roughly 2 requests per minute.** Groq allows 1,000 output tokens/minute on `qwen3.8-27b` — the only model of theirs that accepts images — and charges the *requested* `max_tokens`, not the tokens generated. The only fallback is OpenRouter's shared free pool, which is frequently rate-limited by other users. The UI blocks cleanly with a "try again in a minute" message rather than burning calls to discover it.

---

## Tech stack

| Layer | Choice | Why |
|---|---|---|
| Framework | **Next.js 15** (App Router) | Route handlers are the backend; no separate server needed |
| Language | **TypeScript** (strict, `noUncheckedIndexedAccess`) | The registry is typed data the router depends on |
| Styling | **Tailwind CSS v4** + CSS custom properties | Tokens drive both themes from one definition |
| Validation | **Zod** | Second line of defence behind client-side media limits |
| Counters | **Upstash Redis** (free tier) | Serverless-friendly; one Lua `EVAL` per read and per commit |
| Icons | **Lucide** | SVG throughout — no emoji as iconography |
| Fonts | **Inter** + **JetBrains Mono** | Mono for X-Ray: model ids and latency only read cleanly aligned |
| Hosting | **Vercel** (Hobby) | Streaming route handlers, zero config |
| Analytics | **GA4** + **Vercel Analytics** | Audience data, kept separate from execution traces |
| Testing | **Vitest** | 57 tests, no network, no quota spent |

### Design

Dark-first, built on a slate base with a single blue accent. One accessibility constraint shaped the palette: `#2563EB` on `#0F172A` is only **3.6:1**, so blue is confined to *filled* surfaces (white on blue = 5.2:1 ✓) while links and inline accents use `#60A5FA` (~7:1 ✓). Body text runs ~16:1. Verified at 375 / 768 / 1024 / 1440 with zero horizontal overflow, focus rings intact, and `prefers-reduced-motion` respected.

---

## Running locally

```bash
git clone https://github.com/dheerajtibrewal/free-models-hub.git
cd free-models-hub
npm install
cp .env.example .env.local   # add your keys
npm run dev
```

Open **http://localhost:3000**.

The app runs with *any* subset of providers configured — unconfigured providers simply are not candidates, and a route with no candidates is greyed out with the reason rather than failing at run time.

### Keys

All free, no card required. Every variable is documented in [`.env.example`](.env.example).

| Variable | Where | Needed for |
|---|---|---|
| `GROQ_API_KEY` | [console.groq.com/keys](https://console.groq.com/keys) | Text, vision, transcription, TTS |
| `CLOUDFLARE_ACCOUNT_ID` + `CLOUDFLARE_API_TOKEN` | [dash.cloudflare.com](https://dash.cloudflare.com) → Workers AI | **Image generation** |
| `OPENROUTER_API_KEY` | [openrouter.ai/keys](https://openrouter.ai/keys) | Last-resort fallback |
| `UPSTASH_REDIS_REST_URL` + `_TOKEN` | [console.upstash.com](https://console.upstash.com) | Quota counters |
| `VISITOR_HASH_SALT` | any long random string | Pseudonymising visitor ids |

> Raw IPs are never stored or logged — only a salted SHA-256 digest, truncated and day-scoped, which expires with its key.

### Commands

```bash
npm run dev              # dev server
npm run build            # production build
npm run typecheck        # tsc --noEmit
npm test                 # 57 unit tests — no network, no quota spent

npm run probe            # verify every model id against your keys (no inference)
npm run probe -- --live  # one real call per model (spends quota)
```

---

## Testing

57 tests, all against mock adapters. The interesting ones assert behaviour that is expensive to get wrong:

- a mid-pipeline failure retries **only** the failed step, and completed step outputs are preserved
- an exhausted *optional* step is skipped and passes its input through rather than failing the task
- a non-retryable error stops immediately instead of burning the backup model
- a provider-side `400` (an unaccepted model licence) stays **retryable**, or text→audio loses its fallback
- a per-model limit does not disable its bucket-mates sharing the same org-level quota
- account identifiers are stripped from provider errors before they reach the browser

---

## Deploying

```bash
vercel   # or import the repo at vercel.com/new
```

Set every variable from [`.env.example`](.env.example) in **Project → Settings → Environment Variables**. Only `NEXT_PUBLIC_GA_ID` and `NEXT_PUBLIC_SITE_URL` are public; everything else must stay server-side.

[`vercel.json`](vercel.json) pins `maxDuration: 60` for the streaming route and deploys to `iad1`, which sits closest to the provider APIs — a three-step pipeline makes three sequential upstream calls, so provider proximity beats user proximity.

Security headers (`X-Frame-Options`, `nosniff`, `Referrer-Policy`, `Permissions-Policy` restricting the mic to same-origin) are set in [`next.config.ts`](next.config.ts), and API responses are `no-store` so generated media is never served stale to another visitor.

---

## Not in V1

Accounts · saved history · persistent execution logs · model benchmarking · paid providers · Hugging Face · a separate backend · video generation · bring-your-own-key.

---

<div align="center">

Built by **[Dheeraj Tibrewal](https://www.linkedin.com/in/dheeraj-tibrewal/)**

</div>
