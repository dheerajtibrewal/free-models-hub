/**
 * Provider probe.
 *
 * Free tiers and model ids churn constantly, so the capability catalogue is a
 * best-effort snapshot. This script asks each provider what it actually exposes
 * to OUR keys today and reports any entry in `lib/registry/models.ts` that no
 * longer resolves.
 *
 *   npm run probe                   # cross-check the catalogue (no inference)
 *   npm run probe -- --live         # additionally make ONE real call per model
 *   npm run probe -- --write-status # regenerate PROVIDER_STATUS.md
 *
 * The default mode deliberately performs no inference: a check that spends
 * requests from a 1,000/day pool is a self-inflicted outage.
 */
import { config } from 'dotenv';
// Next.js loads .env.local automatically; a standalone tsx script does not, and
// dotenv defaults to plain `.env`. Load the same files Next would, in the same
// precedence order, so the probe sees exactly what the app will see.
config({ path: '.env.local' });
config({ path: '.env' });

import { writeFileSync } from 'node:fs';
import { CAPABILITIES } from '../lib/registry/models';
import { adapterFor } from '../lib/providers';
import type { Capability } from '../lib/registry/types';
import type { StepInput } from '../lib/router/types';

const LIVE = process.argv.includes('--live');
const WRITE_STATUS = process.argv.includes('--write-status');

const GREEN = '\x1b[32m';
const RED = '\x1b[31m';
const YELLOW = '\x1b[33m';
const DIM = '\x1b[2m';
const RESET = '\x1b[0m';

const ok = (s: string) => `${GREEN}✓${RESET} ${s}`;
const bad = (s: string) => `${RED}✗${RESET} ${s}`;
const warn = (s: string) => `${YELLOW}!${RESET} ${s}`;

