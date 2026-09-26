/**
 * Safe environment-variable parsing.
 *
 * `Number(process.env.X ?? fallback)` looks correct and is not. `??` only
 * catches null/undefined, but a variable that exists in a hosting dashboard
 * with an empty value arrives as '' -- and `Number('')` is **0**, not the
 * fallback. In production that turned a 45-second step timeout into a
 * 0ms one, so every upstream call aborted before it left the building and
 * the whole site reported "step timed out" in ~3ms.
 *
 * Locally the variable was simply absent, so the fallback applied and
 * everything worked. Absent and blank are different states that look
 * identical until one of them isn't.
 *
 * The same trap applies to '  ', 'abc' (NaN) and '0'.
 */

export interface NumberEnvOptions {
  /** Values below this are treated as misconfiguration and rejected. */
  min?: number;
  max?: number;
}

export function numberFromEnv(
  name: string,
  fallback: number,
  options: NumberEnvOptions = {},
): number {
  const { min = 1, max } = options;
  const raw = process.env[name]?.trim();

  if (!raw) return fallback;

  const parsed = Number(raw);
  if (!Number.isFinite(parsed)) return fallback;
  if (parsed < min) return fallback;
  if (max !== undefined && parsed > max) return fallback;

  return parsed;
}

/** True only for an explicit affirmative; anything else (including '') is false. */
export function booleanFromEnv(name: string, fallback = false): boolean {
  const raw = process.env[name]?.trim().toLowerCase();
  if (!raw) return fallback;
  if (['1', 'true', 'yes', 'on'].includes(raw)) return true;
  if (['0', 'false', 'no', 'off'].includes(raw)) return false;
  return fallback;
}

/** A non-empty, trimmed string, or undefined. Never returns ''. */
export function stringFromEnv(name: string): string | undefined {
  const raw = process.env[name]?.trim();
  return raw ? raw : undefined;
}
