/**
 * Resolve the canonical site URL.
 *
 * This exists because `process.env.X ?? fallback` is not safe for deployment
 * config: `??` only catches null/undefined, while a variable defined in a
 * hosting dashboard but left blank arrives as an EMPTY STRING. `new URL('')`
 * then throws ERR_INVALID_URL during Next's page-data collection and fails the
 * whole production build -- which is exactly how this was found.
 *
 * Resolution order:
 *   1. NEXT_PUBLIC_SITE_URL, if it is a genuinely usable URL
 *   2. Vercel's own deployment URL, so a fresh import needs no configuration
 *   3. localhost, for development
 */
import { stringFromEnv } from './env';

const DEV_FALLBACK = 'http://localhost:3000';

export function siteUrl(): string {
  const explicit = normalize(stringFromEnv('NEXT_PUBLIC_SITE_URL'));
  if (explicit) return explicit;

  // Set automatically by Vercel. Production domain first, then the immutable
  // per-deployment URL so previews get correct absolute links too.
  const vercelHost =
    stringFromEnv('VERCEL_PROJECT_PRODUCTION_URL') ?? stringFromEnv('VERCEL_URL');
  const fromVercel = normalize(vercelHost);
  if (fromVercel) return fromVercel;

  return DEV_FALLBACK;
}

/**
 * Accepts what people actually type into a dashboard field -- bare hostnames,
 * trailing slashes, stray whitespace -- and returns a valid absolute origin,
 * or undefined if it cannot be salvaged.
 */
function normalize(raw: string | undefined): string | undefined {
  const value = raw?.trim();
  if (!value) return undefined;

  const withProtocol = /^https?:\/\//i.test(value) ? value : `https://${value}`;
  try {
    const url = new URL(withProtocol);
    if (!url.hostname) return undefined;
    return url.origin;
  } catch {
    // A malformed value must never take the build down; fall through to the
    // next source instead.
    return undefined;
  }
}
