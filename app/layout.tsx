import type { Metadata, Viewport } from 'next';
import { Inter, JetBrains_Mono } from 'next/font/google';
import { GoogleAnalytics } from '@next/third-parties/google';
import { Analytics } from '@vercel/analytics/next';
import { SiteFooter } from '@/components/site-footer';
import { siteUrl } from '@/lib/site';
import { stringFromEnv } from '@/lib/env';
import './globals.css';

const inter = Inter({
  subsets: ['latin'],
  variable: '--font-inter',
  weight: ['300', '400', '500', '600', '700'],
  display: 'swap',
});

/**
 * Monospace is a deliberate addition to the Inter/Inter pairing: the X-Ray panel
 * is this product's signature, and model ids, token counts and latency figures
 * only read cleanly when the glyph widths line up.
 */
const mono = JetBrains_Mono({
  subsets: ['latin'],
  variable: '--font-jetbrains-mono',
  weight: ['400', '500'],
  display: 'swap',
});

const SITE_URL = siteUrl();

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: {
    default: 'Free LLM — task-first multimodal AI',
    template: '%s — Free LLM',
  },
  description:
    'Pick what you want to do, not which model does it. Free LLM routes text, image and audio tasks across free AI providers, falls back automatically, and shows you exactly how it ran.',
  openGraph: {
    title: 'Free LLM — task-first multimodal AI',
    description:
      'Choose an input and an output. Free LLM finds a free model that can do it, chains several when it has to, and shows the full execution trace.',
    url: SITE_URL,
    siteName: 'Free LLM',
    type: 'website',
  },
  twitter: { card: 'summary_large_image', title: 'Free LLM' },
  robots: { index: true, follow: true },
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  // Never block zoom: pinch-to-zoom is an accessibility affordance.
  maximumScale: 5,
  themeColor: '#0f172a',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  const gaId = stringFromEnv('NEXT_PUBLIC_GA_ID');

  return (
    <html lang="en" suppressHydrationWarning>
      <body className={`${inter.variable} ${mono.variable} antialiased`}>
        <a
          href="#main"
          className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-50 focus:rounded-md focus:bg-[var(--card)] focus:px-4 focus:py-2 focus:text-sm focus:text-fg"
        >
          Skip to content
        </a>
        <div className="flex min-h-dvh flex-col">
          {children}
          <SiteFooter />
        </div>
        <Analytics />
        {gaId ? <GoogleAnalytics gaId={gaId} /> : null}
      </body>
    </html>
  );
}
