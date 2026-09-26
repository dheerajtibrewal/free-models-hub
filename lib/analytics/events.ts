type GtagArgs = [command: string, eventName: string, params?: Record<string, unknown>];

declare global {
  interface Window {
    gtag?: (...args: GtagArgs) => void;
  }
}

/**
 * GA4 custom events.
 *
 * Audience analytics is deliberately separate from the X-Ray execution trace:
 * this answers "who is using which utility", while X-Ray answers "what did this
 * one run actually do".
 */
function track(event: string, params: Record<string, unknown> = {}): void {
  if (typeof window === 'undefined') return;
  window.gtag?.('event', event, params);
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