async function main() {
  console.log(`\n${DIM}Free Models Hub — provider probe${RESET}\n`);

  const live = new Map<string, Set<string>>();
  live.set('groq', await groqModels());
  live.set('openrouter', await openrouterModels());
  live.set('cloudflare', await cloudflareModels());

  console.log(`\n${DIM}── catalogue cross-check ──${RESET}\n`);

  let unresolved = 0;
  const results: StatusRow[] = [];

  for (const cap of CAPABILITIES) {
    if (cap.provider === 'browser') {
      console.log(ok(`${pad(cap.id)} ${DIM}on-device, nothing to verify${RESET}`));
      results.push({ cap, state: 'on-device' });
      continue;
    }

    const known = live.get(cap.provider);
    if (!known || known.size === 0) {
      console.log(warn(`${pad(cap.id)} ${DIM}provider not reachable or not configured${RESET}`));
      results.push({ cap, state: 'unchecked' });
      continue;
    }

    if (known.has(cap.modelId)) {
      console.log(ok(`${pad(cap.id)} ${DIM}${cap.modelId}${RESET}`));
      results.push({ cap, state: 'resolved' });
    } else {
      results.push({ cap, state: 'missing' });
      unresolved++;
      console.log(bad(`${pad(cap.id)} ${cap.modelId} ${RED}not in provider catalogue${RESET}`));
      const near = [...known].filter((m) => overlaps(m, cap.modelId)).slice(0, 3);
      if (near.length) console.log(`   ${DIM}closest: ${near.join(', ')}${RESET}`);
    }
  }

  if (LIVE) await liveCheck();
  if (WRITE_STATUS) writeStatus(results, unresolved);

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

/**
 * A real 64x64 solid-red PNG.
 *
 * A 1x1 pixel is NOT good enough: Groq's vision model parses the request but
 * rejects a degenerate image with "invalid image data", which reads exactly
 * like a model that cannot do vision at all. That false negative is what made
 * the catalogue wrong in the first place.
 */
const RED_64_PNG =
  'iVBORw0KGgoAAAANSUhEUgAAAEAAAABACAIAAAAlC+aJAAAAT0lEQVR42u3PQQkAAAgEsIty/dMYyQi+hcEKLNO+FgEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQGBywI6LQEAwyG+sAAAAABJRU5ErkJggg==';

function sampleFor(cap: Capability): StepInput | null {
  // Vision is checked FIRST: a vision-capable model usually also advertises
  // `chat`, and matching chat first would quietly test the wrong code path.
  if (cap.skills.includes('vision')) {
    return {
      payload: { modality: 'image', base64: RED_64_PNG, mimeType: 'image/png' },
      instruction: 'What single colour fills this image? Answer in one word.',
    };
  }
  if (cap.skills.includes('image-gen')) {
    return { payload: { modality: 'text', text: 'a single red maple leaf on white paper' } };
  }
  if (cap.skills.includes('tts')) {
    return { payload: { modality: 'text', text: 'Routing works.' } };
  }
  if (cap.skills.includes('chat') && cap.accepts.includes('text') && cap.emits === 'text') {
    return { payload: { modality: 'text', text: 'Reply with the single word: ready' } };
  }
  // Transcription needs real speech to be meaningful; exercised end-to-end instead.
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

/* ------------------------------------------------------- status file output */

type StatusState = 'resolved' | 'missing' | 'unchecked' | 'on-device';
interface StatusRow {
  cap: Capability;
  state: StatusState;
}

const STATE_LABEL: Record<StatusState, string> = {
  resolved: '✅ resolved',
  missing: '❌ not in catalogue',
  unchecked: '⚠️ not checked',
  'on-device': '✅ on-device',
};

/**
 * Write PROVIDER_STATUS.md.
 *
 * Free-tier facts are configuration, not documentation: they change without
 * notice and a hand-written date in a README goes stale invisibly. Generating
 * this file makes the age of the claim explicit and refreshable in one command.
 */
function writeStatus(rows: StatusRow[], unresolved: number): void {
  const now = new Date();
  const date = now.toISOString().slice(0, 10);

  const byProvider = new Map<string, StatusRow[]>();
  for (const r of rows) {
    const list = byProvider.get(r.cap.provider) ?? [];
    list.push(r);
    byProvider.set(r.cap.provider, list);
  }

  const lines: string[] = [
    '# Provider status',
    '',
    `**Last verified: ${date}**  ·  regenerate with \`npm run probe -- --write-status\``,
    '',
    'Free inference tiers change without notice — model ids are renamed, retired, or',
    'moved behind a paid plan. This file records what each provider actually exposed',
    'to the configured keys at the time above. It is generated, never hand-edited.',
    '',
    unresolved === 0
      ? '> All catalogue entries resolved against live provider model lists.'
      : `> **${unresolved} catalogue entr${unresolved === 1 ? 'y' : 'ies'} did not resolve.** See the table below and update \`lib/registry/models.ts\`.`,
    '',
  ];

  for (const [provider, list] of byProvider) {
    lines.push(`## ${provider}`, '');
    lines.push('| Capability | Model id | Status | Free-tier budget (as configured) |');
    lines.push('|---|---|---|---|');
    for (const { cap, state } of list) {
      lines.push(
        `| ${cap.label} | \`${cap.modelId}\` | ${STATE_LABEL[state]} | ${budget(cap)} |`,
      );
    }
    lines.push('');
  }

  lines.push(
    '---',
    '',
    'Budgets are the values the router enforces in `lib/registry/models.ts`, not a',
    'quote of the provider\'s published limits. The router treats them as ceilings:',
    'when one is reached, that model stops being a routing candidate.',
    '',
  );

  writeFileSync('PROVIDER_STATUS.md', lines.join('\n'));
  console.log(`\n${GREEN}✓${RESET} wrote PROVIDER_STATUS.md ${DIM}(last verified ${date})${RESET}`);
}

function budget(cap: Capability): string {
  const q = cap.quota;
  const parts: string[] = [];
  if (q.rpm) parts.push(`${q.rpm} rpm`);
  if (q.rpd) parts.push(`${q.rpd.toLocaleString()}/day`);
  if (q.tpd) parts.push(`${(q.tpd / 1000).toLocaleString()}k tokens/day`);
  if (q.otpm) parts.push(`${q.otpm} output tokens/min`);
  if (q.audioSecPerDay) parts.push(`${q.audioSecPerDay.toLocaleString()} audio-sec/day`);
  if (q.neuronsPerCall) parts.push(`~${q.neuronsPerCall} neurons/call`);
  return parts.length ? parts.join(' · ') : 'no upstream budget';
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
