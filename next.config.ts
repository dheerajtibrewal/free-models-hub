import type { NextConfig } from 'next';

/**
 * Security headers.
 *
 * The app has no auth and stores nothing, so the realistic risks are
 * clickjacking and the browser being talked into treating a response as
 * something it is not. No CSP is set: Next injects inline scripts for
 * hydration, and a nonce-based policy would need middleware -- worth adding
 * later, but a broken CSP is worse than none.
 */
const securityHeaders = [
  { key: 'X-Frame-Options', value: 'DENY' },
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
  // The app only needs the mic, and only on its own origin.
  { key: 'Permissions-Policy', value: 'camera=(), geolocation=(), microphone=(self)' },
  { key: 'X-DNS-Prefetch-Control', value: 'on' },
];

const nextConfig: NextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,

  async headers() {
    return [
      { source: '/:path*', headers: securityHeaders },
      {
        // Generated media is per-request and quota-bound; never let a CDN or
        // browser serve a stale result to the next visitor.
        source: '/api/:path*',
        headers: [
          ...securityHeaders,
          { key: 'Cache-Control', value: 'no-store, no-cache, must-revalidate' },
        ],
      },
    ];
  },
};

export default nextConfig;
