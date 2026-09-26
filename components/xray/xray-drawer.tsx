'use client';

import * as React from 'react';
import {
  Activity,
  AlertTriangle,
  ChevronDown,
  CornerDownRight,
  Cpu,
  Gauge,
  Timer,
} from 'lucide-react';
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

const BUCKET_LABEL: Record<string, string> = {
  'groq:chat': 'Groq · chat models',
  'groq:whisper': 'Groq · Whisper',
  'groq:tts': 'Groq · text-to-speech',
  'cloudflare:neurons': 'Cloudflare · neuron pool',
  'openrouter:free': 'OpenRouter · free tier',
};

/**
 * X-Ray mode.
 *
 * The routing IS the product, so the trace is a first-class panel rather than a
 * debug dump: what each step consumed, which free-tier budget paid for it, and
 * every fallback attempt in the order it happened.
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
  const { totals } = trace;

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
          <h2 id="xray-heading" className="text-[13px] font-semibold uppercase tracking-wide">
            X-Ray
          </h2>
          <span className="tabular font-mono text-[12px] text-muted-fg">
            {formatLatency(trace.totalLatencyMs)}
          </span>
          <span className="text-[12px] text-[var(--subtle-fg)]">·</span>
          <span className="text-[12px] text-muted-fg">
            {trace.providersUsed.map((p) => PROVIDER_LABEL[p] ?? p).join(' + ') || 'no provider'}
          </span>
          {totals.totalTokens > 0 ? (
            <span className="tabular hidden font-mono text-[12px] text-[var(--subtle-fg)] sm:inline">
              {totals.totalTokens.toLocaleString()} tok
            </span>
          ) : null}
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
        {/* Run summary */}
        <dl className="grid grid-cols-2 gap-px bg-[var(--border)] sm:grid-cols-4">
          <Stat label="Task" value={trace.task} />
          <Stat label="Route" value={trace.pair.replace('->', ' → ')} mono />
          <Stat label="Total latency" value={formatLatency(trace.totalLatencyMs)} mono />
          <Stat label="Steps" value={String(trace.steps.length)} mono />
        </dl>

        {/* Usage totals -- only the dimensions this run actually touched. */}
        <dl className="grid grid-cols-2 gap-px border-t border-[var(--border)] bg-[var(--border)] sm:grid-cols-4">
          {totals.inputTokens > 0 ? (
            <Stat label="Input tokens" value={totals.inputTokens.toLocaleString()} mono />
          ) : null}
          {totals.outputTokens > 0 ? (
            <Stat label="Output tokens" value={totals.outputTokens.toLocaleString()} mono />
          ) : null}
          {totals.audioSeconds > 0 ? (
            <Stat label="Audio processed" value={`${Math.round(totals.audioSeconds)}s`} mono />
          ) : null}
          {totals.neurons > 0 ? (
            <Stat label="Neurons" value={`~${totals.neurons.toLocaleString()}`} mono />
          ) : null}
          <Stat label="Provider calls" value={String(totals.providerCalls)} mono />
          <Stat label="Routing overhead" value={formatLatency(trace.overheadMs)} mono />
        </dl>

        {/* Per-step timeline */}
        <ol className="divide-y divide-[var(--border)] border-t border-[var(--border)]">
          {trace.steps.map((step) => (
            <StepRow key={step.index} step={step} slowest={slowest} />
          ))}
        </ol>

        {/* What this run cost the shared free-tier budgets. */}
        {trace.consumption.length > 0 ? (
          <div className="border-t border-[var(--border)] bg-[var(--bg)] px-5 py-4">
            <h3 className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wider text-[var(--subtle-fg)]">
              <Gauge size={11} aria-hidden="true" />
              Free-tier budgets used by this run
            </h3>
            <ul className="mt-3 flex flex-col gap-1.5">
              {trace.consumption.map((c) => (
                <li
                  key={c.bucket}
                  className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-[8px] bg-[var(--card)] px-3 py-2 font-mono text-[11.5px]"
                >
                  <span className="text-fg">{BUCKET_LABEL[c.bucket] ?? c.bucket}</span>
                  <span className="tabular text-muted-fg">
                    {c.requests} request{c.requests === 1 ? '' : 's'}
                  </span>
                  {c.tokens ? (
                    <span className="tabular text-muted-fg">{c.tokens.toLocaleString()} tokens</span>
                  ) : null}
                  {c.audioSeconds ? (
                    <span className="tabular text-muted-fg">
                      {Math.round(c.audioSeconds)}s audio
                    </span>
                  ) : null}
                  {c.neurons ? (
                    <span className="tabular text-muted-fg">~{c.neurons} neurons</span>
                  ) : null}
                  {c.limitLabel ? (
                    <span className="tabular ml-auto text-[var(--subtle-fg)]">
                      of {c.limitLabel}
                    </span>
                  ) : null}
                </li>
              ))}
            </ul>
            <p className="mt-2.5 text-[11px] leading-relaxed text-[var(--subtle-fg)]">
              These allowances are shared by everyone using this site and reset at 00:00 UTC.
              Figures are what the providers reported for this run; neuron counts are estimates.
            </p>
          </div>
        ) : null}

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

      {/* What went in and what came out of this step. */}
      {step.input || step.output ? (
        <p className="mt-2 flex flex-wrap items-center gap-1.5 font-mono text-[11px] text-[var(--subtle-fg)]">
          {step.input ? (
            <span>
              in: {step.input.modality} · {step.input.label}
            </span>
          ) : null}
          {step.input && step.output ? <span aria-hidden="true">→</span> : null}
          {step.output ? (
            <span>
              out: {step.output.modality} · {step.output.label}
            </span>
          ) : null}
        </p>
      ) : null}

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
  const u = attempt.usage;
  const metrics: Array<{ label: string; value: string }> = [];
  if (u?.inputTokens !== undefined) {
    metrics.push({ label: 'in', value: u.inputTokens.toLocaleString() });
  }
  if (u?.outputTokens !== undefined) {
    metrics.push({ label: 'out', value: u.outputTokens.toLocaleString() });
  }
  if (u?.inputTokens !== undefined && u?.outputTokens !== undefined) {
    metrics.push({ label: 'total', value: (u.inputTokens + u.outputTokens).toLocaleString() });
  }
  if (u?.audioSeconds !== undefined) {
    metrics.push({ label: 'audio', value: `${Math.round(u.audioSeconds)}s` });
  }
  if (u?.neurons !== undefined) {
    metrics.push({ label: 'neurons', value: `~${u.neurons}` });
  }

  return (
    <div
      className={cn(
        'rounded-[8px] px-2.5 py-2 font-mono text-[11.5px]',
        attempt.ok ? 'bg-[var(--muted)]' : 'bg-[rgba(239,68,68,0.07)]',
      )}
    >
      <div className="flex flex-wrap items-center gap-2">
        {attempt.ok ? (
          <Cpu size={11} className="shrink-0 text-[var(--subtle-fg)]" aria-hidden="true" />
        ) : (
          <CornerDownRight size={11} className="shrink-0 text-[#f87171]" aria-hidden="true" />
        )}
        <Badge tone={attempt.ok ? 'blue' : 'red'} mono>
          {PROVIDER_LABEL[attempt.provider] ?? attempt.provider}
        </Badge>
        <span className="truncate text-fg">{attempt.model}</span>
        <span className="tabular ml-auto flex items-center gap-1 text-muted-fg">
          <Timer size={10} aria-hidden="true" />
          {formatLatency(attempt.latencyMs)}
        </span>
      </div>

      {metrics.length ? (
        <dl className="mt-1.5 flex flex-wrap gap-x-3 gap-y-0.5 pl-[19px]">
          {metrics.map((m) => (
            <div key={m.label} className="flex items-baseline gap-1">
              <dt className="text-[10.5px] text-[var(--subtle-fg)]">{m.label}</dt>
              <dd className="tabular text-[11px] text-muted-fg">{m.value}</dd>
            </div>
          ))}
        </dl>
      ) : null}

      {attempt.error ? (
        <p className="mt-1.5 pl-[19px] text-[11px] leading-relaxed text-[#f87171]">
          {attempt.error.kind}: {attempt.error.message.slice(0, 220)}
        </p>
      ) : null}
    </div>
  );
}
