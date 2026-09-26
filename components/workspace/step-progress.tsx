'use client';

import { Check, ChevronRight, CornerDownRight, Minus } from 'lucide-react';
import type { StepProgress as Step } from '@/lib/hooks/use-run';
import { Spinner } from '@/components/ui';
import { cn, formatLatency } from '@/lib/utils';

/**
 * Live pipeline progress.
 *
 * A three-step route can run for 10+ seconds, so the user sees which model is
 * working right now -- and, when a step falls back, that it happened and to what.
 */
export function StepProgressBar({ steps }: { steps: Step[] }) {
  if (steps.length === 0) return null;

  return (
    <ol className="flex flex-wrap items-center gap-x-1.5 gap-y-2" aria-live="polite">
      {steps.map((step, i) => (
        <li key={step.index} className="flex items-center gap-1.5">
          <div
            className={cn(
              'flex items-center gap-2 rounded-[9px] border px-2.5 py-1.5 transition-colors duration-200',
              step.state === 'active'
                ? 'border-[rgba(37,99,235,0.4)] bg-[rgba(37,99,235,0.1)]'
                : step.state === 'done'
                  ? 'border-[var(--border)] bg-[var(--card)]'
                  : 'border-[var(--border)] bg-transparent',
            )}
          >
            <Marker state={step.state} />
            <div className="min-w-0">
              <p
                className={cn(
                  'truncate text-[12px] font-medium',
                  step.state === 'pending' ? 'text-[var(--subtle-fg)]' : 'text-fg',
                )}
              >
                {step.title}
              </p>
              {step.label ? (
                <p className="truncate font-mono text-[10.5px] text-muted-fg">
                  {step.label}
                  {step.latencyMs !== undefined ? (
                    <span className="tabular"> · {formatLatency(step.latencyMs)}</span>
                  ) : null}
                </p>
              ) : null}
            </div>
          </div>

          {step.fellBackFrom ? (
            <span
              className="flex items-center gap-1 font-mono text-[10.5px] text-[#fbbf24]"
              title={`${step.fellBackFrom} was unavailable`}
            >
              <CornerDownRight size={10} aria-hidden="true" />
              fell back
            </span>
          ) : null}

          {i < steps.length - 1 ? (
            <ChevronRight size={13} className="text-[var(--subtle-fg)]" aria-hidden="true" />
          ) : null}
        </li>
      ))}
    </ol>
  );
}

function Marker({ state }: { state: Step['state'] }) {
  if (state === 'active') {
    return <Spinner className="shrink-0 text-[var(--accent-text)]" />;
  }
  if (state === 'done') {
    return <Check size={14} className="shrink-0 text-[#4ade80]" aria-hidden="true" />;
  }
  if (state === 'skipped') {
    return <Minus size={14} className="shrink-0 text-[var(--subtle-fg)]" aria-hidden="true" />;
  }
  return (
    <span
      className="h-2 w-2 shrink-0 rounded-full border border-[var(--border-hover)]"
      aria-hidden="true"
    />
  );
}
