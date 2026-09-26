'use client';

import * as React from 'react';
import { Activity, AlertTriangle, ChevronDown, CornerDownRight } from 'lucide-react';
import type { AttemptTrace, StepTrace, XRayTrace } from '@/lib/router/types';
import { Badge } from '@/components/ui';
import { cn, formatLatency } from '@/lib/utils';
import { xrayOpened } from '@/lib/analytics/events';

const PROVIDER_LABEL: Record<string, string> = {
  groq: 'Groq',
  cloudflare: 'Cloudflare',
  openrouter: 'OpenRouter',
  browser: 'On-device',
};

/**
 * X-Ray mode.
 *
 * The routing IS the product, so the trace is a first-class panel rather than a
 * debug dump: per-step provider, model, usage, latency bar, and every fallback
 * attempt in the order it happened.
 */
export function XRayDrawer({ trace, taskSlug }: { trace?: XRayTrace; taskSlug: string }) {
  const [open, setOpen] = React.useState(false);

  const toggle = () => {
    const next = !open;
    setOpen(next);
    if (next) xrayOpened(taskSlug);
  };

  if (!trace) return null;

  const slowest = Math.max(1, ...trace.steps.map((s) => s.latencyMs));

  return (
    <section
      className="overflow-hidden rounded-[14px] border border-[var(--border)] bg-[var(--card)]"
      aria-labelledby="xray-heading"
    >
      <button
        type="button"
        onClick={toggle}
        aria-expanded={open}
        aria-controls="xray-body"
        className="flex w-full cursor-pointer items-center justify-between gap-3 px-5 py-4 text-left transition-colors duration-200 hover:bg-[var(--muted)]"
      >
        <div className="flex min-w-0 flex-wrap items-center gap-2">
          <Activity size={15} className="shrink-0 text-[var(--accent-text)]" aria-hidden="true" />
          <h2 id="xray-heading" className="text-[13px] font-semibold tracking-wide uppercase">
            X-Ray
          </h2>
          <span className="tabular font-mono text-[12px] text-muted-fg">
            {formatLatency(trace.totalLatencyMs)}
          </span>
          <span className="text-[12px] text-[var(--subtle-fg)]">·</span>
          <span className="text-[12px] text-muted-fg">
            {trace.providersUsed.map((p) => PROVIDER_LABEL[p] ?? p).join(' + ') || 'no provider'}
          </span>
          {trace.fallbackOccurred ? (
            <Badge tone="amber">
              <AlertTriangle size={10} aria-hidden="true" />
              {trace.retryCount} fallback{trace.retryCount === 1 ? '' : 's'}
            </Badge>
          ) : (
            <Badge tone="green">no fallback</Badge>
          )}
        </div>
        <ChevronDown
          size={16}
          className={cn(
            'shrink-0 text-muted-fg transition-transform duration-200',
            open && 'rotate-180',
          )}
          aria-hidden="true"
        />
      </button>

      <div id="xray-body" hidden={!open} className="border-t border-[var(--border)]">
        <dl className="grid grid-cols-2 gap-px bg-[var(--border)] sm:grid-cols-4">
          <Stat label="Task" value={trace.task} />
          <Stat label="Route" value={trace.pair.replace('->', ' → ')} mono />
          <Stat label="Total latency" value={formatLatency(trace.totalLatencyMs)} mono />
          <Stat label="Steps" value={String(trace.steps.length)} mono />
        </dl>

        <ol className="divide-y divide-[var(--border)]">
          {trace.steps.map((step) => (
            <StepRow key={step.index} step={step} slowest={slowest} />
          ))}
        </ol>

        {trace.error ? (
          <p className="border-t border-[var(--border)] bg-[rgba(239,68,68,0.06)] px-5 py-3 font-mono text-[12px] text-[#f87171]">
            {trace.error.kind}: {trace.error.message}
          </p>
        ) : null}
      </div>
    </section>
  );
}

function Stat({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="bg-[var(--card)] px-5 py-3">
      <dt className="text-[10px] font-semibold uppercase tracking-wider text-[var(--subtle-fg)]">
        {label}
      </dt>
      <dd className={cn('mt-1 truncate text-[13px] text-fg', mono && 'tabular font-mono')}>
        {value}
      </dd>
    </div>
  );
}

function StepRow({ step, slowest }: { step: StepTrace; slowest: number }) {
  const resolved = step.attempts.find((a) => a.ok);
  const failed = step.attempts.filter((a) => !a.ok);

  return (
    <li className="px-5 py-4">
      <div className="flex flex-wrap items-center gap-2">
        <span className="tabular grid h-5 w-5 shrink-0 place-items-center rounded-[6px] bg-[var(--muted)] font-mono text-[11px] text-muted-fg">
          {step.index + 1}
        </span>
        <span className="text-[13px] font-medium text-fg">{step.title}</span>
        <span className="font-mono text-[11px] text-[var(--subtle-fg)]">
          {step.from} → {step.to}
        </span>
        {step.skipped ? <Badge tone="neutral">skipped</Badge> : null}
        <span className="tabular ml-auto font-mono text-[12px] text-muted-fg">
          {formatLatency(step.latencyMs)}
        </span>
      </div>

      {/* Latency bar, relative to the slowest step in this run. */}
      <div className="mt-2.5 h-1 overflow-hidden rounded-full bg-[var(--muted)]">
        <div
          className="h-full rounded-full"
          style={{
            width: `${Math.max(2, (step.latencyMs / slowest) * 100)}%`,
            background: 'var(--gradient-primary)',
          }}
          aria-hidden="true"
        />
      </div>

      <div className="mt-3 flex flex-col gap-1.5">
        {failed.map((attempt, i) => (
          <AttemptRow key={`${attempt.capabilityId}-${i}`} attempt={attempt} />
        ))}
        {resolved ? <AttemptRow attempt={resolved} /> : null}
      </div>
    </li>
  );
}

function AttemptRow({ attempt }: { attempt: AttemptTrace }) {
  const usage = attempt.usage;
  const bits: string[] = [];
  if (usage?.inputTokens !== undefined) bits.push(`in ${usage.inputTokens}`);
  if (usage?.outputTokens !== undefined) bits.push(`out ${usage.outputTokens}`);
  if (usage?.audioSeconds !== undefined) bits.push(`${Math.round(usage.audioSeconds)}s audio`);
  if (usage?.neurons !== undefined) bits.push(`~${usage.neurons} neurons`);

  return (
    <div
      className={cn(
        'flex flex-wrap items-center gap-2 rounded-[8px] px-2.5 py-2 font-mono text-[11.5px]',
        attempt.ok ? 'bg-[var(--muted)]' : 'bg-[rgba(239,68,68,0.07)]',
      )}
    >
      {attempt.ok ? null : (
        <CornerDownRight size={11} className="shrink-0 text-[#f87171]" aria-hidden="true" />
      )}
      <Badge tone={attempt.ok ? 'blue' : 'red'} mono>
        {PROVIDER_LABEL[attempt.provider] ?? attempt.provider}
      </Badge>
      <span className="truncate text-fg">{attempt.model}</span>
      {bits.length ? <span className="tabular text-[var(--subtle-fg)]">{bits.join(' · ')}</span> : null}
      <span className="tabular ml-auto text-muted-fg">{formatLatency(attempt.latencyMs)}</span>
      {attempt.error ? (
        <p className="w-full text-[11px] leading-relaxed text-[#f87171]">
          {attempt.error.kind}: {attempt.error.message.slice(0, 180)}
        </p>
      ) : null}
    </div>
  );
}
