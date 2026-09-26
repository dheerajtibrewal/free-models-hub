/**
 * Provider probe.
 *
 * Free tiers and model ids churn constantly, so the capability catalogue is a
 * best-effort snapshot. This script asks each provider what it actually exposes
 * to OUR keys today and reports any entry in `lib/registry/models.ts` that no
 * longer resolves.
 *
 *   npm run probe          # list models, cross-check the catalogue (no inference)
 *   npm run probe -- --live  # additionally make ONE real call per capability
 *
 * The default mode deliberately performs no inference: a check that spends
 * requests from a 1,000/day pool is a self-inflicted outage.
 */
import 'dotenv/config';
import { CAPABILITIES } from '../lib/registry/models';
import { adapterFor } from '../lib/providers';
import type { Capability } from '../lib/registry/types';
import type { StepInput } from '../lib/router/types';

const LIVE = process.argv.includes('--live');

const GREEN = '\x1b[32m';
const RED = '\x1b[31m';
const YELLOW = '\x1b[33m';
const DIM = '\x1b[2m';
const RESET = '\x1b[0m';

const ok = (s: string) => `${GREEN}✓${RESET} ${s}`;
const bad = (s: string) => `${RED}✗${RESET} ${s}`;
const warn = (s: string) => `${YELLOW}!${RESET} ${s}`;

async function main() {
  console.log(`\n${DIM}Free LLM — provider probe${RESET}\n`);

  const live = new Map<string, Set<string>>();
  live.set('groq', await groqModels());
  live.set('openrouter', await openrouterModels());
  live.set('cloudflare', await cloudflareModels());

  console.log(`\n${DIM}── catalogue cross-check ──${RESET}\n`);

  let unresolved = 0;
  for (const cap of CAPABILITIES) {
    if (cap.provider === 'browser') {
      console.log(ok(`${pad(cap.id)} ${DIM}on-device, nothing to verify${RESET}`));
      continue;
    }

    const known = live.get(cap.provider);
    if (!known || known.size === 0) {
      console.log(warn(`${pad(cap.id)} ${DIM}provider not reachable or not configured${RESET}`));
      continue;
    }

    if (known.has(cap.modelId)) {
      console.log(ok(`${pad(cap.id)} ${DIM}${cap.modelId}${RESET}`));
    } else {
      unresolved++;
      console.log(bad(`${pad(cap.id)} ${cap.modelId} ${RED}not in provider catalogue${RESET}`));
      const near = [...known].filter((m) => overlaps(m, cap.modelId)).slice(0, 3);
      if (near.length) console.log(`   ${DIM}closest: ${near.join(', ')}${RESET}`);
    }
  }

  if (LIVE) await liveCheck();

  console.log(
    `\n${unresolved === 0 ? GREEN : YELLOW}${unresolved} catalogue entr${unresolved === 1 ? 'y' : 'ies'} unresolved${RESET}`,
  );
  if (unresolved > 0) {
    console.log(`${DIM}Update lib/registry/models.ts with the ids above.${RESET}`);
  }
  console.log();
}

/* ------------------------------------------------------------------ providers */

async function groqModels(): Promise<Set<string>> {
  const key = process.env.GROQ_API_KEY;
  if (!key) {
    console.log(warn('groq        GROQ_API_KEY not set'));
    return new Set();
  }
  try {
    const res = await fetch('https://api.groq.com/openai/v1/models', {
      headers: { Authorization: `Bearer ${key}` },
    });
    if (!res.ok) {
      console.log(bad(`groq        HTTP ${res.status} ${(await res.text()).slice(0, 120)}`));
      return new Set();
    }
    const json = (await res.json()) as { data?: Array<{ id?: string }> };
    const ids = new Set((json.data ?? []).map((m) => m.id).filter(Boolean) as string[]);
    console.log(ok(`groq        ${ids.size} models visible to this key`));
    return ids;
  } catch (e) {
    console.log(bad(`groq        ${(e as Error).message}`));
    return new Set();
  }
}

