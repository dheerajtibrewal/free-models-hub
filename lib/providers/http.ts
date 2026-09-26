import type { NormalizedError } from '../router/types';
import { RouterError } from '../router/types';

/** Bounded fetch that maps transport failures onto our error vocabulary. */
export async function httpJson<T>(
  url: string,
  init: RequestInit,
  signal: AbortSignal,
): Promise<T> {
  const res = await fetch(url, { ...init, signal });
  if (!res.ok) throw await httpError(res);
  return (await res.json()) as T;
}

export async function httpBinary(
  url: string,
  init: RequestInit,
  signal: AbortSignal,
): Promise<{ bytes: ArrayBuffer; mimeType: string }> {
  const res = await fetch(url, { ...init, signal });
  if (!res.ok) throw await httpError(res);
  return {
    bytes: await res.arrayBuffer(),
    mimeType: res.headers.get('content-type') ?? 'application/octet-stream',
  };
}

async function httpError(res: Response): Promise<RouterError> {
  let detail = '';
  try {
    detail = (await res.text()).slice(0, 400);
  } catch {
    /* body already consumed or empty */
  }
  return new RouterError(statusToError(res.status, detail));
}

/**
 * Strip account-identifying detail out of provider error text.
 *
 * Provider errors are surfaced verbatim in X-Ray, which is a deliberate
 * product feature -- but Groq embeds the ORGANISATION ID in its rate-limit
 * messages ("in organization `org_01m3...`"), and Cloudflare puts the account
 * id in URLs. None of that belongs in a public browser payload, and it is
 * useless to the person reading the trace.
 */
export function redact(text: string): string {
  return text
    .replace(/\borg_[A-Za-z0-9]{6,}/g, 'org_[redacted]')
    .replace(/\bacct_[A-Za-z0-9]{6,}/g, 'acct_[redacted]')
    .replace(/\b(gsk|sk-or-v1|sk|cfat|xai)[-_][A-Za-z0-9_-]{12,}/gi, '[redacted-key]')
    .replace(/\b[0-9a-f]{32}\b/g, '[redacted-id]')
    .replace(/accounts\/[A-Za-z0-9]+/g, 'accounts/[redacted]')
    .replace(/https?:\/\/[^\s"']*(?:token|key|secret)=[^\s"'&]*/gi, '[redacted-url]');
}

/** 400-with-a-provider-side-cause signatures, which must not block fallback. */
const PROVIDER_SIDE_400 =
  /model_terms_required|terms acceptance|model_not_found|does not exist|decommissioned|no longer supported|is not available|unsupported_model/i;

export function statusToError(status: number, rawDetail: string): NormalizedError {
  // Redaction happens HERE rather than at each call site: every adapter funnels
  // through this function, so a new provider cannot accidentally leak account
  // identifiers by forgetting to sanitise.
  const detail = redact(rawDetail);
  const message = detail || `HTTP ${status}`;
  if (status === 429) {
    return { kind: 'rate_limit', retryable: true, message, status };
  }
  if (status === 401 || status === 403) {
    // A bad key will fail identically on every retry of this provider, but a
    // DIFFERENT provider may still work -- so this stays retryable at the
    // step level, where fallback picks another provider entirely.
    return { kind: 'auth', retryable: true, message, status };
  }
  if (status === 400 || status === 422) {
    // Not every 400 is our fault. Providers use 400 for their OWN config
    // problems too -- an unaccepted model licence, a decommissioned model.
    // Those must stay retryable, or a single misconfigured model takes down a
    // route that had a perfectly good fallback behind it. (Groq returns
    // `model_terms_required` this way, which otherwise killed text->audio
    // instead of falling through to the on-device voice.)
    if (PROVIDER_SIDE_400.test(detail)) {
      return { kind: 'unavailable', retryable: true, message, status };
    }
    // Genuinely our payload: another model will reject it identically.
    return { kind: 'bad_input', retryable: false, message, status };
  }
  if (status === 404) {
    return { kind: 'unavailable', retryable: true, message: `model not found: ${message}`, status };
  }
  if (status >= 500) {
    return { kind: 'unavailable', retryable: true, message, status };
  }
  return { kind: 'unknown', retryable: true, message, status };
}

export function transportToError(error: unknown): NormalizedError {
  if (error instanceof RouterError) return error.normalized;
  if (error instanceof Error) {
    if (error.name === 'AbortError' || error.name === 'TimeoutError') {
      return { kind: 'timeout', retryable: true, message: 'step timed out' };
    }
    return { kind: 'unknown', retryable: true, message: redact(error.message) };
  }
  return { kind: 'unknown', retryable: true, message: redact(String(error)) };
}

/**
 * Returns a Uint8Array explicitly backed by an ArrayBuffer (not the
 * SharedArrayBuffer-permitting `ArrayBufferLike`), so the result is usable
 * directly as a BlobPart for multipart uploads.
 */
export function base64ToBytes(base64: string): Uint8Array<ArrayBuffer> {
  const buf = Buffer.from(base64, 'base64');
  const out = new Uint8Array(buf.byteLength);
  out.set(buf);
  return out;
}

export function bytesToBase64(bytes: ArrayBuffer | Uint8Array): string {
  return Buffer.from(bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes)).toString('base64');
}

export function dataUrl(base64: string, mimeType: string): string {
  return `data:${mimeType};base64,${base64}`;
}
