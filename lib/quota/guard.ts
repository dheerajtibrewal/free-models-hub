import { Redis } from '@upstash/redis';
import type { Capability } from '../registry';
import { allBuckets } from '../registry';
import type { StepUsage } from '../router/types';
import {
  FIELD,
  KEY_TTL_SECONDS,
  bucketKey,
  dayStamp,
  minuteStamp,
  visitorKey,
} from './keys';
import { COMMIT_LUA, SNAPSHOT_LUA } from './lua';

export const VISITOR_DAILY_LIMIT = Number(process.env.VISITOR_DAILY_LIMIT ?? 15);

export interface QuotaSnapshot {
  visitorUsed: number;
  visitorLimit: number;
  /** bucket -> field -> value */
  buckets: Record<string, Record<string, number>>;
  /** True when Redis was unreachable and we are running blind (fail-open). */
  degraded: boolean;
}

export interface BucketStatus {
  bucket: string;
  healthy: boolean;
  reason?: string;
}

let client: Redis | null = null;
let clientResolved = false;

function redis(): Redis | null {
  if (clientResolved) return client;
  clientResolved = true;
  const url = process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN;
  client = url && token ? new Redis({ url, token }) : null;
  return client;
}

/**
 * Best-effort per-instance visitor counter, used only when Redis is down.
 *
 * Imperfect by design: serverless instances do not share it, so the real cap
 * becomes (limit x instances). Accepted -- the alternative is refusing traffic
 * because a counter is unavailable.
 */
const localVisitorCounts = new Map<string, { day: string; count: number }>();

function localVisitorUsed(visitorId: string): number {
  const day = dayStamp();
  const entry = localVisitorCounts.get(visitorId);
  if (!entry || entry.day !== day) return 0;
  return entry.count;
}

function bumpLocalVisitor(visitorId: string, delta: number): void {
  const day = dayStamp();
  const entry = localVisitorCounts.get(visitorId);
  if (!entry || entry.day !== day) {
    localVisitorCounts.set(visitorId, { day, count: delta });
  } else {
    entry.count += delta;
  }
}

function toNumberMap(flat: unknown): Record<string, number> {
  const out: Record<string, number> = {};
  // HGETALL over the REST client can come back as a flat array or an object
  // depending on version; handle both rather than trusting one shape.
  if (Array.isArray(flat)) {
    for (let i = 0; i < flat.length - 1; i += 2) {
      out[String(flat[i])] = Number(flat[i + 1]) || 0;
    }
  } else if (flat && typeof flat === 'object') {
    for (const [k, v] of Object.entries(flat as Record<string, unknown>)) {
      out[k] = Number(v) || 0;
    }
  }
  return out;
}

/** One Redis round-trip for every counter the planner needs. */
export async function snapshot(visitorId: string): Promise<QuotaSnapshot> {
  const buckets = allBuckets();
  const empty: Record<string, Record<string, number>> = {};
  for (const b of buckets) empty[b] = {};

  const r = redis();
  if (!r) {
    return {
      visitorUsed: localVisitorUsed(visitorId),
      visitorLimit: VISITOR_DAILY_LIMIT,
      buckets: empty,
      degraded: true,
    };
  }

  try {
    const raw = (await r.eval(
      SNAPSHOT_LUA,
      [visitorKey(visitorId)],
      buckets.map((b) => bucketKey(b)),
    )) as [string, unknown[]];

    const parsed: Record<string, Record<string, number>> = {};
    buckets.forEach((b, i) => {
      parsed[b] = toNumberMap(raw?.[1]?.[i]);
    });

    return {
      visitorUsed: Number(raw?.[0]) || 0,
      visitorLimit: VISITOR_DAILY_LIMIT,
      buckets: parsed,
      degraded: false,
    };
  } catch {
    // Fail OPEN. Upstash is an optimiser that stops us wasting calls on models
    // already known to be spent -- it is not the source of truth. The real
    // backstop is the provider's own 429, which the executor handles by falling
    // back. A dead Redis must not take the site down.
    return {
      visitorUsed: localVisitorUsed(visitorId),
      visitorLimit: VISITOR_DAILY_LIMIT,
      buckets: empty,
      degraded: true,
    };
  }
}

