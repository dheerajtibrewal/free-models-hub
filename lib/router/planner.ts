import { findCapabilities, type Capability } from '../registry';
import type { Recipe } from '../registry/recipes';
import { ADAPTERS } from '../providers';
import { isHealthy, type QuotaSnapshot } from '../quota/guard';
import type { Plan, PlannedStep } from './types';
import { RouterError } from './types';

export interface PlanOptions {
  /** Skip the quota filter (used by tests and the probe script). */
  ignoreQuota?: boolean;
  /** Restrict to these capability ids -- lets tests inject a mock provider. */
  onlyCapabilityIds?: string[];
}

/**
 * Resolve a recipe into a concrete, ordered plan.
 *
 * Each recipe step declares a capability REQUIREMENT; this is where it becomes
 * a ranked candidate list. Filtering happens before any upstream call, so a
 * task that cannot possibly succeed fails here having spent nothing.
 */
export function plan(recipe: Recipe, snapshot: QuotaSnapshot, options: PlanOptions = {}): Plan {
  /** Why a step ended up with no candidates, so the user gets the real reason. */
  const blockedBy = new Map<number, { cause: 'unconfigured' | 'quota'; reason?: string }>();

  const steps: PlannedStep[] = recipe.steps.map((recipeStep, index) => {
    let candidates = findCapabilities({
      skill: recipeStep.skill,
      accepts: recipeStep.from,
      emits: recipeStep.to,
    });

    if (options.onlyCapabilityIds) {
      const allow = new Set(options.onlyCapabilityIds);
      candidates = candidates.filter((c) => allow.has(c.id));
    }

    // A provider with no credentials is not a candidate at all.
    candidates = candidates.filter((c) => ADAPTERS[c.provider]?.isConfigured());
    const configuredCount = candidates.length;

    let firstReason: string | undefined;
    if (!options.ignoreQuota) {
      const checked = candidates.map((c) => ({ cap: c, health: isHealthy(c, snapshot) }));
      firstReason = checked.find((c) => !c.health.healthy)?.health.reason;
      candidates = checked.filter((c) => c.health.healthy).map((c) => c.cap);
    }

    if (candidates.length === 0) {
      // Distinguish "we never had a model for this" from "we had one and it is
      // out of quota" -- they are different problems with different fixes, and
      // conflating them sends the user chasing the wrong one.
      blockedBy.set(index, {
        cause: configuredCount === 0 ? 'unconfigured' : 'quota',
        reason: firstReason,
      });
    }

    return {
      index,
      title: recipeStep.title,
      skill: recipeStep.skill,
      from: recipeStep.from,
      to: recipeStep.to,
      optional: recipeStep.optional ?? false,
      systemPrompt: recipeStep.systemPrompt,
      candidates,
      recipeStep,
    };
  });

  // An optional step with no candidates is skipped, not fatal -- prompt
  // enrichment is a quality nicety, so losing it must not lose the whole task.
  const blocking = steps.find((s) => s.candidates.length === 0 && !s.optional);
  if (blocking) {
    const blocked = blockedBy.get(blocking.index);
    if (blocked?.cause === 'unconfigured') {
      throw new RouterError({
        kind: 'unavailable',
        retryable: false,
        message: `This route needs a provider that isn't configured on this deployment (step: ${blocking.title}).`,
      });
    }
    // Per-minute limits recover in about a minute; telling someone to wait
    // until 00:00 UTC for a 60-second window is simply wrong.
    const perMinute = /per-minute/.test(blocked?.reason ?? '');
    throw new RouterError({
      kind: 'quota_exhausted',
      retryable: false,
      message: perMinute
        ? `"${blocking.title}" has hit its per-minute limit on every free model. Try again in about a minute.`
        : `"${blocking.title}" has used up every free model's daily allowance. Budgets reset at 00:00 UTC.`,
    });
  }

  return { recipe, steps };
}

/** Flat list of the leading model per step, for the `plan` SSE event. */
export function planPreview(p: Plan): Array<{ index: number; title: string; candidate: string }> {
  return p.steps.map((s) => ({
    index: s.index,
    title: s.title,
    candidate: s.candidates[0]?.label ?? 'skipped',
  }));
}

export function describeCandidate(cap: Capability): string {
  return `${cap.provider}/${cap.modelId}`;
}
