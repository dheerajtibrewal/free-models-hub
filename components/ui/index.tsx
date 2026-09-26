import * as React from 'react';
import { cn } from '@/lib/utils';

/* ---------------------------------------------------------------------- Button */

type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger';
type ButtonSize = 'sm' | 'md' | 'lg';

const VARIANTS: Record<ButtonVariant, string> = {
  // Blue is used as a FILLED surface only: white on #2563EB is 5.2:1, whereas
  // blue text on the dark ground would be 3.6:1 and fail AA.
  primary:
    'text-[var(--primary-fg)] shadow-[0_1px_0_0_rgba(255,255,255,0.08)_inset,0_8px_24px_-8px_rgba(37,99,235,0.6)] hover:brightness-110 disabled:brightness-100',
  secondary:
    'bg-[var(--card)] text-fg border border-[var(--border)] hover:border-[var(--border-hover)] hover:bg-[var(--muted)]',
  ghost: 'bg-transparent text-muted-fg hover:text-fg hover:bg-[var(--muted)]',
  danger: 'bg-[var(--destructive)] text-[var(--destructive-fg)] hover:brightness-110',
};

const SIZES: Record<ButtonSize, string> = {
  // Every interactive size clears the 44px minimum touch target except `sm`,
  // which is only ever used for inline controls that sit inside a larger target.
  sm: 'h-9 px-3 text-[13px] gap-1.5',
  md: 'h-11 px-4 text-sm gap-2',
  lg: 'h-12 px-6 text-[15px] gap-2',
};

export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
}

export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { className, variant = 'secondary', size = 'md', style, ...props },
  ref,
) {
  return (
    <button
      ref={ref}
      className={cn(
        'inline-flex items-center justify-center rounded-[10px] font-medium',
        'transition-[background-color,border-color,filter,opacity] duration-200',
        'cursor-pointer select-none whitespace-nowrap',
        'disabled:cursor-not-allowed disabled:opacity-50',
        VARIANTS[variant],
        SIZES[size],
        className,
      )}
      style={variant === 'primary' ? { background: 'var(--gradient-primary)', ...style } : style}
      {...props}
    />
  );
});

/* ----------------------------------------------------------------------- Panel */

export function Panel({
  className,
  children,
  ...props
}: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn(
        'rounded-[var(--radius-lg)] border border-[var(--border)] bg-[var(--card)]',
        className,
      )}
      {...props}
    >
      {children}
    </div>
  );
}

export function PanelHeader({
  title,
  hint,
  actions,
}: {
  title: React.ReactNode;
  hint?: React.ReactNode;
  actions?: React.ReactNode;
}) {
  return (
    <div className="flex min-h-[52px] items-center justify-between gap-3 border-b border-[var(--border)] px-5 py-3">
      <div className="min-w-0">
        <h2 className="truncate text-[13px] font-semibold tracking-wide text-fg uppercase">
          {title}
        </h2>
        {hint ? <p className="mt-0.5 truncate text-xs text-muted-fg">{hint}</p> : null}
      </div>
      {actions ? <div className="flex shrink-0 items-center gap-2">{actions}</div> : null}
    </div>
  );
}

/* ----------------------------------------------------------------------- Badge */

type BadgeTone = 'neutral' | 'blue' | 'green' | 'amber' | 'red';

const TONES: Record<BadgeTone, string> = {
  neutral: 'bg-[var(--muted)] text-muted-fg border-[var(--border)]',
  blue: 'bg-[rgba(37,99,235,0.14)] text-[var(--accent-text)] border-[rgba(37,99,235,0.35)]',
  green: 'bg-[rgba(34,197,94,0.12)] text-[#4ade80] border-[rgba(34,197,94,0.3)]',
  amber: 'bg-[rgba(245,158,11,0.12)] text-[#fbbf24] border-[rgba(245,158,11,0.3)]',
  red: 'bg-[rgba(239,68,68,0.12)] text-[#f87171] border-[rgba(239,68,68,0.3)]',
};

export function Badge({
  tone = 'neutral',
  mono,
  className,
  children,
}: {
  tone?: BadgeTone;
  mono?: boolean;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 rounded-md border px-2 py-0.5 text-[11px] font-medium leading-5',
        mono && 'font-mono',
        TONES[tone],
        className,
      )}
    >
      {children}
    </span>
  );
}

/* --------------------------------------------------------------------- Spinner */

export function Spinner({ className }: { className?: string }) {
  return (
    <svg
      className={cn('animate-spin', className)}
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      aria-hidden="true"
    >
      <circle cx="12" cy="12" r="9" stroke="currentColor" strokeOpacity="0.25" strokeWidth="3" />
      <path
        d="M21 12a9 9 0 0 0-9-9"
        stroke="currentColor"
        strokeWidth="3"
        strokeLinecap="round"
      />
    </svg>
  );
}

/* ---------------------------------------------------------------------- Shared */

export function Skeleton({ className }: { className?: string }) {
  return <div className={cn('fl-skeleton rounded-md', className)} />;
}

export function EmptyState({
  icon,
  title,
  body,
}: {
  icon?: React.ReactNode;
  title: string;
  body?: string;
}) {
  return (
    <div className="flex flex-col items-center justify-center gap-3 px-6 py-14 text-center">
      {icon ? <div className="text-[var(--subtle-fg)]">{icon}</div> : null}
      <p className="text-sm font-medium text-muted-fg">{title}</p>
      {body ? <p className="max-w-sm text-xs leading-relaxed text-[var(--subtle-fg)]">{body}</p> : null}
    </div>
  );
}
