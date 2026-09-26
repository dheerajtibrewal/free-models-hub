import Link from 'next/link';
import { SiteHeader } from '@/components/site-header';
import { Button } from '@/components/ui';

export default function NotFound() {
  return (
    <>
      <SiteHeader />
      <main id="main" className="mx-auto max-w-lg px-4 py-24 text-center sm:px-6">
        <p className="font-mono text-[13px] text-[var(--accent-text)]">404</p>
        <h1 className="mt-3 text-[26px] font-semibold tracking-tight">No such route</h1>
        <p className="mt-2 text-[14px] leading-relaxed text-muted-fg">
          That utility doesn&apos;t exist. Pick an input and an output from the home page and
          we&apos;ll find a model that can do it.
        </p>
        <Link href="/" className="mt-7 inline-block">
          <Button variant="primary" size="lg">
            Back to utilities
          </Button>
        </Link>
      </main>
    </>
  );
}
