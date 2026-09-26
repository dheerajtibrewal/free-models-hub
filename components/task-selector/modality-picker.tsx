'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import { ArrowRight, Sparkles } from 'lucide-react';
import type { Modality } from '@/lib/registry';
import { MODALITY_LABEL, ModalityIcon } from '@/components/modality-icon';
import { Button } from '@/components/ui';
import { cn } from '@/lib/utils';

const MODALITIES: Modality[] = ['text', 'image', 'audio'];

/**
 * The hero IS the selector.
 *
 * The product promise is task-first -- "say what you want, not which model" --
 * so the input/output choice gets the position and visual weight a search bar
 * would get on a search product, rather than being buried below a pitch.
 */
export function ModalityPicker({
  routes,
}: {
  /** slug per valid pair, e.g. { 'audio->image': 'audio-to-image' } */
  routes: Record<string, string>;
}) {
  const router = useRouter();
  const [from, setFrom] = React.useState<Modality>('text');
  const [to, setTo] = React.useState<Modality>('image');

  const slug = routes[`${from}->${to}`];
  const unsupported = !slug;

  const go = () => {
    if (slug) router.push(`/task/${slug}`);
  };

  return (
    <div className="w-full">
      <div className="rounded-[18px] border border-[var(--border)] bg-[var(--card)] p-4 shadow-[0_24px_60px_-30px_rgba(0,0,0,0.6)] sm:p-5">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-end">
          <Group label="I have" value={from} onChange={setFrom} name="from" />

          <div className="hidden shrink-0 pb-3 text-[var(--subtle-fg)] sm:block" aria-hidden="true">
            <ArrowRight size={18} />
          </div>

          <Group label="I want" value={to} onChange={setTo} name="to" />

          <Button
            variant="primary"
            size="lg"
            onClick={go}
            disabled={unsupported}
            className="w-full sm:w-auto"
          >
            <Sparkles size={16} aria-hidden="true" />
            Start
          </Button>
        </div>
      </div>

      <p
        className="mt-3 min-h-[20px] px-1 text-xs text-muted-fg"
        role="status"
        aria-live="polite"
      >
        {unsupported
          ? `${MODALITY_LABEL[from]} to ${MODALITY_LABEL[to]} isn't a route yet — pick a different pair.`
          : `${MODALITY_LABEL[from]} to ${MODALITY_LABEL[to]} — we'll pick the models and fall back if one is out of quota.`}
      </p>
    </div>
  );
}

function Group({
  label,
  value,
  onChange,
  name,
}: {
  label: string;
  value: Modality;
  onChange: (m: Modality) => void;
  name: string;
}) {
  return (
    <fieldset className="min-w-0 flex-1">
      <legend className="mb-2 block text-[11px] font-semibold uppercase tracking-wider text-muted-fg">
        {label}
      </legend>
      <div
        className="grid grid-cols-3 gap-1.5 rounded-[12px] bg-[var(--muted)] p-1.5"
        role="radiogroup"
        aria-label={label}
      >
        {MODALITIES.map((m) => {
          const active = m === value;
          return (
            <button
              key={m}
              type="button"
              role="radio"
              aria-checked={active}
              name={name}
              onClick={() => onChange(m)}
              className={cn(
                'flex h-11 cursor-pointer items-center justify-center gap-2 rounded-[9px] text-[13px] font-medium',
                'transition-[background-color,color,box-shadow] duration-200',
                active
                  ? 'bg-[var(--bg-raised)] text-fg shadow-[0_1px_2px_rgba(0,0,0,0.3)]'
                  : 'text-muted-fg hover:text-fg',
              )}
            >
              <ModalityIcon modality={m} size={15} />
              <span>{MODALITY_LABEL[m]}</span>
            </button>
          );
        })}
      </div>
    </fieldset>
  );
}
