import Link from 'next/link';
import { Github } from 'lucide-react';
import { ThemeToggle } from './theme-toggle';

export function SiteHeader() {
  return (
    <header className="sticky top-0 z-40 border-b border-[var(--border)] bg-[color-mix(in_srgb,var(--bg)_82%,transparent)] backdrop-blur-xl">
      <div className="mx-auto flex h-16 max-w-6xl items-center justify-between gap-4 px-4 sm:px-6">
        <Link
          href="/"
          className="group flex items-center gap-2.5 rounded-md"
          aria-label="Free LLM home"
        >
          <span
            className="grid h-8 w-8 place-items-center rounded-[9px] text-[13px] font-bold text-white"
            style={{ background: 'var(--gradient-primary)' }}
            aria-hidden="true"
          >
            FL
          </span>
          <span className="text-[15px] font-semibold tracking-tight">Free LLM</span>
        </Link>

        <div className="flex items-center gap-1.5">
          <Link
            href="/#how-it-works"
            className="hidden rounded-md px-3 py-2 text-sm text-muted-fg transition-colors duration-200 hover:text-fg sm:block"
          >
            How it works
          </Link>
          <ThemeToggle />
          <a
            href="https://github.com/dheerajtibrewal/free-models-hub"
            target="_blank"
            rel="noreferrer noopener"
            className="grid h-11 w-11 place-items-center rounded-md text-muted-fg transition-colors duration-200 hover:bg-[var(--muted)] hover:text-fg"
            aria-label="Source on GitHub"
          >
            <Github size={17} aria-hidden="true" />
          </a>
        </div>
      </div>
    </header>
  );
}
