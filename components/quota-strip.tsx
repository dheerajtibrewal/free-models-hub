'use client';

import * as React from 'react';
import { Gauge, TriangleAlert } from 'lucide-react';
import type { QuotaResponse } from '@/lib/types';
import { Skeleton } from '@/components/ui';
import { cn } from '@/lib/utils';

/**
 * Remaining free runs, always visible.
 *
 * Being upfront about a shared allowance is deliberate: the alternative is a
 * user discovering the limit by hitting it mid-task. It also explains why a
 * route might be greyed out.
 */
export function QuotaStrip({ className }: { className?: string }) {
  const [quota, setQuota] = React.useState<QuotaResponse | null>(null);
  const [failed, setFailed] = React.useState(false);

  React.useEffect(() => {
    const controller = new AbortController();
    fetch('/api/quota', { signal: controller.signal })
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error('unavailable'))))
      .then((data: QuotaResponse) => setQuota(data))
      .catch((err: unknown) => {
        if ((err as Error)?.name !== 'AbortError') setFailed(true);
      });
    return () => controller.abort();
  }, []);

  if (failed) return null;

  if (!quota) {
    return <Skeleton className={cn('h-8 w-40', className)} />;
  }

  const { remaining, limit } = quota.visitor;
  const ratio = limit > 0 ? remaining / limit : 0;
  const tone =
    remaining === 0
      ? 'text-[#f87171]'
      : ratio <= 0.25
        ? 'text-[#fbbf24]'
        : 'text-[var(--accent-text)]';

  return (
    <div
      className={cn(
        'flex items-center gap-2.5 rounded-[10px] border border-[var(--border)] bg-[var(--card)] px-3 py-2',
        className,
      )}
    >
      <Gauge size={15} className={tone} aria-hidden="true" />
      <p className="text-[12px] text-muted-fg">
        <span className={cn('tabular font-semibold', tone)}>{remaining}</span>
        <span className="tabular"> / {limit}</span> free runs left today
      </p>
      {quota.degraded ? (
        <span
          className="text-[var(--subtle-fg)]"
          title="Usage counters are unavailable, so limits are approximate right now."
        >
          <TriangleAlert size={13} aria-hidden="true" />
        </span>
      ) : null}
    </div>
  );
}
