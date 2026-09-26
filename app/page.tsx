import { Activity, GitBranch, ShieldCheck } from 'lucide-react';
import { RECIPES } from '@/lib/registry';
import { SiteHeader } from '@/components/site-header';
import { ModalityPicker } from '@/components/task-selector/modality-picker';
import { TaskGrid } from '@/components/task-selector/task-grid';
import { QuotaStrip } from '@/components/quota-strip';

export default function HomePage() {
  const routes = Object.fromEntries(RECIPES.map((r) => [r.pair, r.slug]));

  return (
    <>
      <SiteHeader />

      <main id="main">
        {/* Hero */}
        <section className="relative overflow-hidden border-b border-[var(--border)]">
          <div
            className="pointer-events-none absolute inset-0"
            style={{ background: 'var(--gradient-hero)' }}
            aria-hidden="true"
          />
          <div className="relative mx-auto max-w-4xl px-4 pb-12 pt-16 sm:px-6 sm:pb-16 sm:pt-24">
            <div className="mb-6 flex justify-center">
              <span className="inline-flex items-center gap-2 rounded-full border border-[rgba(37,99,235,0.35)] bg-[rgba(37,99,235,0.12)] px-3 py-1 text-[12px] font-medium text-[var(--accent-text)]">
                <Activity size={12} aria-hidden="true" />
                Free models only · no sign-up
              </span>
            </div>

            <h1 className="text-balance text-center text-[34px] font-bold leading-[1.1] tracking-[-0.02em] sm:text-[52px]">
              Say what you want.
              <br />
              <span
                className="bg-clip-text text-transparent"
                style={{ backgroundImage: 'linear-gradient(135deg,#60a5fa,#2563eb)' }}
              >
                Not which model does it.
              </span>
            </h1>

            <p className="mx-auto mt-5 max-w-xl text-pretty text-center text-[15px] leading-relaxed text-muted-fg">
              Pick an input and an output. Free Models Hub finds a free model that can do the job, chains
              several together when no single one can, and shows you exactly how it ran.
            </p>

            <div className="mt-10">
              <ModalityPicker routes={routes} />
            </div>
          </div>
        </section>

        {/* Utilities */}
        <section className="mx-auto max-w-6xl px-4 py-12 sm:px-6 sm:py-16">
          <div className="mb-6 flex flex-wrap items-end justify-between gap-3">
            <div>
              <h2 className="text-[22px] font-semibold tracking-tight">Utilities</h2>
              <p className="mt-1 text-sm text-muted-fg">
                Seven routes across text, image and audio.
              </p>
            </div>
            <QuotaStrip />
          </div>
          <TaskGrid recipes={RECIPES} />
        </section>

        {/* How it works */}
        <section
          id="how-it-works"
          className="border-t border-[var(--border)] bg-[var(--bg-raised)]"
        >
          <div className="mx-auto max-w-6xl px-4 py-12 sm:px-6 sm:py-16">
            <h2 className="text-[22px] font-semibold tracking-tight">How it works</h2>
            <p className="mt-1 max-w-2xl text-sm leading-relaxed text-muted-fg">
              Free tiers are fragmented, capped and change monthly. The router treats that as a
              routing problem rather than something you should have to learn.
            </p>

            <div className="mt-8 grid gap-4 sm:grid-cols-3">
              <Feature
                icon={<GitBranch size={17} aria-hidden="true" />}
                title="Composed routing"
                body="No model turns speech into a picture. So audio is transcribed, an LLM rewrites the spoken intent into a proper image prompt, and a diffusion model draws it — one click, three models."
              />
              <Feature
                icon={<ShieldCheck size={17} aria-hidden="true" />}
                title="Quota-aware fallback"
                body="Every model's remaining free budget is checked before the call. If a step fails mid-pipeline, only that step retries on another provider — finished work is never paid for twice."
              />
              <Feature
                icon={<Activity size={17} aria-hidden="true" />}
                title="X-Ray mode"
                body="Open the trace on any result to see each provider, model, token count, latency and fallback. The routing is the product, so none of it is hidden."
              />
            </div>
          </div>
        </section>

      </main>
    </>
  );
}

function Feature({
  icon,
  title,
  body,
}: {
  icon: React.ReactNode;
  title: string;
  body: string;
}) {
  return (
    <div className="rounded-[14px] border border-[var(--border)] bg-[var(--card)] p-5">
      <div className="mb-3 grid h-9 w-9 place-items-center rounded-[10px] bg-[rgba(37,99,235,0.14)] text-[var(--accent-text)]">
        {icon}
      </div>
      <h3 className="text-[14px] font-semibold tracking-tight">{title}</h3>
      <p className="mt-1.5 text-[13px] leading-relaxed text-muted-fg">{body}</p>
    </div>
  );
}
