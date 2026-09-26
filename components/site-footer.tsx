import { Linkedin } from 'lucide-react';

/**
 * Site-wide footer.
 *
 * Rendered from the root layout so every page carries it without each page
 * having to remember. Kept quiet: attribution should read as a signature, not
 * a banner.
 */
export function SiteFooter() {
  return (
    <footer className="mt-auto border-t border-[var(--border)]">
      <div className="mx-auto flex max-w-6xl flex-col gap-4 px-4 py-8 sm:flex-row sm:items-center sm:justify-between sm:px-6">
        <p className="max-w-xl text-[11.5px] leading-relaxed text-[var(--subtle-fg)]">
          Free LLM routes to the free tiers of Groq, Cloudflare Workers AI and OpenRouter. Daily
          allowances are shared by everyone and reset at 00:00 UTC. No accounts, nothing stored.
        </p>

        <p className="flex shrink-0 items-center gap-1.5 text-[12px] text-muted-fg">
          <span>Made by</span>
          <a
            href="https://www.linkedin.com/in/dheeraj-tibrewal/"
            target="_blank"
            rel="noreferrer noopener"
            className={[
              'group inline-flex items-center gap-1.5 rounded-md font-medium text-fg',
              'underline decoration-[var(--border-hover)] decoration-1 underline-offset-4',
              'transition-colors duration-200',
              'hover:text-[var(--accent-text)] hover:decoration-[var(--accent-text)]',
            ].join(' ')}
          >
            Dheeraj Tibrewal
            <Linkedin
              size={13}
              className="text-[var(--subtle-fg)] transition-colors duration-200 group-hover:text-[var(--accent-text)]"
              aria-hidden="true"
            />
            <span className="sr-only">(opens LinkedIn in a new tab)</span>
          </a>
        </p>
      </div>
    </footer>
  );
}
