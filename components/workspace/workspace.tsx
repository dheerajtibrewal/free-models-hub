'use client';

import * as React from 'react';
import Link from 'next/link';
import { ArrowLeft, Play, RotateCcw, X } from 'lucide-react';
import type { Recipe } from '@/lib/registry/recipes';
import { useRun } from '@/lib/hooks/use-run';
import { Badge, Button } from '@/components/ui';
import { ModalityIcon } from '@/components/modality-icon';
import { QuotaStrip } from '@/components/quota-strip';
import { XRayDrawer } from '@/components/xray/xray-drawer';
import { InputPanel, type InputState } from './input-panel';
import { OutputPanel } from './output-panel';
import { StepProgressBar } from './step-progress';

export function Workspace({ recipe }: { recipe: Recipe }) {
  const inputModality = recipe.steps[0]!.from;
  const outputModality = recipe.steps[recipe.steps.length - 1]!.to;

  const [input, setInput] = React.useState<InputState>({ instruction: '' });
  const run = useRun(recipe.slug);

  const canRun = Boolean(input.payload) && !input.busy && run.status !== 'running';
  const running = run.status === 'running';

  const start = () => {
    if (input.payload) void run.run(input.payload, input.instruction || undefined);
  };

  return (
    <div className="mx-auto max-w-6xl px-4 py-8 sm:px-6 sm:py-10">
      {/* Task header */}
      <div className="mb-6">
        <Link
          href="/"
          className="inline-flex items-center gap-1.5 rounded-md text-[13px] text-muted-fg transition-colors duration-200 hover:text-fg"
        >
          <ArrowLeft size={14} aria-hidden="true" />
          All utilities
        </Link>

        <div className="mt-4 flex flex-wrap items-end justify-between gap-4">
          <div className="min-w-0">
            <div className="mb-2 flex items-center gap-2">
              <Badge tone="blue" mono>
                <ModalityIcon modality={inputModality} size={11} />
                {inputModality} → {outputModality}
                <ModalityIcon modality={outputModality} size={11} />
              </Badge>
              {recipe.steps.length > 1 ? (
                <Badge tone="neutral">{recipe.steps.length}-step pipeline</Badge>
              ) : null}
            </div>
            <h1 className="text-[26px] font-semibold tracking-tight sm:text-[30px]">
              {recipe.title}
            </h1>
            <p className="mt-1.5 max-w-xl text-[14px] leading-relaxed text-muted-fg">
              {recipe.blurb}
            </p>
          </div>
          <QuotaStrip />
        </div>
      </div>

      {/* Live progress: only meaningful once a run has begun. */}
      {run.steps.length > 0 ? (
        <div className="mb-5 rounded-[12px] border border-[var(--border)] bg-[var(--card)] px-4 py-3.5">
          <StepProgressBar steps={run.steps} />
        </div>
      ) : null}

      {/* Two-pane workspace; stacks to one column under 1024px. */}
      <div className="grid gap-4 lg:grid-cols-2">
        <InputPanel
          modality={inputModality}
          state={input}
          onChange={setInput}
          disabled={running}
        />
        <OutputPanel modality={outputModality} run={run} action={recipe.action} />
      </div>

      {/* Desktop controls */}
      <div className="mt-5 hidden items-center gap-2.5 sm:flex">
        <Button variant="primary" size="lg" onClick={start} disabled={!canRun}>
          <Play size={15} aria-hidden="true" />
          {recipe.action}
        </Button>
        {running ? (
          <Button size="lg" onClick={run.cancel}>
            <X size={15} aria-hidden="true" />
            Cancel
          </Button>
        ) : null}
        {run.status === 'done' || run.status === 'error' ? (
          <Button size="lg" variant="ghost" onClick={run.reset}>
            <RotateCcw size={15} aria-hidden="true" />
            Reset
          </Button>
        ) : null}
      </div>

      {run.trace ? (
        <div className="mt-5">
          <XRayDrawer trace={run.trace} taskSlug={recipe.slug} />
        </div>
      ) : null}

      {/* Mobile: the primary action follows the thumb rather than the scroll. */}
      <div
        className="fixed inset-x-0 bottom-0 z-30 flex gap-2 border-t border-[var(--border)] bg-[color-mix(in_srgb,var(--bg)_92%,transparent)] px-4 py-3 backdrop-blur-xl sm:hidden"
        style={{ paddingBottom: 'calc(0.75rem + env(safe-area-inset-bottom))' }}
      >
        <Button variant="primary" size="lg" onClick={start} disabled={!canRun} className="flex-1">
          <Play size={15} aria-hidden="true" />
          {recipe.action}
        </Button>
        {running ? (
          <Button size="lg" onClick={run.cancel}>
            <X size={15} aria-hidden="true" />
          </Button>
        ) : null}
      </div>
      {/* Spacer so the sticky bar never covers the last element. */}
      <div className="h-20 sm:hidden" aria-hidden="true" />
    </div>
  );
}
