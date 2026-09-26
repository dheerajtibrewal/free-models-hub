# Free LLM

Task-first multimodal AI router. You say **what you want** — an input modality and an
output modality — and the app works out which free model can do it, chains several
when no single model can, falls back when one is out of quota, and shows the whole
execution trace.

Operating cost target: **₹0**. Free inference tiers, free hosting, free counters,
no database.

## The seven routes

| Route | Pipeline |
|---|---|
| Text → Text | LLM |
| Image → Text | vision model |
| Audio → Text | Whisper |
| Text → Image | prompt enrichment *(optional)* → diffusion |
| Text → Audio | TTS, falling back to the on-device browser voice |
| Audio → Image | Whisper → intent-to-prompt LLM → diffusion |
| Image → Audio | vision model → TTS |

## Architecture

```
Client  ──(normalizes media in-browser)──►  POST /api/run  ──► SSE events back
                                              │
                    ┌─────────────────────────┼──────────────────────────┐
                    │                         │                          │
              Quota Guard              Route Planner                 Executor
          (1 Upstash round-trip)   (recipe → candidates)     (per-step fallback)
                                              │                          │
                                       Capability Registry       Provider Adapters
                                                              groq │ cloudflare │
                                                              openrouter │ browser
```

### Four decisions worth knowing

**Recipes, not graph search.** Breadth-first search over a modality graph optimises
for *reachability*, not quality. For audio→image it finds the two-step
`audio → text → image` path and feeds a raw transcript ("uh so like, a cat with a
crown, make it cinematic") straight into the image model. The good route needs a
third step that rewrites spoken intent into a clean prompt — intent that cannot be
derived from modality edges. So each pair has an explicit recipe in
[`lib/registry/recipes.ts`](lib/registry/recipes.ts) whose steps declare a
*capability requirement*, and [`lib/router/planner.ts`](lib/router/planner.ts)
resolves each requirement to a ranked candidate list at request time.

**Fallback is scoped to the failing step.** Completed steps keep their outputs, so a
failure in image generation never re-spends the transcription and prompt-rewrite
calls that already succeeded. On a three-step route that is the difference between
burning one extra call and burning four. See
[`lib/router/executor.ts`](lib/router/executor.ts).

**The quota guard fails open.** Upstash is an *optimiser* that stops us wasting calls
on models already known to be spent — not the source of truth. The real backstop is
the provider's own 429, which the executor already handles by falling back. A dead
Redis must not take the site down. One `EVAL` reads every counter and one commits
them, so a full day at Groq's ceiling costs roughly 60K of the free 500K
commands/month.

**Everything streams.** `/api/run` returns SSE. That is not cosmetic: it gives live
per-step progress on a pipeline that can run 10+ seconds, and it escapes Vercel's
4.5 MB **response** cap, which a 1024px base64 image brushes against. Uploads are
kept under the matching request cap by normalizing media in the browser — images
downscaled to 1024px, audio to 16 kHz mono and capped at 120 s.

## Provider reality (verified 26 Sep 2026)

| Provider | Free allowance | Role |
|---|---|---|
| **Groq** | 30 RPM / 1,000 RPD / 200k TPD per chat model; Whisper 2,000 RPD, 28,800 audio-sec/day | Primary: text, vision, transcription |
| **Cloudflare Workers AI** | 10,000 neurons/day (~170 FLUX images) | Only free image generation; broad fallback |
| **OpenRouter** | 20 RPM but **50 requests/day** under $10 lifetime credit | Last resort only |
| **Upstash Redis** | 500K commands/month | Counters only |

Two things that bite:

- **`llama-3.1-8b-instant` and `llama-3.3-70b-versatile` left Groq's free tier on
  16 Aug 2026.** They are deliberately absent from the catalogue.
- **Groq limits are org-level.** Extra API keys do not multiply quota, which is why
  every free Groq chat model shares one bucket in the registry.

Model ids churn. Run `npm run probe` to ask each provider what it actually exposes to
your keys and flag catalogue entries that no longer resolve.

### Shared keys: the accepted tradeoff

This deployment uses **shared server-side keys** — visitors do not bring their own.
So Groq's 1,000 requests/day and Cloudflare's ~170 images/day are consumed by
*everyone combined*. A traffic spike or one scripted client exhausts the day.

The guard degrades this gracefully rather than preventing it: per-visitor daily caps,
routes greyed out with the reason before you pick them, and an honest "quota
exhausted" state instead of a dead site. There is no bot protection in V1;
Cloudflare Turnstile is the intended drop-in if abuse appears.

## Running it

```bash
npm install
cp .env.example .env.local     # fill in your keys
npm run dev
```

The app runs with *any* subset of providers configured — unconfigured providers are
simply not candidates, and a route with no candidates is greyed out rather than
failing at run time.

```bash
npm run typecheck   # tsc --noEmit
npm test            # 30 unit tests, no network, no quota spent
npm run probe       # cross-check the catalogue against live provider model lists
npm run probe -- --live   # one real call per model (spends quota)
npm run build
```

The test suite runs entirely against mock adapters. Proving composition and fallback
must never spend a request from a 1,000/day pool.

## Deploying

Vercel Hobby. Push the repo, import it, then set every variable from
[`.env.example`](.env.example) in **Project → Settings → Environment Variables**.
Only `NEXT_PUBLIC_GA_ID` and `NEXT_PUBLIC_SITE_URL` are public; the rest must stay
server-side.

## Analytics

Two layers, deliberately separate. **GA4** answers "who is using which utility"
(`task_started`, `task_completed`, `task_failed`, `xray_opened`, `<route>_used`).
**X-Ray** answers "what did this one run actually do". Vercel Analytics is enabled
for lightweight traffic monitoring.

## Not in V1

Accounts, saved history, persistent execution logs, model benchmarking, paid
providers, Hugging Face, a separate backend, video. No database — generated media
lives in browser memory and is never stored.
