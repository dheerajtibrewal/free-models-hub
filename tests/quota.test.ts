import { describe, expect, it } from 'vitest';
import type { Capability } from '@/lib/registry';
import { capabilityById } from '@/lib/registry';
import { NEURON_DAILY_BUDGET, isHealthy, visitorAllowed, type QuotaSnapshot } from '@/lib/quota/guard';
import { FIELD, bucketKey, dayStamp, hashVisitor, minuteStamp, visitorKey } from '@/lib/quota/keys';

function snap(buckets: Record<string, Record<string, number>> = {}, visitorUsed = 0): QuotaSnapshot {
  return { visitorUsed, visitorLimit: 15, buckets, degraded: false };
}

const whisper = capabilityById('groq:whisper-large-v3-turbo')!;
const flux = capabilityById('cloudflare:flux-1-schnell')!;
const onDevice = capabilityById('browser:speech-synthesis')!;

describe('keys', () => {
  it('stamps days and minutes in UTC', () => {
    const at = new Date('2026-09-27T03:04:05.000Z');
    expect(dayStamp(at)).toBe('20260927');
    expect(minuteStamp(at)).toBe('202609270304');
  });

  it('namespaces bucket and visitor keys by day so they expire naturally', () => {
    expect(bucketKey('groq:chat', '20260927')).toBe('q:groq:chat:20260927');
    expect(visitorKey('abc', '20260927')).toBe('v:abc:20260927');
  });

  it('never exposes the raw IP and is stable for the same IP and salt', () => {
    const a = hashVisitor('203.0.113.9', 'salt');
    const b = hashVisitor('203.0.113.9', 'salt');
    expect(a).toBe(b);
    expect(a).not.toContain('203.0.113.9');
    expect(a).toHaveLength(24);
  });

  it('separates visitors and changes with the salt', () => {
    expect(hashVisitor('1.1.1.1', 'salt')).not.toBe(hashVisitor('1.1.1.2', 'salt'));
    expect(hashVisitor('1.1.1.1', 'salt-a')).not.toBe(hashVisitor('1.1.1.1', 'salt-b'));
  });
});

describe('isHealthy', () => {
  it('passes a model with no recorded usage', () => {
    expect(isHealthy(whisper, snap()).healthy).toBe(true);
  });

  it('blocks on the daily request budget', () => {
    const result = isHealthy(whisper, snap({ 'groq:whisper': { [FIELD.rpd]: 2000 } }));
    expect(result.healthy).toBe(false);
    expect(result.reason).toMatch(/daily request budget/);
  });

  it('blocks on the per-minute window but only for the current minute', () => {
    const thisMinute = snap({ 'groq:whisper': { [FIELD.rpm(minuteStamp())]: 20 } });
    expect(isHealthy(whisper, thisMinute).healthy).toBe(false);

    const otherMinute = snap({ 'groq:whisper': { [FIELD.rpm('202001010000')]: 20 } });
    expect(isHealthy(whisper, otherMinute).healthy).toBe(true);
  });

  it('blocks on the audio-seconds budget', () => {
    expect(isHealthy(whisper, snap({ 'groq:whisper': { [FIELD.audioSec]: 28_800 } })).healthy).toBe(
      false,
    );
  });

  it('blocks a neuron model only when the pool cannot fund one more call', () => {
    const perCall = flux.quota.neuronsPerCall!;
    const canAfford = NEURON_DAILY_BUDGET - perCall;

    expect(isHealthy(flux, snap({ 'cloudflare:neurons': { [FIELD.neurons]: canAfford } })).healthy).toBe(
      true,
    );
    expect(
      isHealthy(flux, snap({ 'cloudflare:neurons': { [FIELD.neurons]: canAfford + 1 } })).healthy,
    ).toBe(false);
  });

  it('treats the on-device route as always healthy -- it costs no upstream quota', () => {
    const drained: Record<string, Record<string, number>> = {
      'browser:local': { [FIELD.rpd]: 99_999 },
    };
    expect(isHealthy(onDevice, snap(drained)).healthy).toBe(true);
  });

  it('shares one bucket across Groq chat models, since limits are org-level', () => {
    const chatModels = ['groq:gpt-oss-120b', 'groq:gpt-oss-20b']
      .map((id) => capabilityById(id))
      .filter(Boolean) as Capability[];

    expect(chatModels).toHaveLength(2);
    expect(new Set(chatModels.map((c) => c.quota.bucket)).size).toBe(1);

    // Spending the bucket must take BOTH models out, not just the first.
    const spent = snap({ 'groq:chat': { [FIELD.rpd]: 1000 } });
    expect(chatModels.every((c) => !isHealthy(c, spent).healthy)).toBe(true);
  });
});

