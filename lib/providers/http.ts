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

export function statusToError(status: number, detail: string): NormalizedError {
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
    // Our own payload is wrong; another model will reject it the same way.
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
    return { kind: 'unknown', retryable: true, message: error.message };
  }
  return { kind: 'unknown', retryable: true, message: String(error) };
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
