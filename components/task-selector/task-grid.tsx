'use client';

import * as React from 'react';
import Link from 'next/link';
import { ArrowRight, Layers } from 'lucide-react';
import type { Recipe } from '@/lib/registry/recipes';
import { ModalityIcon } from '@/components/modality-icon';
import { Badge } from '@/components/ui';
import { cn } from '@/lib/utils';
import type { QuotaResponse } from '@/lib/types';

/**
 * The seven utilities.
 *
 * Availability comes from /api/quota so a route that cannot run today is greyed
 * out with the reason, rather than letting the user pick it and hit a failure.
 */
export function TaskGrid({ recipes }: { recipes: Recipe[] }) {
  const [quota, setQuota] = React.useState<QuotaResponse | null>(null);

  React.useEffect(() => {
    const controller = new AbortController();
    fetch('/api/quota', { signal: controller.signal })
      .then((r) => (r.ok ? r.json() : null))
      .then((data: QuotaResponse | null) => setQuota(data))
      .catch(() => {
        /* the grid stays fully enabled; a real run will report the truth */
      });
    return () => controller.abort();
  }, []);

  const statusFor = (slug: string) => quota?.tasks.find((t) => t.slug === slug);

  return (
    <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
      {recipes.map((recipe, i) => {
        const status = statusFor(recipe.slug);
        const unavailable = status?.available === false;
        const steps = recipe.steps.length;

        return (
          <li
            key={recipe.slug}
            className="fl-rise"
            style={{ animationDelay: `${Math.min(i, 8) * 60}ms` }}
          >
            <Link
              href={`/task/${recipe.slug}`}
              aria-disabled={unavailable}
              className={cn(
                'group flex h-full flex-col gap-3 rounded-[14px] border border-[var(--border)] bg-[var(--card)] p-5',
                'transition-[border-color,background-color,transform] duration-200',
                unavailable
                  ? 'pointer-events-none opacity-55'
                  : 'hover:-translate-y-0.5 hover:border-[var(--border-hover)]',
              )}
            >
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-1.5 text-[var(--accent-text)]">
                  <ModalityIcon modality={recipe.steps[0]!.from} size={15} />
                  <ArrowRight size={12} className="text-[var(--subtle-fg)]" aria-hidden="true" />
                  <ModalityIcon
                    modality={recipe.steps[recipe.steps.length - 1]!.to}
                    size={15}
                  />
                </div>
                {steps > 1 ? (
                  <Badge tone="blue">
                    <Layers size={10} aria-hidden="true" />
                    {steps} models
                  </Badge>
                ) : null}
              </div>

              <div className="flex-1">
                <h3 className="text-[15px] font-semibold tracking-tight text-fg">{recipe.title}</h3>
                <p className="mt-1.5 text-[13px] leading-relaxed text-muted-fg">{recipe.blurb}</p>
              </div>

              <p className="text-[11px] font-medium text-[var(--subtle-fg)]">
                {unavailable ? status?.reason : `${recipe.action} →`}
              </p>
            </Link>
          </li>
        );
      })}
    </ul>
  );
}
