import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { RECIPES, recipeBySlug } from '@/lib/registry';
import { SiteHeader } from '@/components/site-header';
import { Workspace } from '@/components/workspace/workspace';

/** Seven known routes: prerender the shells and let the client do the work. */
export function generateStaticParams() {
  return RECIPES.map((r) => ({ pair: r.slug }));
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ pair: string }>;
}): Promise<Metadata> {
  const { pair } = await params;
  const recipe = recipeBySlug(pair);
  if (!recipe) return { title: 'Not found' };
  return {
    title: recipe.title,
    description: recipe.blurb,
    openGraph: { title: `${recipe.title} — Free LLM`, description: recipe.blurb },
  };
}

export default async function TaskPage({ params }: { params: Promise<{ pair: string }> }) {
  const { pair } = await params;
  const recipe = recipeBySlug(pair);
  if (!recipe) notFound();

  return (
    <>
      <SiteHeader />
      <main id="main">
        <Workspace recipe={recipe} />
      </main>
    </>
  );
}