describe('visitorAllowed', () => {
  it('allows up to the limit and refuses beyond it', () => {
    expect(visitorAllowed(snap({}, 14))).toBe(true);
    expect(visitorAllowed(snap({}, 15))).toBe(false);
    expect(visitorAllowed(snap({}, 99))).toBe(false);
  });
});

describe('OTPM (output tokens per minute)', () => {
  // Groq enforces this separately from the token budget and far more tightly:
  // 1,000 OTPM vs 8,000 input TPM. It appears in no header, only in the 429.
  const vision = capabilityById('groq:qwen3.8-27b')!;

  it('applies OTPM only to the model that actually has one', () => {
    // gpt-oss accepts 8,000 output tokens; only qwen carries an OTPM ceiling.
    expect(capabilityById('groq:gpt-oss-120b')!.quota.otpm).toBeUndefined();
    expect(vision.quota.otpm).toBeDefined();
    // Budgeted below Groq's nominal 1,000: its accounting charges more than
    // our reservation, so the margin is what stops us burning a 429.
    expect(vision.quota.otpm!).toBeLessThan(1000);
    // ...while still sharing the org-level request bucket.
    expect(capabilityById('groq:gpt-oss-120b')!.quota.bucket).toBe(vision.quota.bucket);
  });

  it('leaves room for more than one call inside the per-minute budget', () => {
    expect(vision.maxOutputTokens).toBeDefined();
    // A single call must never reserve the whole per-minute budget, or the
    // model can serve exactly one request per minute.
    expect(vision.maxOutputTokens! * 2).toBeLessThanOrEqual(vision.quota.otpm!);
  });

  it('blocks the model when this minute cannot fund another generation', () => {
    const minute = minuteStamp();
    const nearlySpent = snap({ 'groq:chat': { [FIELD.otpm(vision.id, minute)]: 800 } });
    // 800 used + 300 needed > 1000 limit.
    expect(isHealthy(vision, nearlySpent).healthy).toBe(false);

    const roomLeft = snap({ 'groq:chat': { [FIELD.otpm(vision.id, minute)]: 100 } });
    expect(isHealthy(vision, roomLeft).healthy).toBe(true);
  });

  it('only counts the current minute', () => {
    const stale = snap({ 'groq:chat': { [FIELD.otpm(vision.id, '202001010000')]: 999 } });
    expect(isHealthy(vision, stale).healthy).toBe(true);
  });
});

describe('penalty scoping', () => {
  // Regression: qwen (OTPM-limited) shares the org-level groq:chat bucket with
  // gpt-oss (no OTPM). Penalising the shared rpm counter when qwen ran out of
  // OUTPUT tokens disabled text->text as collateral damage.
  it('does not let a per-model limit disable its bucket-mates', () => {
    const vision = capabilityById('groq:qwen3.8-27b')!;
    const chat = capabilityById('groq:gpt-oss-120b')!;
    expect(vision.quota.bucket).toBe(chat.quota.bucket);

    // qwen's own OTPM field is maxed out...
    const penalised = snap({
      'groq:chat': { [FIELD.otpm(vision.id, minuteStamp())]: 1000 },
    });
    expect(isHealthy(vision, penalised).healthy).toBe(false);
    // ...but its bucket-mate, which has no OTPM ceiling, still runs.
    expect(isHealthy(chat, penalised).healthy).toBe(true);
  });
});
