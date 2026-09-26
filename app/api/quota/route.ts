import { NextRequest, NextResponse } from 'next/server';
import { RECIPES, findCapabilities } from '@/lib/registry';
import { ADAPTERS } from '@/lib/providers';
import { hashVisitor, isHealthy, snapshot } from '@/lib/quota';
import type { QuotaResponse } from '@/lib/types';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Powers the always-visible quota strip and greys out routes that cannot run.
 *
 * Being honest about a shared daily allowance is a feature: the user learns why
 * a route is unavailable instead of hitting a failure after picking it.
 */
export async function GET(req: NextRequest) {
  const visitorId = hashVisitor(clientIp(req));
  const snap = await snapshot(visitorId);

  const tasks = RECIPES.map((recipe) => {
    for (const step of recipe.steps) {
      if (step.optional) continue;

      const candidates = findCapabilities({
        skill: step.skill,
        accepts: step.from,
        emits: step.to,
      }).filter((c) => ADAPTERS[c.provider]?.isConfigured());

      if (candidates.length === 0) {
        return { slug: recipe.slug, available: false, reason: `${step.title}: not configured` };
      }
      if (!candidates.some((c) => isHealthy(c, snap).healthy)) {
        const why = isHealthy(candidates[0]!, snap).reason ?? 'out of free quota';
        return { slug: recipe.slug, available: false, reason: `${step.title}: ${why}` };
      }
    }
    return { slug: recipe.slug, available: true };
  });

  const body: QuotaResponse = {
    visitor: {
      used: snap.visitorUsed,
      limit: snap.visitorLimit,
      remaining: Math.max(0, snap.visitorLimit - snap.visitorUsed),
    },
    tasks,
    degraded: snap.degraded,
    resetsAt: nextUtcMidnight(),
  };

  return NextResponse.json(body, {
    headers: { 'Cache-Control': 'no-store' },
  });
}

function nextUtcMidnight(): string {
  const d = new Date();
  d.setUTCHours(24, 0, 0, 0);
  return d.toISOString();
}

function clientIp(req: NextRequest): string {
  const forwarded = req.headers.get('x-forwarded-for');
  if (forwarded) return forwarded.split(',')[0]?.trim() || 'unknown';
  return req.headers.get('x-real-ip') ?? 'unknown';
}
