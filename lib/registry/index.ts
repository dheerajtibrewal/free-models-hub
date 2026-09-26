import { CAPABILITIES } from './models';
import type { Capability, CapabilityQuery } from './types';

export * from './types';
export * from './recipes';
export { CAPABILITIES } from './models';

/**
 * Candidate models for a step, best first.
 *
 * `freePlanEligible` is filtered unconditionally: the zero-cost constraint is
 * enforced here rather than by remembering not to reference paid models.
 */
export function findCapabilities(query: CapabilityQuery): Capability[] {
  return CAPABILITIES.filter((cap) => {
    if (!cap.freePlanEligible) return false;
    if (!cap.skills.includes(query.skill)) return false;
    if (query.accepts && !cap.accepts.includes(query.accepts)) return false;
    if (query.emits && cap.emits !== query.emits) return false;
    return true;
  }).sort((a, b) => a.priority - b.priority);
}

export function capabilityById(id: string): Capability | undefined {
  return CAPABILITIES.find((cap) => cap.id === id);
}

/** Every distinct quota bucket, for the /api/quota status strip. */
export function allBuckets(): string[] {
  return [...new Set(CAPABILITIES.filter((c) => c.freePlanEligible).map((c) => c.quota.bucket))];
}
