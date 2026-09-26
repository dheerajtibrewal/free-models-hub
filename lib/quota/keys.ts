import { createHash } from 'node:crypto';
import { stringFromEnv } from '../env';

/** Day-scoped key stamp in UTC -- Cloudflare's neuron pool resets at 00:00 UTC. */
export function dayStamp(now = new Date()): string {
  return now.toISOString().slice(0, 10).replace(/-/g, '');
}

/** Minute bucket for RPM windows. */
export function minuteStamp(now = new Date()): string {
  return now.toISOString().slice(0, 16).replace(/[-:T]/g, '');
}

export function bucketKey(bucket: string, day = dayStamp()): string {
  return `q:${bucket}:${day}`;
}

export function visitorKey(visitorId: string, day = dayStamp()): string {
  return `v:${visitorId}:${day}`;
}

/**
 * Stable pseudonymous visitor id.
 *
 * The raw IP is never stored or logged -- only this salted digest, which is
 * day-scoped by the key it ends up in and expires with it.
 */
export function hashVisitor(
  ip: string,
  salt = stringFromEnv('VISITOR_HASH_SALT') ?? 'free-models-hub-dev',
): string {
  return createHash('sha256').update(`${salt}:${ip}`).digest('hex').slice(0, 24);
}

/** Field names inside a bucket hash. */
export const FIELD = {
  rpd: 'rpd',
  tpd: 'tpd',
  audioSec: 'audio_sec',
  neurons: 'neurons',
  rpm: (minute: string) => `rpm:${minute}`,
  /** Per-MODEL, unlike rpm/rpd which are org-level and shared across the bucket. */
  otpm: (capabilityId: string, minute: string) => `otpm:${capabilityId}:${minute}`,
  audioSecHour: (hour: string) => `audio_h:${hour}`,
} as const;

/** Keys carry the date, so the TTL only needs to outlive the day comfortably. */
export const KEY_TTL_SECONDS = 60 * 60 * 48;