/** Is this specific model still within every budget it draws from? */
export function isHealthy(cap: Capability, snap: QuotaSnapshot): BucketStatus {
  const { bucket, rpm, rpd, tpd, audioSecPerDay, audioSecPerHour, neuronsPerCall } = cap.quota;

  // The browser route runs on the visitor's own device: no upstream budget.
  if (cap.provider === 'browser') return { bucket, healthy: true };

  const counters = snap.buckets[bucket] ?? {};
  const minute = minuteStamp();
  const hour = minute.slice(0, 10);

  if (rpd !== undefined && (counters[FIELD.rpd] ?? 0) >= rpd) {
    return { bucket, healthy: false, reason: `daily request budget spent (${rpd})` };
  }
  if (rpm !== undefined && (counters[FIELD.rpm(minute)] ?? 0) >= rpm) {
    return { bucket, healthy: false, reason: `per-minute limit reached (${rpm})` };
  }
  if (tpd !== undefined && (counters[FIELD.tpd] ?? 0) >= tpd) {
    return { bucket, healthy: false, reason: `daily token budget spent (${tpd})` };
  }
  if (audioSecPerDay !== undefined && (counters[FIELD.audioSec] ?? 0) >= audioSecPerDay) {
    return { bucket, healthy: false, reason: 'daily audio budget spent' };
  }
  if (
    audioSecPerHour !== undefined &&
    (counters[FIELD.audioSecHour(hour)] ?? 0) >= audioSecPerHour
  ) {
    return { bucket, healthy: false, reason: 'hourly audio budget spent' };
  }
  if (neuronsPerCall !== undefined) {
    const used = counters[FIELD.neurons] ?? 0;
    if (used + neuronsPerCall > NEURON_DAILY_BUDGET) {
      return { bucket, healthy: false, reason: 'daily Cloudflare neuron budget spent' };
    }
  }

  return { bucket, healthy: true };
}

export const NEURON_DAILY_BUDGET = Number(process.env.CF_NEURON_DAILY_BUDGET ?? 10000);

export function visitorAllowed(snap: QuotaSnapshot): boolean {
  return snap.visitorUsed < snap.visitorLimit;
}

/* --------------------------------------------------------------------- commit */

export interface UsageRecord {
  capability: Capability;
  usage?: StepUsage;
}

/**
 * Commit a finished run: one EVAL for the visitor counter plus every bucket
 * field the executed steps actually consumed.
 */
export async function commit(
  visitorId: string,
  records: UsageRecord[],
  chargeVisitor: boolean,
): Promise<void> {
  const increments: Record<string, Record<string, number>> = {};
  const minute = minuteStamp();
  const hour = minute.slice(0, 10);

  const add = (bucket: string, field: string, delta: number) => {
    if (delta <= 0) return;
    const key = bucketKey(bucket);
    increments[key] ??= {};
    increments[key][field] = (increments[key][field] ?? 0) + delta;
  };

  for (const { capability, usage } of records) {
    if (capability.provider === 'browser') continue;
    const { bucket, rpm, rpd, tpd, audioSecPerDay, audioSecPerHour, neuronsPerCall } =
      capability.quota;

    if (rpd !== undefined) add(bucket, FIELD.rpd, 1);
    if (rpm !== undefined) add(bucket, FIELD.rpm(minute), 1);
    if (tpd !== undefined) {
      add(bucket, FIELD.tpd, (usage?.inputTokens ?? 0) + (usage?.outputTokens ?? 0));
    }
    if (audioSecPerDay !== undefined) add(bucket, FIELD.audioSec, Math.ceil(usage?.audioSeconds ?? 0));
    if (audioSecPerHour !== undefined) {
      add(bucket, FIELD.audioSecHour(hour), Math.ceil(usage?.audioSeconds ?? 0));
    }
    if (neuronsPerCall !== undefined) {
      add(bucket, FIELD.neurons, usage?.neurons ?? neuronsPerCall);
    }
  }

  if (chargeVisitor) bumpLocalVisitor(visitorId, 1);

  const r = redis();
  if (!r) return;

  try {
    await r.eval(
      COMMIT_LUA,
      [visitorKey(visitorId)],
      [String(KEY_TTL_SECONDS), JSON.stringify(increments), chargeVisitor ? '1' : '0'],
    );
  } catch {
    // Same reasoning as snapshot(): losing a counter write is survivable, a
    // 500 to the user is not.
  }
}

/**
 * Mark a model as rate-limited right now, so the next request skips it instead
 * of spending another call to rediscover the 429.
 */
export async function penalize(cap: Capability): Promise<void> {
  const r = redis();
  if (!r || cap.provider === 'browser') return;
  try {
    const key = bucketKey(cap.quota.bucket);
    if (cap.quota.rpm !== undefined) {
      await r.hset(key, { [FIELD.rpm(minuteStamp())]: cap.quota.rpm });
      await r.expire(key, KEY_TTL_SECONDS);
    } else if (cap.quota.rpd !== undefined) {
      await r.hset(key, { [FIELD.rpd]: cap.quota.rpd });
      await r.expire(key, KEY_TTL_SECONDS);
    }
  } catch {
    /* non-fatal */
  }
}