async function openrouterModels(): Promise<Set<string>> {
  try {
    // This endpoint is public; no key needed just to enumerate.
    const res = await fetch('https://openrouter.ai/api/v1/models');
    if (!res.ok) {
      console.log(bad(`openrouter  HTTP ${res.status}`));
      return new Set();
    }
    const json = (await res.json()) as { data?: Array<{ id?: string }> };
    const all = (json.data ?? []).map((m) => m.id).filter(Boolean) as string[];
    const free = all.filter((id) => id.endsWith(':free'));
    console.log(ok(`openrouter  ${free.length} free models (of ${all.length} total)`));
    if (!process.env.OPENROUTER_API_KEY) {
      console.log(`   ${DIM}OPENROUTER_API_KEY not set — routing will skip this provider${RESET}`);
    }
    return new Set(all);
  } catch (e) {
    console.log(bad(`openrouter  ${(e as Error).message}`));
    return new Set();
  }
}

async function cloudflareModels(): Promise<Set<string>> {
  const accountId = process.env.CLOUDFLARE_ACCOUNT_ID;
  const token = process.env.CLOUDFLARE_API_TOKEN;
  if (!accountId || !token) {
    console.log(warn('cloudflare  CLOUDFLARE_ACCOUNT_ID / CLOUDFLARE_API_TOKEN not set'));
    return new Set();
  }
  try {
    const res = await fetch(
      `https://api.cloudflare.com/client/v4/accounts/${accountId}/ai/models/search?per_page=500`,
      { headers: { Authorization: `Bearer ${token}` } },
    );
    if (!res.ok) {
      console.log(bad(`cloudflare  HTTP ${res.status} ${(await res.text()).slice(0, 120)}`));
      return new Set();
    }
    const json = (await res.json()) as { result?: Array<{ name?: string }> };
    const ids = new Set((json.result ?? []).map((m) => m.name).filter(Boolean) as string[]);
    console.log(ok(`cloudflare  ${ids.size} models visible to this token`));
    return ids;
  } catch (e) {
    console.log(bad(`cloudflare  ${(e as Error).message}`));
    return new Set();
  }
}

/* ----------------------------------------------------------------- live checks */

/** One real call per capability. Opt-in: this spends free quota. */
async function liveCheck() {
  console.log(`\n${DIM}── live inference (spends quota) ──${RESET}\n`);

  for (const cap of CAPABILITIES) {
    const input = sampleFor(cap);
    if (!input) {
      console.log(warn(`${pad(cap.id)} no sample input for this skill`));
      continue;
    }

    const started = Date.now();
    try {
      const out = await adapterFor(cap.provider).invoke(cap, input, AbortSignal.timeout(60_000));
      const ms = Date.now() - started;
      console.log(ok(`${pad(cap.id)} ${DIM}${describe(out.payload)} in ${ms}ms${RESET}`));
    } catch (e) {
      const normalized = adapterFor(cap.provider).normalizeError(e);
      console.log(bad(`${pad(cap.id)} ${normalized.kind}: ${normalized.message.slice(0, 120)}`));
    }
  }
}

function sampleFor(cap: Capability): StepInput | null {
  if (cap.skills.includes('chat') && cap.accepts.includes('text') && cap.emits === 'text') {
    return { payload: { modality: 'text', text: 'Reply with the single word: ready' } };
  }
  if (cap.skills.includes('image-gen')) {
    return { payload: { modality: 'text', text: 'a single red maple leaf on white paper' } };
  }
  if (cap.skills.includes('tts')) {
    return { payload: { modality: 'text', text: 'Routing works.' } };
  }
  if (cap.skills.includes('vision')) {
    // 1x1 PNG: enough to prove the request shape is accepted.
    return {
      payload: {
        modality: 'image',
        base64:
          'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFAAH/q842iQAAAABJRU5ErkJggg==',
        mimeType: 'image/png',
      },
      instruction: 'What colour is this?',
    };
  }
  // Transcription needs real speech to be meaningful; skipped deliberately.
  return null;
}

/* ---------------------------------------------------------------------- utils */

function describe(payload: { modality: string } & Record<string, unknown>): string {
  if (payload.modality === 'text') return `text: "${String(payload.text).slice(0, 48)}…"`;
  const base64 = String(payload.base64 ?? '');
  return `${payload.modality}: ${Math.round((base64.length * 3) / 4 / 1024)} KB`;
}

function pad(s: string): string {
  return s.padEnd(34);
}

/** Loose similarity so a renamed model still surfaces a useful suggestion. */
function overlaps(a: string, b: string): boolean {
  const tokens = (s: string) => s.toLowerCase().split(/[^a-z0-9]+/).filter((t) => t.length > 2);
  const left = new Set(tokens(a));
  return tokens(b).some((t) => left.has(t));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
