import { track as vercelTrack } from '@vercel/analytics';

type GtagArgs = [command: string, eventName: string, params?: Record<string, unknown>];

declare global {
  interface Window {
    gtag?: (...args: GtagArgs) => void;
  }
}

/**
 * Product analytics, sent to whichever backends are actually live.
 *
 * Two layers, deliberately separate from the X-Ray execution trace: this
 * answers "who is using which utility", X-Ray answers "what did this one run
 * do".
 *
 * Events go to BOTH GA4 and Vercel Analytics rather than GA4 alone. GA4 needs
 * a measurement id to exist at all, so a deployment without one previously
 * recorded nothing — every custom event silently vanished while pageviews kept
 * working, which is a confusing place to be. Vercel Analytics is on by default
 * for the project, so this guarantees a floor.
 *
 * Both calls are individually guarded: neither backend being present is normal.
 */
function track(event: string, params: Record<string, unknown> = {}): void {
  if (typeof window === 'undefined') return;

  try {
    window.gtag?.('event', event, params);
  } catch {
    /* analytics must never break a run */
  }

  try {
    // Vercel accepts only flat string/number/boolean/null values.
    vercelTrack(event, flatten(params));
  } catch {
    /* not enabled, or blocked by a content blocker */
  }
}

function flatten(
  params: Record<string, unknown>,
): Record<string, string | number | boolean | null> {
  const out: Record<string, string | number | boolean | null> = {};
  for (const [k, v] of Object.entries(params)) {
    if (v === null || ['string', 'number', 'boolean'].includes(typeof v)) {
      out[k] = v as string | number | boolean | null;
    } else if (v !== undefined) {
      out[k] = String(v);
    }
  }
  return out;
}

export function taskStarted(slug: string): void {
  track('task_started', { task: slug });
  track(`${slug.replace(/-/g, '_')}_used`, { task: slug });
}

export function taskCompleted(slug: string, latencyMs: number, fallback: boolean): void {
  track('task_completed', { task: slug, latency_ms: Math.round(latencyMs), fallback });
}

export function taskFailed(slug: string, kind: string): void {
  track('task_failed', { task: slug, error_kind: kind });
}

export function xrayOpened(slug: string): void {
  track('xray_opened', { task: slug });
}
