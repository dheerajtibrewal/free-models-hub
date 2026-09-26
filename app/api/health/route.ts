import { NextResponse } from 'next/server';
import { ADAPTERS } from '@/lib/providers';
import { CAPABILITIES, type ProviderId } from '@/lib/registry';
import { stringFromEnv } from '@/lib/env';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Configuration visibility, not a liveness probe.
 *
 * It deliberately does NOT call the providers: a health check that spends a
 * request from a 1,000/day pool is a self-inflicted outage. Real reachability
 * is discovered during an actual run, where a failure already falls back.
 */
export async function GET() {
  const providers = (Object.keys(ADAPTERS) as ProviderId[]).map((id) => ({
    id,
    configured: ADAPTERS[id].isConfigured(),
    models: CAPABILITIES.filter((c) => c.provider === id && c.freePlanEligible).length,
  }));

  const redisConfigured = Boolean(
    stringFromEnv('UPSTASH_REDIS_REST_URL') && stringFromEnv('UPSTASH_REDIS_REST_TOKEN'),
  );

  return NextResponse.json(
    {
      ok: providers.some((p) => p.configured),
      providers,
      quotaCounters: redisConfigured ? 'upstash' : 'in-memory (degraded)',
    },
    { headers: { 'Cache-Control': 'no-store' } },
  );
}
